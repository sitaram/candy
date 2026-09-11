/** Embed every carded item that lacks a vector. Idempotent; safe to rerun after enrich. */
import { allItems } from "../src/lib/corpus/api";
import { cardText, dot, embedTexts, getEmbeddings, hasEmbedding, putEmbeddings } from "../src/lib/embed";
import { closeRedis } from "../src/lib/store/redis";

const force = process.argv.includes("--force");
const items = (await allItems()).filter((it) => it.card);
const have = force ? new Set<string>() : await hasEmbedding(items.map((it) => it.repo.id));
const todo = items.filter((it) => !have.has(it.repo.id));
console.log(`carded ${items.length}, embedded ${have.size}, to embed ${todo.length}`);
// Voyage without a card on file: 3 requests/min, 10K tokens/min. A card is ~120 tokens, so
// ~60 cards per request keeps a batch under 8K tokens; one request every 21s stays under both caps.
// With a card on file, pass --fast for 128/batch and no pacing.
const fast = process.argv.includes("--fast");
const BATCH = fast ? 128 : 60;
const GAP_MS = fast ? 0 : 21_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let done = 0;
const t0 = Date.now();
for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  let vecs: Float32Array[] | null = null;
  for (let attempt = 0; attempt < 5 && !vecs; attempt++) {
    try { vecs = await embedTexts(slice.map(cardText)); }
    catch (e) {
      if (!String(e).includes("429") || attempt === 4) throw e;
      process.stdout.write(`\r429 · backing off ${30 * (attempt + 1)}s          `);
      await sleep(30_000 * (attempt + 1));
    }
  }
  await putEmbeddings(slice.map((it, j) => ({ id: it.repo.id, v: vecs![j] })));
  done += slice.length;
  const eta = Math.round(((todo.length - done) / BATCH) * GAP_MS / 1000);
  process.stdout.write(`\r${done}/${todo.length}${eta ? ` · ~${eta}s left` : ""}          `);
  if (i + BATCH < todo.length && GAP_MS) await sleep(GAP_MS);
}
console.log(`\n${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`\nok · ~${Math.round(done * 120 / 1000)}k tokens (free tier: 200M)`);

// Calibration: where do pairwise cosines sit? tasteFit() centers on the corpus mean — read the
// p50 below and set CENTER in rank.ts if it drifts from the current constant.
const vecs = [...(await getEmbeddings(items.map((it) => it.repo.id))).values()];
const sample: number[] = [];
for (let i = 0; i < 3000; i++) {
  const a = vecs[Math.floor(Math.random() * vecs.length)], b = vecs[Math.floor(Math.random() * vecs.length)];
  if (a !== b) sample.push(dot(a, b));
}
sample.sort((x, y) => x - y);
const q = (p: number) => sample[Math.floor(p * (sample.length - 1))].toFixed(3);
console.log(`pairwise cosine  p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}   (tasteFit centers on p50; 1.0 at ~p99)`);
await closeRedis();
