"use client";
/**
 * Ship a client error to POST /api/err. sendBeacon when available (survives unload), keepalive fetch
 * otherwise. Deduped per page load by fingerprint so a render loop cannot post 400 times; capped at
 * 20 per load regardless. Never throws, never logs on failure (that would be recursive).
 */
const seen = new Set<string>();
let sent = 0;

export function ship(e: { where: string; msg: string; stack?: string; rid?: string; status?: number; extra?: unknown }): void {
  if (typeof window === "undefined") return;
  const fp = `${e.where}:${e.msg.split("\n")[0].replace(/\d+/g, "#").slice(0, 100)}`;
  if (seen.has(fp) || sent >= 20) return;
  seen.add(fp); sent++;
  const body = JSON.stringify({
    where: e.where.slice(0, 80),
    msg: e.msg.slice(0, 600),
    stack: e.stack ? e.stack.split("\n").slice(0, 10).join("\n").slice(0, 3000) : undefined,
    rid: e.rid, status: e.status,
    url: location.pathname + location.search,
    extra: e.extra,
  });
  try {
    if (navigator.sendBeacon?.("/api/err", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through */ }
  fetch("/api/err", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}
