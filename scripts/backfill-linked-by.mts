/**
 * One-off: write edges:{id}:linked-by from every existing edges:*:links set. addEdges now keeps the reverse
 * edge current, but the ~3.5k links written before that need catching up.  pnpm tsx scripts/backfill-linked-by.mts
 */
import { closeRedis, redis } from "../src/lib/store/redis";
const r = redis();
let cursor = "0", sets = 0, edges = 0;
do {
  const [c, keys] = await r.scan(cursor, "MATCH", "edges:*:links", "COUNT", 500); cursor = c;
  for (const k of keys) {
    const from = k.slice("edges:".length, -":links".length);
    const to = await r.smembers(k);
    if (!to.length) continue;
    const p = r.pipeline();
    for (const t of to) p.sadd(`edges:${t}:linked-by`, from);
    await p.exec(); sets++; edges += to.length;
  }
} while (cursor !== "0");
console.log(`linked-by: ${edges} reverse edges from ${sets} link sets`);
await closeRedis();
