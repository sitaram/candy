"use client";
/**
 * Voice session trace. One timeline per session, in memory + localStorage, shipped to the server when
 * the session ends (or the page crashes / hides). This exists because the voice path is browser↔OpenAI
 * over WebRTC — nothing touches our server after the token mint — so without this the only evidence
 * of a failure is a console line on a phone that has already reloaded.
 *
 * What goes in: every state change, every data-channel event type (deltas collapsed to a count),
 * connection/ICE states, tool calls with args and outcome, handler exceptions, the stop reason.
 * What does not: audio, transcripts of what the user said (only their length).
 */

export interface TraceEntry { t: number; k: string; d?: unknown }
export interface Trace {
  id: string;
  mode: string;
  startedAt: number;
  endedAt?: number;
  reason?: string;
  ua: string;
  entries: TraceEntry[];
  deltas: Record<string, number>;   // collapsed counts of *.delta events
}

const KEY = "candy:voice:last";
const MAX = 400;
let cur: Trace | null = null;
let flushT: ReturnType<typeof setTimeout> | null = null;

export function traceStart(mode: string): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  cur = { id, mode, startedAt: Date.now(), ua: typeof navigator !== "undefined" ? navigator.userAgent : "", entries: [], deltas: {} };
  log("start", { mode, online: typeof navigator !== "undefined" ? navigator.onLine : null, vis: typeof document !== "undefined" ? document.visibilityState : null });
  return id;
}

export function log(k: string, d?: unknown): void {
  if (!cur) return;
  if (k.endsWith(".delta")) { cur.deltas[k] = (cur.deltas[k] ?? 0) + 1; return; }
  cur.entries.push({ t: Date.now() - cur.startedAt, k, d: d === undefined ? undefined : safe(d) });
  if (cur.entries.length > MAX) cur.entries.splice(0, cur.entries.length - MAX);
  if (process.env.NODE_ENV !== "production") console.info(`[voice +${((Date.now() - cur.startedAt) / 1000).toFixed(1)}s] ${k}`, d ?? "");
  persist();
}

export function traceEnd(reason: string): void {
  if (!cur) return;
  cur.endedAt = Date.now();
  cur.reason = reason;
  log("end", { reason, dur: Math.round((cur.endedAt - cur.startedAt) / 1000) });
  persist(true);
  void ship(cur);
  cur = null;
}

/** Wrap a handler so an exception becomes a trace entry + a spoken-length error string, never an unhandled throw. */
export function guarded<T extends unknown[]>(name: string, fn: (...a: T) => Promise<string | null | undefined>) {
  return async (...a: T): Promise<string | null> => {
    const t0 = Date.now();
    try {
      const out = await fn(...a);
      log(`tool.ok ${name}`, { ms: Date.now() - t0, out: typeof out === "string" ? out.slice(0, 120) : out });
      return out ?? null;
    } catch (e) {
      const err = e as Error;
      log(`tool.err ${name}`, { ms: Date.now() - t0, msg: err?.message, stack: (err?.stack ?? "").split("\n").slice(0, 4).join(" | ") });
      return `That didn't work on my end (${err?.message ?? "error"}). Try again or ask something else.`;
    }
  };
}

export function lastTrace(): Trace | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Trace) : null; } catch { return null; }
}

/* ---- internals ---- */

function persist(now = false): void {
  if (!cur) return;
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* quota */ } };
  if (now) { if (flushT) clearTimeout(flushT); flushT = null; write(); return; }
  if (flushT) return;
  flushT = setTimeout(() => { flushT = null; write(); }, 400);
}

async function ship(t: Trace): Promise<void> {
  try {
    const body = JSON.stringify(t);
    // sendBeacon survives page unload; fetch keepalive is the fallback.
    if (typeof navigator !== "undefined" && navigator.sendBeacon && navigator.sendBeacon("/api/voice/trace", new Blob([body], { type: "application/json" }))) return;
    await fetch("/api/voice/trace", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  } catch { /* best effort */ }
}

function safe(d: unknown): unknown {
  try { const s = JSON.stringify(d); return s.length > 600 ? JSON.parse(s.slice(0, 600) + (s.startsWith("{") ? '"…":1}' : "")) ?? s.slice(0, 600) : d; }
  catch { return String(d).slice(0, 300); }
}

// If the page dies mid-session (crash → reload, or backgrounded and killed), ship what we have.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { if (cur) { log("pagehide"); persist(true); void ship(cur); } });
  window.addEventListener("error", (e) => { if (cur) log("window.error", { msg: e.message, stack: (e.error?.stack ?? "").split("\n").slice(0, 5).join(" | ") }); });
  window.addEventListener("unhandledrejection", (e) => { if (cur) log("unhandledrejection", { msg: String(e.reason?.message ?? e.reason), stack: (e.reason?.stack ?? "").split("\n").slice(0, 5).join(" | ") }); });
}
