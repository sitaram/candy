/**
 * LLM-enrich corpus repos that lack a card (or whose README changed).
 * Usage: pnpm enrich [n=50] [concurrency=4]
 * Model: CANDY_MODEL env (default claude-haiku-4-5-20251001)
 */
import { enrich } from "../src/lib/enrich/index.ts";
import { MODEL } from "../src/lib/enrich/llm.ts";
import { closeRedis } from "../src/lib/store/redis.ts";

const n = Number(process.argv[2] ?? 50);
const conc = Number(process.argv[3] ?? 4);
console.log(`model ${MODEL}\n`);

const t0 = Date.now();
const s = await enrich(n, conc);
// Haiku 4.5 list price: $1/M in, $5/M out. Adjust if you switch models.
const cost = (s.inputTokens * 1 + s.outputTokens * 5) / 1e6;
console.log(`\ndone ${s.done}  failed ${s.failed}  tokens in ${s.inputTokens} out ${s.outputTokens}  ≈$${cost.toFixed(3)}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await closeRedis();
