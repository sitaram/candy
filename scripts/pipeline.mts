/**
 * Background pipeline loop. Run once and forget; product work never waits on it.
 *   pnpm pipeline            # loop forever
 *   pnpm pipeline --once     # one cycle
 *
 * Each cycle: discover (if > DISCOVER_EVERY_MIN since last) -> crawl CRAWL_PER_CYCLE -> enrich ENRICH_PER_CYCLE.
 * Budgets via env: CRAWL_PER_CYCLE=100 ENRICH_PER_CYCLE=50 CYCLE_MIN=10 DISCOVER_EVERY_MIN=60 LLM_USD_PER_DAY=5
 */
import { appendFile, mkdir } from "node:fs/promises";
import { crawl } from "../src/lib/crawl/index.ts";
import { discoverers } from "../src/lib/discover/index.ts";
import { enrich } from "../src/lib/enrich/index.ts";
import { discover, stats } from "../src/lib/store/corpus.ts";
import { closeRedis, redis } from "../src/lib/store/redis.ts";

const env = (k: string, d: number) => Number(process.env[k] ?? d);
const CRAWL_PER_CYCLE = env("CRAWL_PER_CYCLE", 100);
const ENRICH_PER_CYCLE = env("ENRICH_PER_CYCLE", 50);
const CYCLE_MIN = env("CYCLE_MIN", 10);
const DISCOVER_EVERY_MIN = env("DISCOVER_EVERY_MIN", 60);
const LLM_USD_PER_DAY = env("LLM_USD_PER_DAY", 5);
const once = process.argv.includes("--once");

await mkdir("logs", { recursive: true });
const log = async (s: string) => {
  const line = `${new Date().toISOString()} ${s}`;
  console.log(line);
  await appendFile("logs/pipeline.log", line + "\n");
};

const r = redis();
const todayKey = () => `budget:llm:${new Date().toISOString().slice(0, 10)}`;

async function cycle(): Promise<void> {
  const last = Number((await r.get("pipeline:lastDiscover")) ?? 0);
  if (Date.now() - last > DISCOVER_EVERY_MIN * 60_000) {
    for (const [name, fn] of Object.entries(discoverers)) {
      try {
        const hits = await fn();
        const n = await discover(hits);
        await log(`discover ${name}: ${n} repos`);
      } catch (e) {
        await log(`discover ${name} FAILED: ${(e as Error).message}`);
      }
    }
    await r.set("pipeline:lastDiscover", Date.now());
  }

  const c = await crawl(CRAWL_PER_CYCLE, 6, () => {});
  await log(`crawl: fetched ${c.fetched} missing ${c.missing} failed ${c.failed} +frontier ${c.newlyDiscovered}${c.rateLimitedUntil ? ` RATE-LIMITED until ${new Date(c.rateLimitedUntil).toLocaleTimeString()}` : ""}`);

  const spent = Number((await r.get(todayKey())) ?? 0);
  if (spent < LLM_USD_PER_DAY) {
    const e = await enrich(ENRICH_PER_CYCLE, 6, () => {});
    const usd = (e.inputTokens * 1 + e.outputTokens * 5) / 1e6;
    await r.incrbyfloat(todayKey(), usd);
    await r.expire(todayKey(), 3 * 86_400);
    await log(`enrich: ${e.done} cards, ${e.failed} failed, $${usd.toFixed(3)} (today $${(spent + usd).toFixed(2)} / $${LLM_USD_PER_DAY})`);
  } else {
    await log(`enrich: skipped, daily budget $${LLM_USD_PER_DAY} reached`);
  }

  await log(`stats ${JSON.stringify(await stats())}`);
}

do {
  try {
    await cycle();
  } catch (e) {
    await log(`cycle FAILED: ${(e as Error).message}`);
  }
  if (!once) await new Promise((res) => setTimeout(res, CYCLE_MIN * 60_000));
} while (!once);

await closeRedis();
