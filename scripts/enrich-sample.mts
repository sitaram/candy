/** Enrich a hand-picked slice: the newest repos (created <14d). Usage: pnpm tsx scripts/enrich-sample.mts [n] */
import { corpusIds, getRepos, getMentions } from "../src/lib/store/corpus.ts";
import { getCards, saveCard } from "../src/lib/enrich/index.ts";
import { enrichOne } from "../src/lib/enrich/llm.ts";
import { K } from "../src/lib/store/keys.ts";
import { closeRedis, redis } from "../src/lib/store/redis.ts";

const n = Number(process.argv[2] ?? 15);
const ids = await corpusIds();
const repos = await getRepos(ids);
const cards = await getCards(ids);
const fresh = repos
  .filter((r) => Date.now() - Date.parse(r.createdAt) < 14 * 86_400_000 && !cards.has(r.id))
  .sort((a, b) => b.starsPerDay - a.starsPerDay)
  .slice(0, n);
const r = redis();
let tin = 0, tout = 0;
for (const repo of fresh) {
  const [readme, rel, men] = await Promise.all([r.get(K.raw(repo.id, "readme")), r.get(K.raw(repo.id, "releases")), getMentions(repo.id)]);
  const e = await enrichOne(repo, readme ?? "", rel ? JSON.parse(rel) : [], men);
  await saveCard(repo.id, e.card, { readmeHash: repo.readmeHash, model: e.model, enrichedAt: new Date().toISOString(), inputTokens: e.inputTokens, outputTokens: e.outputTokens });
  tin += e.inputTokens; tout += e.outputTokens;
  const fl = e.card.flags.length ? `  ⚑ ${e.card.flags.join(",")}` : "";
  console.log(`${String(e.card.interest).padStart(2)}  ${repo.id.padEnd(40)} ${String(repo.stars).padStart(6)}★ ${e.card.category.padEnd(16)} ${e.card.maturity.padEnd(10)} ${e.card.hook.padEnd(14)}${fl}\n      ${e.card.pitch}\n      → ${e.card.whyCare}`);
}
console.log(`\n${fresh.length} cards  ≈$${((tin + tout * 5) / 1e6).toFixed(3)}`);
await closeRedis();
