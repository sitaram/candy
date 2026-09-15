/**
 * Read the error ring buffer.
 *   pnpm errors            last 40, one line each
 *   pnpm errors top        today's fingerprints by count
 *   pnpm errors <n>        full record n (0 = newest)
 */
import { closeRedis, redis } from "../src/lib/store/redis";
import type { ErrorRecord } from "../src/lib/errors";
const r = redis(); const arg = process.argv[2];
const dev = (ua = "") => ua.includes("iPhone") ? "iPhone" : ua.includes("Android") ? "Android" : ua ? "desktop" : "server";
if (arg === "top") {
  const day = new Date().toISOString().slice(0, 10);
  const h = await r.hgetall(`err:count:${day}`);
  for (const [k, n] of Object.entries(h).sort((a, b) => Number(b[1]) - Number(a[1]))) console.log(`${String(n).padStart(5)}  ${k}`);
  if (!Object.keys(h).length) console.log("none today");
} else if (arg !== undefined) {
  const raw = await r.lindex("err:log", Number(arg));
  if (!raw) console.log("no such record"); else { const e = JSON.parse(raw) as ErrorRecord; console.log(`${new Date(e.at).toISOString()} ${e.side} ${e.where}${e.rid ? ` rid=${e.rid}` : ""}${e.status ? ` ${e.status}` : ""}\nuid=${e.uid ?? "-"} ${e.url ?? ""} ${dev(e.ua)}\n\n${e.msg}\n\n${e.stack ?? ""}${e.extra ? `\n\nextra: ${e.extra}` : ""}`); }
} else {
  const rows = await r.lrange("err:log", 0, 39);
  if (!rows.length) console.log("no errors recorded");
  rows.forEach((raw, i) => { const e = JSON.parse(raw) as ErrorRecord; console.log(`${String(i).padStart(3)}  ${new Date(e.at).toISOString().slice(5, 19)}  ${e.side.padEnd(6)} ${dev(e.ua).padEnd(7)} ${e.where.padEnd(22).slice(0, 22)} ${(e.rid ?? "").padEnd(8)} ${e.msg.split("\n")[0].slice(0, 90)}`); });
}
await closeRedis();
