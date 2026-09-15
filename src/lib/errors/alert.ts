/**
 * The one way the app pages a person. A webhook (Slack / Discord / anything that takes `{ text }`),
 * throttled per kind per hour in Redis, so a bad night is one message an hour, not one per request.
 *
 * Fired by: the spend cap refusing, an error fingerprint crossing ERR_SPIKE in a day, Redis coming back
 * after failing. Unset CANDY_ALERT_WEBHOOK → console only. Fire-and-forget; an alert must never delay
 * or fail the request that raised it.
 */
import { redis } from "@/lib/store/redis";

export const ERR_SPIKE = 25;
const HOUR = 3_600;

export type AlertKind = "spend-cap" | "error-spike" | "redis-down";

export function alert(kind: AlertKind, text: string, dedupeKey: string = kind): void {
  void (async () => {
    try {
      const ok = await redis().set(`alert:${dedupeKey}`, "1", "EX", HOUR, "NX");
      if (!ok) return;                                   // already sent this hour
    } catch { /* Redis down: still try to send, once per process per minute */ if (!localGate()) return; }
    const line = `[candy] ${kind}: ${text}`;
    console.warn("[alert]", line);
    const url = process.env.CANDY_ALERT_WEBHOOK;
    if (!url) return;
    try {
      await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: line }), signal: AbortSignal.timeout(5_000) });
    } catch (e) { console.warn("[alert] webhook failed", (e as Error).message); }
  })();
}

let lastLocal = 0;
function localGate(): boolean { const now = Date.now(); if (now - lastLocal < 60_000) return false; lastLocal = now; return true; }
