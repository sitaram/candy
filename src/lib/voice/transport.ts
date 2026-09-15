/**
 * WebRTC transport to the realtime API. No React, no UI state: open a peer connection with the mic
 * on it and a data channel for events, negotiate SDP through our session endpoint, and hand back
 * send/close. Everything about *what the events mean* lives in the hook.
 *
 * Order matters on iOS: the <audio> element must be created inside the user gesture that started
 * the call, or autoplay policy silences the model.
 */
import { log as tlog } from "./trace";

export interface RTEvent { type: string; [k: string]: unknown }

export type VoiceStart =
  | { mode: "card"; id: string; why: string[] }
  | { mode: "search"; query?: string }
  | { mode: "doc" };

export interface TransportCallbacks {
  onEvent: (ev: RTEvent) => void;
  /** Data channel is open: the model can hear and be spoken to. Receives the transport, since this may fire before connect() resolves. */
  onOpen: (t: Transport) => void;
  /** Remote audio arrived; both streams are available for metering. */
  onTrack: (remote: MediaStream, local: MediaStream) => void;
  /** Terminal: server closed the channel, or ICE failed and did not recover. */
  onLost: (reason: string) => void;
}

export interface Transport {
  send: (ev: RTEvent) => void;
  /** Enable / disable the mic track. The model hears silence while disabled. */
  setMic: (on: boolean) => void;
  micEnabled: () => boolean;
  close: () => void;
  readonly pc: RTCPeerConnection;
  readonly dc: RTCDataChannel;
}

/** "disconnected" is transient on mobile (radio handoff, screen lock); ICE usually recovers within seconds. */
const RECOVER_MS = 8_000;

async function fetchSecret(opts: VoiceStart): Promise<string> {
  const r = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `session ${r.status}`);
  return ((await r.json()) as { secret: string }).secret;
}

async function negotiate(pc: RTCPeerConnection, secret: string): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST", body: offer.sdp,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/sdp" },
  });
  if (!res.ok) {
    // The handshake fails late: client_secrets mints with zero credits, only /calls refuses. Surface the body.
    const body = await res.text().catch(() => "");
    let msg = `realtime ${res.status}`;
    try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? msg; } catch { if (body) msg = `${msg}: ${body.slice(0, 160)}`; }
    throw new Error(msg);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  tlog("sdp.answer ok");
}

/** Open a call. Throws on mic denial, session failure, or SDP rejection; nothing is left running in that case. */
export async function connect(opts: VoiceStart, cb: TransportCallbacks): Promise<Transport> {
  // 1. Audio element inside the gesture.
  const el = document.createElement("audio");
  el.autoplay = true; el.setAttribute("playsinline", "");
  document.body.appendChild(el);
  el.addEventListener("play", () => tlog("audio.play"));
  el.addEventListener("pause", () => tlog("audio.pause"));
  el.addEventListener("error", () => tlog("audio.error", el.error?.message));

  let ms: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  const teardown = () => {
    pc?.getSenders().forEach((s) => s.track?.stop());
    pc?.close();
    ms?.getTracks().forEach((t) => t.stop());
    el.srcObject = null; el.remove();
  };

  try {
    // 2. Mic + ephemeral secret in parallel. allSettled, not all: if the secret fails while the permission
    // prompt is still up, the stream that resolves later must be stopped, or the mic indicator stays lit.
    const [msR, secR] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
      fetchSecret(opts),
    ]);
    if (msR.status === "fulfilled") ms = msR.value;
    if (msR.status === "rejected") throw msR.reason;
    if (secR.status === "rejected") throw secR.reason;   // teardown() below stops the stream we just got
    const secret = secR.value;
    const stream: MediaStream = msR.value;
    const track = stream.getAudioTracks()[0];
    // Not the device label: "Sitaram's AirPods Pro" is a name, and this trace leaves the device.
    tlog("mic+secret ok", { tracks: stream.getAudioTracks().map((t) => ({ enabled: t.enabled, muted: t.muted, settings: t.getSettings?.() })) });
    track?.addEventListener("mute", () => tlog("mic.track.mute"));
    track?.addEventListener("unmute", () => tlog("mic.track.unmute"));

    let closed = false;
    let recover: ReturnType<typeof setTimeout> | null = null;
    const lost = (why: string) => { if (closed) return; closed = true; cb.onLost(why); };

    // 3. Peer connection + data channel.
    const p = new RTCPeerConnection();
    pc = p;
    const local = stream;
    // iOS ends the track on backgrounding / an incoming call; the session would otherwise continue deaf.
    track?.addEventListener("ended", () => { tlog("mic.track.ended"); lost("microphone ended"); });
    p.ontrack = (e) => {
      tlog("pc.track", { kind: e.track.kind });
      const remote = e.streams[0] ?? new MediaStream([e.track]);   // a track without a stream would throw in createMediaStreamSource
      el.srcObject = remote; cb.onTrack(remote, local);
    };
    p.addTrack(stream.getTracks()[0]);
    const d = p.createDataChannel("oai-events");

    const t: Transport = {
      pc: p, dc: d,
      send: (ev) => {
        if (d.readyState === "open") { d.send(JSON.stringify(ev)); tlog(`send ${ev.type}`, ev.type === "conversation.item.create" ? { role: (ev.item as { role?: string })?.role, len: JSON.stringify(ev.item).length } : undefined); }
        else tlog(`send.dropped ${ev.type}`, { dc: d.readyState });
      },
      setMic: (on) => { if (track) { track.enabled = on; tlog(`mic ${on ? "open" : "muted"}`); } },
      micEnabled: () => !!track?.enabled,
      close: () => { closed = true; if (recover) clearTimeout(recover); d.close(); teardown(); },
    };
    d.onmessage = (e) => { try { cb.onEvent(JSON.parse(e.data) as RTEvent); } catch { /* not JSON */ } };
    d.onopen = () => { tlog("dc.open"); cb.onOpen(t); };
    d.onerror = (e) => tlog("dc.error", String((e as unknown as { error?: unknown }).error ?? e.type));
    d.onclose = () => { tlog("dc.close"); lost("ended by server"); };
    p.onconnectionstatechange = () => {
      const st = p.connectionState;
      tlog(`pc ${st}`);
      if (st === "connected") { if (recover) { clearTimeout(recover); recover = null; } return; }
      if (st === "failed" || st === "closed") { lost("connection lost"); return; }
      if (st === "disconnected" && !recover) recover = setTimeout(() => { if (p.connectionState !== "connected") lost("connection lost"); }, RECOVER_MS);
    };
    p.oniceconnectionstatechange = () => tlog(`ice ${p.iceConnectionState}`);
    p.onicegatheringstatechange = () => tlog(`icegather ${p.iceGatheringState}`);
    p.onsignalingstatechange = () => tlog(`signaling ${p.signalingState}`);

    await negotiate(p, secret);
    return t;
  } catch (e) {
    teardown();
    throw e;
  }
}

/** What to tell the user when connect() throws. */
export function friendlyError(e: unknown): string {
  const err = e as Error;
  if (err?.message === "Permission denied" || err?.name === "NotAllowedError") return "microphone blocked";
  return err?.message || "voice error";
}
