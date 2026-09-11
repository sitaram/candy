/** Embed every carded item that lacks a vector. Idempotent; safe to rerun after enrich. */
import { allItems } from "../src/lib/corpus/api";
import { cardText, embedTexts, hasEmbedding, putEmbeddings } from "../src/lib/embed";
import { closeRedis } from "../src/lib/store/redis";

const force = process.argv.includes("--force");
const items = (await allItems()).filter((it) => it.card);
const have = force ? new Set<string>() : await hasEmbedding(items.map((it) => it.repo.id));
const todo = items.filter((it) => !have.has(it.repo.id));
console.log(`carded ${items.length}, embedded ${have.size}, to embed ${todo.length}`);
const BATCH = 96;
let done = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  const vecs = await embedTexts(slice.map(cardText));
  await putEmbeddings(slice.map((it, j) => ({ id: it.repo.id, v: vecs[j] })));
  done += slice.length;
  process.stdout.write(`\r${done}/${todo.length}`);
}
console.log(`\nok · ~${Math.round(done * 120 / 1e6 * 0.02 * 1000) / 1000} USD`);
await closeRedis();
