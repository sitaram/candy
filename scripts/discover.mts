/**
 * Run all discoverers (or a subset), write to frontier.
 * Usage: pnpm discover [github|hn|lobsters|rss|awesome ...]
 */
import { discoverers } from "../src/lib/discover/index.ts";
import { discover, stats } from "../src/lib/store/corpus.ts";
import { closeRedis } from "../src/lib/store/redis.ts";

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(discoverers);

for (const name of names) {
  const fn = discoverers[name];
  if (!fn) {
    console.error(`unknown discoverer: ${name}`);
    continue;
  }
  const t0 = Date.now();
  try {
    const hits = await fn();
    const uniq = await discover(hits);
    console.log(`${name.padEnd(10)} ${String(hits.length).padStart(5)} hits  ${String(uniq).padStart(5)} repos  ${Date.now() - t0}ms`);
  } catch (e) {
    console.error(`${name.padEnd(10)} FAILED: ${(e as Error).message}`);
  }
}

console.log("\n", await stats());
await closeRedis();
