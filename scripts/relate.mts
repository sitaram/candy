/** Label related-project groups for carded repos that lack them. Idempotent. pnpm relate [n=100] [concurrency=4] [--force] */
import { allItems } from "../src/lib/corpus/api";
import { hasRelated, neighbors, putRelated } from "../src/lib/corpus/related";
import { relateOne } from "../src/lib/enrich/relate";
import { closeRedis } from "../src/lib/store/redis";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const n = Number(args[0] ?? 100), conc = Number(args[1] ?? 4), force = process.argv.includes("--force");
const items = (await allItems()).filter((it) => it.card).sort((a, b) => b.repo.stars - a.repo.stars);
const have = force ? new Set<string>() : await hasRelated(items.map((it) => it.repo.id));
const todo = items.filter((it) => !have.has(it.repo.id)).slice(0, n);
console.log(`carded ${items.length} · labelled ${have.size} · doing ${todo.length} @${conc}`);
let done = 0, tokens = 0, skipped = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: conc }, async () => {
  while (todo.length) {
    const it = todo.shift()!;
    try {
      const ns = await neighbors(it.repo.id, 20);
      if (ns.length < 2) { skipped++; continue; }
      const r = await relateOne(it, ns);
      await putRelated(it.repo.id, r.groups, r.model);
      tokens += r.tokens; done++;
      process.stdout.write(`\r${done}/${done + todo.length}  ${it.repo.id.padEnd(40)} ${r.groups.map((g) => `"${g.label}"(${g.ids.length})`).join(" · ").slice(0, 90)}   `);
    } catch (e) { console.error(`\n${it.repo.id}: ${(e as Error).message}`); }
  }
}));
console.log(`\n${done} labelled, ${skipped} too few neighbours, ${tokens} tokens, ${Math.round((Date.now() - t0) / 1000)}s`);
await closeRedis();
