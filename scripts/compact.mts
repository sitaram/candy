/**
 * Compact raw:* keys in place: bound releases/readme, gzip. Idempotent.
 * Usage: pnpm compact
 */
import { boundReleases, decodeRaw, encodeRaw, MAX_README } from "../src/lib/store/raw.ts";
import { closeRedis, redis } from "../src/lib/store/redis.ts";

const r = redis();
const keys: string[] = [];
let cur = "0";
do {
  const [n, b] = await r.scan(cur, "MATCH", "raw:*", "COUNT", 5000);
  cur = n;
  keys.push(...b);
} while (cur !== "0");

// Largest first so we regain headroom immediately if the DB is at maxmemory.
const sizes = (await r.pipeline(keys.map((k) => ["strlen", k])).exec())!.map((x) => Number(x[1]));
const order = keys.map((k, i) => [k, sizes[i]] as const).sort((a, b) => b[1] - a[1]);

let before = 0;
let after = 0;
let n = 0;
for (const [k] of order) {
  const buf = await r.getBuffer(k);
  if (!buf) continue;
  before += buf.length;
  const text = decodeRaw(buf);
  let out = text;
  if (k.endsWith(":releases")) {
    try {
      out = JSON.stringify(boundReleases(JSON.parse(text) as { body: string | null }[]));
    } catch {
      /* keep */
    }
  } else if (k.endsWith(":readme")) out = text.slice(0, MAX_README);
  else out = text.slice(0, 20_000);
  const enc = encodeRaw(out);
  after += enc.length;
  if (enc.length < buf.length) await r.set(k, enc);
  else after += 0;
  if (++n % 200 === 0) process.stdout.write(`\r${n}/${keys.length}`);
}
const mb = (x: number) => (x / 1048576).toFixed(1);
console.log(`\n${keys.length} raw keys: ${mb(before)} MB -> ${mb(after)} MB`);
const info = await r.info("memory");
console.log("used_memory now:", (info.match(/used_memory_human:(\S+)/) ?? [])[1]);
await closeRedis();
