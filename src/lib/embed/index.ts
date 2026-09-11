/**
 * Embeddings: one vector per card, one taste vector per user.
 *
 * emb:{id}          Buffer   Float32 x DIM, the card's text embedding (offline)
 * u:{uid}:taste     Buffer   Float32 x DIM, running weighted mean of reacted cards (online)
 * u:{uid}:tastew    STRING   total |weight| behind the taste vector
 *
 * The term-vector profile stays the source of *reasons*; this is the source of *score*.
 * Provider is picked from env: OPENAI_API_KEY → text-embedding-3-small at 512 dims (the model
 * supports Matryoshka truncation, so 512 keeps Redis small at almost no quality cost; ~$0.002
 * for the whole corpus). Else VOYAGE_API_KEY → voyage-3-lite, also 512. Same DIM either way,
 * but vectors from the two are NOT comparable — run `pnpm embed --force` if you switch.
 */
import { redis } from "../store/redis";
import type { Item } from "../corpus/api";

export const DIM = 512;

export const EK = {
  emb: (id: string) => `emb:${id}`,
  taste: (u: string) => `u:${u}:taste`,
  tastew: (u: string) => `u:${u}:tastew`,
};

/** What a card "is", for embedding. Pitch + why-care carry the idea; tags + category anchor the vocabulary. */
export function cardText(it: Item): string {
  const c = it.card;
  const r = it.repo;
  if (!c) return `${r.id}. ${r.description ?? ""}`;
  return [
    `${r.name}: ${c.pitch}`,
    c.whyCare,
    `Category: ${c.category}. Tags: ${c.tags.join(", ")}. Ecosystem: ${c.ecosystem.join(", ")}.`,
    c.audience.length ? `For: ${c.audience.join(", ")}.` : "",
    r.language ? `Language: ${r.language}.` : "",
  ].filter(Boolean).join("\n");
}

export function provider(): "openai" | "voyage" {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.VOYAGE_API_KEY) return "voyage";
  throw new Error("set OPENAI_API_KEY or VOYAGE_API_KEY");
}

export async function embedTexts(texts: string[], inputType: "document" | "query" = "document"): Promise<Float32Array[]> {
  const prov = provider();
  const url = prov === "openai" ? "https://api.openai.com/v1/embeddings" : "https://api.voyageai.com/v1/embeddings";
  const key = prov === "openai" ? process.env.OPENAI_API_KEY : process.env.VOYAGE_API_KEY;
  const body = prov === "openai"
    ? { model: "text-embedding-3-small", input: texts, dimensions: DIM, encoding_format: "float" }
    : { model: "voyage-3-lite", input: texts, input_type: inputType, truncation: true };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`embeddings(${prov}) ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  return j.data.sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const toBuf = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBuf = (b: Buffer | null): Float32Array | null =>
  b && b.length === DIM * 4 ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null;

export async function putEmbeddings(pairs: { id: string; v: Float32Array }[]): Promise<void> {
  if (!pairs.length) return;
  const p = redis().pipeline();
  for (const { id, v } of pairs) p.set(EK.emb(id), toBuf(v));
  await p.exec();
}

/** All corpus vectors in one round trip. Missing ids map to null. */
/**
 * Whole-corpus vector cache for search: one Redis round-trip per 60 s per process instead of one per
 * query. ~10k × 512 × 4 B = 20 MB; fine for a Node process, and vectors only change when cards do.
 */
let all: { at: number; m: Map<string, Float32Array>; ids: string } | null = null;
export async function getEmbeddingsCached(ids: string[]): Promise<Map<string, Float32Array>> {
  const sig = `${ids.length}:${ids[0]}:${ids[ids.length - 1]}`;
  if (all && all.ids === sig && Date.now() - all.at < 60_000) return all.m;
  const m = await getEmbeddings(ids);
  all = { at: Date.now(), m, ids: sig };
  return m;
}

export async function getEmbeddings(ids: string[]): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  if (!ids.length) return out;
  const p = redis().pipeline();
  for (const id of ids) p.getBuffer(EK.emb(id));
  const res = await p.exec();
  ids.forEach((id, i) => { const v = fromBuf((res?.[i]?.[1] as Buffer) ?? null); if (v) out.set(id, v); });
  return out;
}

export async function hasEmbedding(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const p = redis().pipeline();
  for (const id of ids) p.exists(EK.emb(id));
  const res = await p.exec();
  return new Set(ids.filter((_, i) => (res?.[i]?.[1] as number) === 1));
}

/* ---- user taste vector ---- */

export interface Taste { v: Float32Array; w: number }

export async function getTaste(uid: string): Promise<Taste | null> {
  const [b, w] = await Promise.all([redis().getBuffer(EK.taste(uid)), redis().get(EK.tastew(uid))]);
  const v = fromBuf(b);
  return v ? { v, w: Number(w ?? 0) } : null;
}

/**
 * Move the taste vector toward (delta>0) or away from (delta<0) a card.
 * Running weighted mean: taste' = (taste*w + card*delta) / (w + |delta|), then renormalized.
 * Skips push away gently; likes and saves pull. Idempotent-ish under undo (pass -delta).
 */
export async function nudgeTaste(uid: string, cardId: string, delta: number): Promise<void> {
  const r = redis();
  const [cb, tb, tw] = await Promise.all([r.getBuffer(EK.emb(cardId)), r.getBuffer(EK.taste(uid)), r.get(EK.tastew(uid))]);
  const card = fromBuf(cb);
  if (!card) return;                       // card not embedded yet; term profile still learns
  const taste = fromBuf(tb) ?? new Float32Array(DIM);
  const w = Number(tw ?? 0);
  const next = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) next[i] = taste[i] * w + card[i] * delta;
  const nw = Math.max(0, w + Math.abs(delta));
  const p = r.pipeline();
  p.set(EK.taste(uid), toBuf(nw > 0 ? normalize(next) : next));
  p.set(EK.tastew(uid), String(nw));
  await p.exec();
}
