/** Corpus overview. Usage: pnpm stats */
import { K } from "../src/lib/store/keys.ts";
import { corpusIds, getRepos, stats } from "../src/lib/store/corpus.ts";
import { closeRedis, redis } from "../src/lib/store/redis.ts";

const r = redis();
console.log(await stats());

const ids = await corpusIds();
const repos = await getRepos(ids);

const count = (f: (x: (typeof repos)[number]) => string | undefined) => {
  const m = new Map<string, number>();
  for (const x of repos) {
    const k = f(x) || "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
};

console.log("\nlanguages ", count((x) => x.language));
console.log("licenses  ", count((x) => x.license));
console.log("manifests ", count((x) => x.manifestKind));
console.log("with readme", repos.filter((x) => x.readmeLen > 0).length, "/", repos.length);
console.log("with release", repos.filter((x) => x.releaseCount > 0).length);
console.log("released <7d", repos.filter((x) => x.latestReleaseAt && Date.now() - Date.parse(x.latestReleaseAt) < 7 * 86_400_000).length);

const top = await r.zrevrange(K.frontier, 0, 14, "WITHSCORES");
console.log("\nfrontier top:");
for (let i = 0; i < top.length; i += 2) console.log(`  ${top[i + 1].padStart(6)}  ${top[i]}`);

const edges = await r.keys("edges:*:links");
console.log("\nrepos with link edges:", edges.length);
const awesome = await r.keys("awesome:*");
console.log("awesome lists loaded:", awesome.length);

console.log("\nfastest growing (stars/day):");
for (const x of [...repos].sort((a, b) => b.starsPerDay - a.starsPerDay).slice(0, 8))
  console.log(`  ${String(x.starsPerDay).padStart(7)}  ${x.id.padEnd(45)} ${x.stars}★`);

await closeRedis();
