/**
 * Read voice session traces shipped to Redis.
 *   pnpm voice:trace              latest trace from every user, one line each
 *   pnpm voice:trace <uidprefix>  full timeline of that user's latest trace
 *   pnpm voice:trace <uidprefix> <n>   their n-th most recent
 */
import { closeRedis, redis } from "../src/lib/store/redis";
const r = redis();
const [pref, nth] = process.argv.slice(2);
let cursor = "0"; const lists: string[] = [];
do { const [c, k] = await r.scan(cursor, "MATCH", "vt:*", "COUNT", 1000); cursor = c; lists.push(...k.filter((x) => x.split(":").length === 2)); } while (cursor !== "0");
type T = { id: string; mode: string; startedAt: number; endedAt?: number; reason?: string; ua: string; entries: { t: number; k: string; d?: unknown }[]; deltas: Record<string, number> };
const fmt = (ms: number) => `+${(ms / 1000).toFixed(1).padStart(6)}s`;
if (!pref) {
  for (const l of lists) {
    const uid = l.slice(3); const id = (await r.lindex(l, 0))!; const raw = await r.get(`vt:${uid}:${id}`); if (!raw) continue;
    const t = JSON.parse(raw) as T;
    const bad = t.entries.filter((e) => /throw|error|dropped|window\.|unhandled/.test(e.k)).length;
    console.log(`${uid.slice(0, 8)}  ${new Date(t.startedAt).toISOString().slice(5, 19)}  ${t.mode.padEnd(6)} ${String(t.endedAt ? Math.round((t.endedAt - t.startedAt) / 1000) : "?").padStart(4)}s  ${(t.reason ?? "NO END").slice(0, 40).padEnd(40)} ${bad ? `⚠ ${bad} errors` : ""}  ${t.ua.includes("iPhone") ? "iPhone" : t.ua.includes("Android") ? "Android" : "desktop"}`);
  }
} else {
  const l = lists.find((x) => x.slice(3).startsWith(pref)); if (!l) { console.log("no such user"); process.exit(1); }
  const id = await r.lindex(l, Number(nth ?? 0)); const raw = id && await r.get(`${l}:${id}`); if (!raw) { console.log("no trace"); process.exit(1); }
  const t = JSON.parse(raw) as T;
  console.log(`${t.mode} · ${new Date(t.startedAt).toISOString()} · ${t.endedAt ? Math.round((t.endedAt - t.startedAt) / 1000) + "s" : "no end"} · ${t.reason ?? "NO END REASON"}\n${t.ua}\ndeltas: ${Object.entries(t.deltas).map(([k, n]) => `${k}×${n}`).join("  ")}\n`);
  for (const e of t.entries) console.log(`${fmt(e.t)}  ${e.k}${e.d !== undefined ? "  " + JSON.stringify(e.d) : ""}`);
}
await closeRedis();
