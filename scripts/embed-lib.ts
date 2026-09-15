import { allItems } from "../src/lib/corpus/api";
import { cardText, embedTexts, hasEmbedding, putEmbeddings } from "../src/lib/embed";

/** Embed every carded item without a vector. Returns how many were embedded. OpenAI: 128/batch, no pacing needed. */
export async function embedMissing(): Promise<number> {
  const items = (await allItems()).filter((it) => it.card);
  const have = await hasEmbedding(items.map((it) => it.repo.id));
  const todo = items.filter((it) => !have.has(it.repo.id));
  for (let i = 0; i < todo.length; i += 128) {
    const slice = todo.slice(i, i + 128);
    const vecs = await embedTexts(slice.map(cardText));
    await putEmbeddings(slice.map((it, j) => ({ id: it.repo.id, v: vecs[j] })));
  }
  return todo.length;
}
