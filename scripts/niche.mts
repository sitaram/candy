/**
 * Build a niche collection: seeds + topics + awesome lists -> frontier (boosted) -> crawl -> tag as collection.
 * Usage: pnpm niche voice [--enrich N]
 * Reads niches/<name>.json
 */
import { readFile } from "node:fs/promises";
import { invalidate } from "../src/lib/corpus/api";
import { crawl } from "../src/lib/crawl/index.ts";
import { discoverAwesome } from "../src/lib/discover/awesome.ts";
import { discoverTopics } from "../src/lib/discover/topics.ts";
import { enrich } from "../src/lib/enrich/index.ts";
import { addToCollection, collectionMembers } from "../src/lib/store/collections.ts";
import { discover } from "../src/lib/store/corpus.ts";
import { K, normId } from "../src/lib/store/keys.ts";
import { closeRedis, redis } from "../src/lib/store/redis.ts";

const name = process.argv[2];
if (!name) throw new Error("usage: pnpm niche <name>");
const enrichN = Number(process.argv[process.argv.indexOf("--enrich") + 1] || 0) || 0;

interface Niche { name: string; description: string; topics: string[]; awesome: string[]; seeds: string[]; minStars: number; crawl: number }
const n = JSON.parse(await readFile(`niches/${name}.json`, "utf8")) as Niche;
const r = redis();
const t0 = Date.now();

// 1. Seeds: strong boost so they crawl first.
await discover(n.seeds.map((repo) => ({ repo, source: `niche:${name}`, weight: 20 })));
console.log(`seeds      ${n.seeds.length}`);

// 2. Topics.
const th = await discoverTopics(n.topics, n.minStars);
await discover(th.map((d) => ({ ...d, weight: d.weight + 5 })));
console.log(`topics     ${th.length} hits from ${n.topics.length} topics`);

// 3. Awesome lists.
const ah = await discoverAwesome(n.awesome);
await discover(ah.map((d) => ({ ...d, weight: 3 })));
console.log(`awesome    ${ah.length} hits`);

// Everything touched is a candidate member.
const candidates = new Set([...n.seeds, ...th.map((d) => d.repo), ...ah.map((d) => d.repo)].map(normId));
await addToCollection(name, Array.from(candidates), { description: n.description, seeds: n.seeds });
console.log(`candidates ${candidates.size} tagged collection:${name}`);

// 4. Crawl the top of the frontier; niche items dominate it because of the boosts.
const c = await crawl(n.crawl, 8, () => {});
console.log(`crawl      fetched ${c.fetched} missing ${c.missing} failed ${c.failed} +frontier ${c.newlyDiscovered}`);

// 5. Second hop: repos linked from >=2 niche members join too. One link is not evidence
// (every ML repo links to pytorch); two independent members linking is.
const members = await collectionMembers(name);
const inCorpus = (await r.smismember(K.corpus, ...members)).map((v, i) => (v ? members[i] : null)).filter((x): x is string => !!x);
const linkCount = new Map<string, number>();
for (const id of inCorpus) for (const l of await r.smembers(K.edges(id, "links"))) linkCount.set(l, (linkCount.get(l) ?? 0) + 1);
const memberSet = new Set(members);
const hop2 = Array.from(linkCount.entries()).filter(([id, c]) => c >= 2 && !memberSet.has(id)).map(([id]) => id);
const hop2InCorpus = hop2.length ? (await r.smismember(K.corpus, ...hop2)).map((v, i) => (v ? hop2[i] : null)).filter((x): x is string => !!x) : [];
await addToCollection(name, hop2InCorpus);
console.log(`hop-2      +${hop2InCorpus.length} repos linked by >=2 members joined collection`);

// 6. Optional enrich of collection members lacking cards.
if (enrichN) {
  const e = await enrich(enrichN, 6, () => {}, new Set(await collectionMembers(name)));
  console.log(`enrich     ${e.done} cards ≈$${((e.inputTokens + e.outputTokens * 5) / 1e6).toFixed(2)}`);
}

const final = await collectionMembers(name);
const finalInCorpus = (await r.smismember(K.corpus, ...final)).filter(Boolean).length;
console.log(`\ncollection:${name}  ${final.length} members, ${finalInCorpus} in corpus  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await invalidate();   // rebuild the read snapshot every process serves from
await closeRedis();
