"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { log as tlog, traceEnd, traceStart } from "@/lib/voice/trace";

/**
 * Realtime voice over WebRTC. The server mints a client secret with the card's context baked in;
 * this hook opens the peer connection, runs the data-channel event loop, dispatches tool calls,
 * meters audio for the UI, and ends the session after 3 min with neither party speaking.
 */

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "thinking" | "error";

export interface VoiceHandlers {
  /** Called for next_card / react — returns the brief of the card now on screen, or null if none. */
  onNextCard?: () => Promise<string | null>;
  onReact?: (kind: "like" | "skip" | "save") => Promise<string | null>;
  /** Search mode: run the query in the UI and return what the model should say from. */
  /** The card on screen, so server tools can default to it. */
  currentId?: () => string | null;
  /** Called for show_repo — insert the card on the rail and page to it; returns its brief, or null if not found. */
  onShowRepo?: (id: string) => Promise<string | null>;
  onSearch?: (query: string) => Promise<string | null>;
  /** Search mode: what the user said, once transcribed (fills the box). */
  onUserTranscript?: (text: string) => void;
  /** Search mode: user said open / show me the Nth one. */
  onOpenResult?: (which: string) => Promise<string | null>;
  /** Idle cutoff; default 30 s for card conversations. Search uses a shorter one. */
  silenceMs?: number;
}

export type VoiceStart =
  | { mode: "card"; id: string; why: string[] }
  | { mode: "search"; query?: string };

const SILENCE_MS = 180_000;   // neither side has spoken for this long → hang up. Resets on user speech and on assistant audio.

interface RTEvent { type: string; [k: string]: unknown }

function summarizeResponse(ev: RTEvent): unknown {
  const r = ev.response as { status?: string; status_details?: unknown; output?: { type: string; name?: string }[]; usage?: { total_tokens?: number } } | undefined;
  return r ? { status: r.status, details: r.status_details, out: r.output?.map((o) => o.name ? `${o.type}:${o.name}` : o.type), tokens: r.usage?.total_tokens } : undefined;
}

export function useVoice(handlers: VoiceHandlers) {
  const [state, setStateRaw] = useState<VoiceState>("idle");
  const stateRef = useRef<VoiceState>("idle");
  const setState = useCallback((st: VoiceState) => { if (stateRef.current !== st) { tlog(`state ${stateRef.current}→${st}`); stateRef.current = st; } setStateRaw(st); }, []);
  const [level, setLevel] = useState(0);          // 0..1, whoever is louder (mic or model) — drives the button ring
  const [micLevel, setMicLevel] = useState(0);    // 0..1, you only — drives "hearing you"
  const [muted, setMuted] = useState(false);       // mic track disabled; the model hears silence
  const autoMuted = useRef(false);                 // muted by us for the opening take; released when that audio finishes playing
  const [transcript, setTranscript] = useState(""); // last thing the model said (for the sheet)
  const [error, setError] = useState<string | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const silenceT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivity = useRef(0);
  const startedAt = useRef(0);
  const speaking = useRef(false);   // model audio is playing on the device right now
  const h = useRef(handlers);
  h.current = handlers;

  const stop = useCallback((reason?: string, opts?: { quiet?: boolean }) => {
    if (pc.current || dc.current) traceEnd(`${reason ?? "user"} · lastActivity ${Math.round((Date.now() - lastActivity.current) / 1000)}s ago · pc ${pc.current?.connectionState} · dc ${dc.current?.readyState}`);
    if (silenceT.current) clearTimeout(silenceT.current);
    silenceT.current = null;
    cancelAnimationFrame(raf.current);
    dc.current?.close();
    pc.current?.getSenders().forEach((s) => s.track?.stop());
    pc.current?.close();
    mic.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close();
    if (audioEl.current) { audioEl.current.srcObject = null; audioEl.current.remove(); }
    pc.current = null; dc.current = null; mic.current = null; ctx.current = null; audioEl.current = null;
    setLevel(0); setMicLevel(0); speaking.current = false; setMuted(false); autoMuted.current = false;
    setState("idle");
    if (reason && !opts?.quiet) setError(reason);
  }, []);

  const bumpSilence = useCallback(() => {
    lastActivity.current = Date.now();
    if (silenceT.current) clearTimeout(silenceT.current);
    const arm = () => {
      // If audio is still playing when the timer lands, the clock hasn't started yet — try again after it stops.
      if (speaking.current) { silenceT.current = setTimeout(arm, 1_000); return; }
      stop("silence", { quiet: true });
    };
    silenceT.current = setTimeout(arm, h.current.silenceMs ?? SILENCE_MS);
  }, [stop]);

  const send = useCallback((ev: RTEvent) => {
    if (dc.current?.readyState === "open") { dc.current.send(JSON.stringify(ev)); tlog(`send ${ev.type}`, ev.type === "conversation.item.create" ? { role: (ev.item as { role?: string })?.role, len: JSON.stringify(ev.item).length } : undefined); }
    else tlog(`send.dropped ${ev.type}`, { dc: dc.current?.readyState ?? "none" });
  }, []);

  /** Tell the model the on-screen card changed (used by swipes while talking). */
  const inject = useCallback((text: string, speak = false) => {
    send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
    if (speak) send({ type: "response.create" });
  }, [send]);

  const runTool = useCallback(async (name: string, args: Record<string, unknown>, callId: string) => {
    let output: string;
    const t0 = Date.now();
    tlog(`tool.call ${name}`, args);
    try {
      if (name === "next_card") output = (await h.current.onNextCard?.()) ?? "No more cards in the feed right now.";
      else if (name === "react") output = (await h.current.onReact?.(args.kind as "like" | "skip" | "save")) ?? "Recorded.";
      else if (name === "show_repo") output = (await h.current.onShowRepo?.(String(args.id ?? ""))) ?? `Not in the corpus: ${String(args.id ?? "")}.`;
      else if (name === "search") output = (await h.current.onSearch?.(String(args.query ?? ""))) ?? "Search is unavailable.";
      else if (name === "open_result") output = (await h.current.onOpenResult?.(String(args.which ?? "1"))) ?? "Could not open that.";
      else {
        const r = await fetch("/api/voice/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args, current: h.current.currentId?.() ?? null }) });
        output = ((await r.json()) as { output?: string }).output ?? "No result.";
      }
    } catch (e) {
      const err = e as Error;
      tlog(`tool.throw ${name}`, { msg: err?.message, stack: (err?.stack ?? "").split("\n").slice(0, 4).join(" | ") });
      output = `That didn't work on my end (${err?.message ?? "error"}). Try again or ask something else.`;
    }
    tlog(`tool.done ${name}`, { ms: Date.now() - t0, out: output.slice(0, 160) });
    send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } });
    send({ type: "response.create" });
  }, [send]);

  const setMic = useCallback((on: boolean) => {
    const t = mic.current?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = on;
    tlog(`mic ${on ? "open" : "muted"}`);
    setMuted(!on);
  }, []);

  const onEvent = useCallback((ev: RTEvent) => {
    tlog(`ev ${ev.type}`, ev.type === "error" ? ev.error : ev.type === "response.done" ? summarizeResponse(ev) : undefined);
    try { handle(ev); } catch (e) { const err = e as Error; tlog("onEvent.throw", { type: ev.type, msg: err?.message, stack: (err?.stack ?? "").split("\n").slice(0, 5).join(" | ") }); }
    function handle(ev: RTEvent) {
    switch (ev.type) {
      case "session.created":
      case "session.updated":
        break;
      case "input_audio_buffer.speech_started":
        setState("listening"); bumpSilence(); break;
      case "input_audio_buffer.speech_stopped":
        setState("thinking"); bumpSilence(); break;
      case "response.created":
        setState("thinking"); break;
      case "response.output_audio.delta":
        setState("speaking"); bumpSilence(); break;
      case "output_audio_buffer.started":            // WebRTC only: audio has begun playing on the device
        setState("speaking"); speaking.current = true; bumpSilence(); break;
      case "output_audio_buffer.stopped":            // …and finished playing. THIS is when the model is done talking.
      case "output_audio_buffer.cleared":
        speaking.current = false; setState("listening"); bumpSilence();
        // The opening take has been heard in full: open the mic. (A manual unmute mid-take already cleared this.)
        if (autoMuted.current) { autoMuted.current = false; setMic(true); }
        break;
      case "response.output_audio_transcript.delta":
        setTranscript((t) => (t.length > 600 ? "" : t) + String(ev.delta ?? "")); break;
      case "response.output_audio_transcript.done":
        tlog("transcript", String(ev.transcript ?? "").slice(-200));   // tail: shows whether a take was cut off mid-sentence
        setTranscript(String(ev.transcript ?? "")); break;
      case "conversation.item.input_audio_transcription.completed":
        h.current.onUserTranscript?.(String(ev.transcript ?? "").trim()); break;
      case "response.done": {
        if (!speaking.current) setState("listening");
        bumpSilence();
        const resp = ev.response as { output?: { type: string; name?: string; arguments?: string; call_id?: string }[] } | undefined;
        for (const item of resp?.output ?? []) {
          if (item.type === "function_call" && item.name && item.call_id) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(item.arguments || "{}"); } catch { /* empty */ }
            void runTool(item.name, args, item.call_id);
          }
        }
        break;
      }
      case "error":
        console.error("[voice]", ev.error);
        setError(String((ev.error as { message?: string })?.message ?? "voice error"));
        break;
    }
    }
  }, [bumpSilence, runTool, setMic]);

  const start = useCallback(async (opts: VoiceStart) => {
    if (pc.current) return;
    setError(null); setTranscript("");
    setState("connecting");
    startedAt.current = Date.now();
    traceStart(opts.mode);
    tlog("start.opts", opts);
    try {
      // 1. Audio element must be created inside the user gesture (iOS autoplay policy).
      const el = document.createElement("audio");
      el.autoplay = true; el.setAttribute("playsinline", "");
      document.body.appendChild(el);
      audioEl.current = el;

      // 2. Mic + ephemeral secret in parallel.
      const [ms, sess] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
        fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts) }).then(async (r) => {
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `session ${r.status}`);
          return (await r.json()) as { secret: string };
        }),
      ]);
      mic.current = ms;
      tlog("mic+secret ok", { tracks: ms.getAudioTracks().map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted, settings: t.getSettings?.() })) });
      ms.getAudioTracks()[0]?.addEventListener("ended", () => tlog("mic.track.ended"));
      ms.getAudioTracks()[0]?.addEventListener("mute", () => tlog("mic.track.mute"));
      ms.getAudioTracks()[0]?.addEventListener("unmute", () => tlog("mic.track.unmute"));

      // 3. Peer connection.
      const p = new RTCPeerConnection();
      pc.current = p;
      p.ontrack = (e) => { tlog("pc.track", { kind: e.track.kind }); el.srcObject = e.streams[0]; meter(e.streams[0], ms); };
      el.addEventListener("play", () => tlog("audio.play"));
      el.addEventListener("pause", () => tlog("audio.pause"));
      el.addEventListener("error", () => tlog("audio.error", el.error?.message));
      p.addTrack(ms.getTracks()[0]);
      const d = p.createDataChannel("oai-events");
      dc.current = d;
      d.onmessage = (e) => { try { onEvent(JSON.parse(e.data) as RTEvent); } catch { /* ignore */ } };
      d.onopen = () => {
        tlog("dc.open");
        setState("listening");
        bumpSilence();
        // Both modes open with a line: card mode a 20 s take on the repo, search mode a one-sentence invitation.
        // Card mode: mic off for the take so it is not interruptible by room noise; released when the audio finishes.
        if (opts.mode === "card") { autoMuted.current = true; setMic(false); }
        send({ type: "response.create" });
      };
      d.onclose = () => { if (dc.current === d) stop("ended by server"); };
      d.onerror = (e) => tlog("dc.error", String((e as unknown as { error?: unknown }).error ?? e.type));
      d.onclose = () => tlog("dc.close");
      // "disconnected" is transient on mobile (radio handoff, screen lock); ICE usually recovers within seconds.
      // Only "failed" or "closed" is terminal; give "disconnected" 8 s to come back.
      let lost: ReturnType<typeof setTimeout> | null = null;
      p.onconnectionstatechange = () => {
        const st = p.connectionState;
        tlog(`pc ${st}`);
        if (st === "connected") { if (lost) { clearTimeout(lost); lost = null; } return; }
        if (st === "failed" || st === "closed") { if (pc.current === p) stop("connection lost"); return; }
        if (st === "disconnected" && !lost) lost = setTimeout(() => { if (pc.current === p && p.connectionState !== "connected") stop("connection lost"); }, 8_000);
      };
      p.oniceconnectionstatechange = () => tlog(`ice ${p.iceConnectionState}`);
      p.onicegatheringstatechange = () => tlog(`icegather ${p.iceGatheringState}`);
      p.onsignalingstatechange = () => tlog(`signaling ${p.signalingState}`);

      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", body: offer.sdp,
        headers: { Authorization: `Bearer ${sess.secret}`, "Content-Type": "application/sdp" },
      });
      if (!sdp.ok) {
        const body = await sdp.text().catch(() => "");
        let msg = `realtime ${sdp.status}`;
        try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? msg; } catch { if (body) msg = `${msg}: ${body.slice(0, 160)}`; }
        throw new Error(msg);
      }
      await p.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
      tlog("sdp.answer ok");
    } catch (e) {
      tlog("start.throw", { msg: (e as Error).message, name: (e as Error).name, stack: ((e as Error).stack ?? "").split("\n").slice(0, 4).join(" | ") });
      stop((e as Error).message === "Permission denied" || (e as Error).name === "NotAllowedError" ? "microphone blocked" : (e as Error).message);
      setState("error");
    }

    /** Level meter over both streams for the bars. */
    function meter(remote: MediaStream, local: MediaStream) {
      const ac = new AudioContext();
      ctx.current = ac;
      const mk = (s: MediaStream) => { const a = ac.createAnalyser(); a.fftSize = 256; ac.createMediaStreamSource(s).connect(a); return a; };
      const ar = mk(remote), al = mk(local);
      const buf = new Uint8Array(128);
      const rms = (a: AnalyserNode) => { a.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; } return Math.sqrt(s / buf.length); };
      const tick = () => { const l = rms(al), r = rms(ar); setLevel(Math.min(1, Math.max(r, l) * 4)); setMicLevel(Math.min(1, l * 4)); raf.current = requestAnimationFrame(tick); };
      tick();
    }
  }, [bumpSilence, onEvent, send, setMic, stop]);

  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => () => stopRef.current("unmount", { quiet: true }), []);

  useEffect(() => {
    const onVis = () => tlog(`page ${document.visibilityState}`);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const toggleMute = useCallback(() => {
    autoMuted.current = false;                     // a manual touch ends the automatic phase either way
    const t = mic.current?.getAudioTracks()[0];
    if (t) setMic(!t.enabled);
  }, [setMic]);

  return { state, level, micLevel, transcript, error, start, stop, inject, muted, toggleMute, active: state !== "idle" && state !== "error" };
}
