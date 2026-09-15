"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { log as tlog, traceEnd, traceStart } from "@/lib/voice/trace";
import { api } from "./api";
import { connect, friendlyError, type RTEvent, type Transport, type VoiceStart } from "@/lib/voice/transport";
import { startMeter } from "@/lib/voice/meter";

/**
 * Realtime voice: the state machine over a call. The transport (lib/voice/transport) opens the
 * WebRTC connection; the meter (lib/voice/meter) drives the ring. This hook owns what the events
 * *mean* — listening / thinking / speaking — dispatches tool calls, and hangs up after 3 min with
 * neither party speaking.
 */

export type { VoiceStart };
export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "thinking" | "error";

export interface VoiceHandlers {
  /** Called for next_card / react — returns the brief of the card now on screen, or null if none. */
  onNextCard?: () => Promise<string | null>;
  onReact?: (kind: "like" | "skip" | "save") => Promise<string | null>;
  /** The card on screen, so server tools can default to it. */
  currentId?: () => string | null;
  /** Called for show_repo — insert the card on the rail and page to it; returns its brief, or null if not found. */
  onShowRepo?: (id: string) => Promise<string | null>;
  /** Search mode: run the query in the UI and return what the model should say from. */
  onSearch?: (query: string) => Promise<string | null>;
  /** Search mode: what the user said, once transcribed (fills the box). */
  onUserTranscript?: (text: string) => void;
  /** Search mode: user said open / show me the Nth one. */
  onOpenResult?: (which: string) => Promise<string | null>;
  /** Idle cutoff. Card conversations default to 3 min; search uses a shorter one. */
  silenceMs?: number;
}

const SILENCE_MS = 180_000;   // neither side has spoken for this long → hang up. Resets on user speech and on assistant audio.

/**
 * Tool args carry the user's words (search.query, ask_repo.question). The trace is shipped to the
 * server and kept 7 days per uid; it is for diagnosing the transport, not for reading what people
 * asked. Keep repo ids and enums (they are what the tool did), replace free text with its length.
 */
export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "query" || k === "question" || k === "text") out[k] = typeof v === "string" ? `[${v.length} chars]` : typeof v;
    else out[k] = v;
  }
  return out;
}

function summarizeResponse(ev: RTEvent): unknown {
  const r = ev.response as { status?: string; status_details?: unknown; output?: { type: string; name?: string }[]; usage?: { total_tokens?: number } } | undefined;
  return r ? { status: r.status, details: r.status_details, out: r.output?.map((o) => o.name ? `${o.type}:${o.name}` : o.type), tokens: r.usage?.total_tokens } : undefined;
}

export function useVoice(handlers: VoiceHandlers) {
  const [state, setStateRaw] = useState<VoiceState>("idle");
  const stateRef = useRef<VoiceState>("idle");
  const setState = useCallback((st: VoiceState) => { if (stateRef.current !== st) { tlog(`state ${stateRef.current}→${st}`); stateRef.current = st; } setStateRaw(st); }, []);
  const [level, setLevel] = useState(0);            // 0..1, whoever is louder (mic or model) — drives the button ring
  const [micLevel, setMicLevel] = useState(0);      // 0..1, you only — drives "hearing you"
  const [muted, setMuted] = useState(false);        // mic track disabled; the model hears silence
  const [transcript, setTranscript] = useState(""); // last thing the model said (for the sheet)
  const [error, setError] = useState<string | null>(null);

  const tr = useRef<Transport | null>(null);
  const stopMeter = useRef<(() => void) | null>(null);
  const silenceT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivity = useRef(0);
  const speaking = useRef(false);    // model audio is playing on the device right now
  const autoMuted = useRef(false);   // muted by us for the opening take; released when that audio finishes playing
  const connecting = useRef(false);
  const gen = useRef(0);             // per-start generation: a stale connect() must not adopt, meter, or stop() a newer session
  const base = useRef(handlers);
  base.current = handlers;
  // A surface that is temporarily on top (the search sheet) layers its tools over the owner's. Merged per call
  // so whichever is mounted answers; the owner's handlers stay underneath for next_card / react / show_repo.
  const overlay = useRef<VoiceHandlers | null>(null);
  const h = { get current(): VoiceHandlers { return overlay.current ? { ...base.current, ...overlay.current } : base.current; } };
  const setOverlay = useCallback((hs: VoiceHandlers | null) => { overlay.current = hs; }, []);
  const [mode, setMode] = useState<VoiceStart["mode"] | null>(null);
  const modeRef = useRef<VoiceStart["mode"] | null>(null);

  const stop = useCallback((reason?: string, opts?: { quiet?: boolean }) => {
    gen.current++;
    const t = tr.current;
    if (t || connecting.current) traceEnd(`${reason ?? "user"} · lastActivity ${Math.round((Date.now() - lastActivity.current) / 1000)}s ago · pc ${t?.pc.connectionState} · dc ${t?.dc.readyState}`);
    if (silenceT.current) clearTimeout(silenceT.current);
    silenceT.current = null;
    stopMeter.current?.(); stopMeter.current = null;
    t?.close(); tr.current = null; connecting.current = false;
    setLevel(0); setMicLevel(0); speaking.current = false; setMuted(false); autoMuted.current = false;
    modeRef.current = null; setMode(null);
    setState("idle");
    // A reason is a new error to show; a plain stop (user tapped end / "ok" on the toast) clears the old one.
    // Previously only start() cleared it, so "ended by server" stayed on screen until the next session.
    if (reason && !opts?.quiet) setError(reason); else if (!reason) setError(null);
  }, [setState]);

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

  const send = useCallback((ev: RTEvent) => { tr.current?.send(ev); }, []);

  /** Tell the model the on-screen card changed (used by swipes while talking). */
  const spokeDuringTool = useRef(false);   // set when something created a response while a tool call was running
  const inject = useCallback((text: string, speak = false) => {
    send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
    if (speak) { send({ type: "response.create" }); spokeDuringTool.current = true; }
  }, [send]);

  const setMic = useCallback((on: boolean) => { if (tr.current) { tr.current.setMic(on); setMuted(!on); } }, []);

  const runTool = useCallback(async (name: string, args: Record<string, unknown>, callId: string) => {
    let output: string;
    const t0 = Date.now();
    spokeDuringTool.current = false;
    tlog(`tool.call ${name}`, redactArgs(args));
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
    // open_result hands the session to a card via switchTo(…, speak:true), which already created a response;
    // a second response.create here is "conversation_already_has_active_response" → error toast.
    if (spokeDuringTool.current) { spokeDuringTool.current = false; return; }
    send({ type: "response.create" });
  }, [send]);

  const onEvent = useCallback((ev: RTEvent) => {
    tlog(`ev ${ev.type}`, ev.type === "error" ? ev.error : ev.type === "response.done" ? summarizeResponse(ev) : undefined);
    try { handle(ev); } catch (e) { const err = e as Error; tlog("onEvent.throw", { type: ev.type, msg: err?.message, stack: (err?.stack ?? "").split("\n").slice(0, 5).join(" | ") }); }
    function handle(ev: RTEvent) {
      switch (ev.type) {
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
          // The opening take was supposed to release the mic when its audio finished. If it produced no audio at all
          // (error, empty, cancelled), that never fires and the user sits muted with a button that says "Mute".
          if (autoMuted.current && !speaking.current) { autoMuted.current = false; setMic(true); }
          const rs = (ev.response as { status?: string; status_details?: { reason?: string } } | undefined);
          if (rs?.status === "incomplete") tlog("response.incomplete", rs.status_details);
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
  }, [bumpSilence, runTool, setMic, setState]);

  const start = useCallback(async (opts: VoiceStart) => {
    if (tr.current || connecting.current) return;
    connecting.current = true;
    const my = ++gen.current;
    const stale = () => gen.current !== my;
    setError(null); setTranscript("");
    setState("connecting");
    traceStart(opts.mode);
    tlog("start.opts", opts);
    modeRef.current = opts.mode; setMode(opts.mode);
    // The transport calls back (onOpen, onLost) possibly before connect() resolves, so it hands itself over
    // in onOpen and we adopt it there. `mine` is the one we adopted; anything else is a stale call.
    let mine: Transport | null = null;
    const adopt = (t: Transport) => {
      if (mine) return;
      mine = t;
      // stop() may have run while we were connecting (user tapped again, unmount), or a newer start() may have
      // taken over: a call nobody wants.
      if (!connecting.current || stale()) { t.close(); return; }
      tr.current = t;
      connecting.current = false;
    };
    try {
      const t = await connect(opts, {
        onEvent,
        onTrack: (remote, local) => {
          if (stale()) return;   // a stale transport's meter (AudioContext + rAF) would otherwise run until the next stop()
          stopMeter.current?.();
          stopMeter.current = startMeter(remote, local, (l) => { setLevel(l.mixed); setMicLevel(l.local); });
        },
        onOpen: (t) => {
          adopt(t);
          if (tr.current !== t) return;
          setState("listening");
          bumpSilence();
          // Both modes open with a line: card mode a 20 s take on the repo, search mode a one-sentence invitation.
          // Card mode: mic off for the take so it is not interruptible by room noise; released when the audio finishes.
          if (opts.mode === "card" || opts.mode === "doc") { autoMuted.current = true; setMic(false); }
          send({ type: "response.create" });
        },
        onLost: (why) => { if (!stale() && mine && tr.current === mine) stop(why); },
      });
      adopt(t);
    } catch (e) {
      tlog("start.throw", { msg: (e as Error).message, name: (e as Error).name, stack: ((e as Error).stack ?? "").split("\n").slice(0, 4).join(" | ") });
      if (stale()) return;   // an orphaned attempt failing must not tear down the session that replaced it
      stop(friendlyError(e));
      setState("error");
    }
  }, [bumpSilence, onEvent, send, setMic, setState, stop]);

  /**
   * Move the live conversation to another surface without hanging up: fetch that surface's instructions
   * and tools, send session.update, tell the model what just happened, and (optionally) have it speak.
   * Same connection, same mic, same memory — the model still knows what the user asked a moment ago.
   * Idle → plain start(). Concurrent switches: the last one wins.
   */
  const switchSeq = useRef(0);
  const switchTo = useCallback(async (opts: VoiceStart, say?: { note: string; speak: boolean }) => {
    if (!tr.current) {
      if (!connecting.current) { await start(opts); return; }
      // Still connecting: wait for the channel rather than dropping the switch (and its note) on the floor.
      const t0 = Date.now();
      while (!tr.current && connecting.current && Date.now() - t0 < 8_000) await new Promise((r) => setTimeout(r, 100));
      if (!tr.current) { tlog("switch.dropped", { to: opts.mode, reason: "never connected" }); return; }
    }
    const my = ++switchSeq.current;
    const from = modeRef.current;
    tlog("switch", { from, to: opts });
    // Mode flips at once, not when the update lands: a surface unmounting on the same tick reads it to decide
    // whether the session is still its own to end.
    modeRef.current = opts.mode; setMode(opts.mode);
    try {
      const m = await api<{ instructions: string; tools: unknown[]; maxOutputTokens: number }>("/api/voice/context", { method: "POST", body: opts });
      if (my !== switchSeq.current || !tr.current) { tlog("switch.stale"); return; }
      send({ type: "session.update", session: { type: "realtime", instructions: m.instructions, tools: m.tools, tool_choice: "auto", max_output_tokens: m.maxOutputTokens } });
      if (say) inject(say.note, say.speak);
      tlog("switch.ok", { to: opts.mode });
    } catch (e) {
      tlog("switch.throw", { msg: (e as Error).message });
      // The old instructions still apply; say so, so the UI doesn't claim a mode the session isn't in.
      if (my === switchSeq.current) { modeRef.current = from; setMode(from); }
    }
  }, [inject, send, start]);

  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => () => stopRef.current("unmount", { quiet: true }), []);

  useEffect(() => {
    const onVis = () => tlog(`page ${document.visibilityState}`);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const toggleMute = useCallback(() => {
    autoMuted.current = false;                     // a manual touch ends the automatic phase either way
    if (tr.current) setMic(!tr.current.micEnabled());
  }, [setMic]);

  return { state, mode, level, micLevel, transcript, error, start, stop, switchTo, setOverlay, inject, muted, toggleMute, active: state !== "idle" && state !== "error" };
}
