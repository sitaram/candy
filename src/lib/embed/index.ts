/**
 * Embeddings: one vector per card, one taste vector per user.
 *
 * emb:{id}          Buffer   Float32 x DIM, the card's text embedding (offline)
 * u:{uid}:taste     Buffer   Float32 x DIM, Σ delta·card over reacted cards — UNnormalized (online)
 * u:{uid}:tastew    STRING   Σ |delta| behind the taste vector (confidence)
 *
 * The taste vector is stored as a raw weighted sum and normalized on read. That makes every nudge
 * exactly reversible: undo passes −delta and the sum returns to what it was. A stored running
 * *mean* (the first version) could not be undone — renormalizing after each step loses the scale
 * the reversal needs, and the "undone" like left a 0.28 ghost in the vector.
 *
 * The term-vector profile stays the source of *reasons*; this is the source of *score*.
 * Provider is picked from env: OPENAI_API_KEY → text-embedding-3-small at 512 dims (the model
 * supports Matryoshka truncation, so 512 keeps Redis small at almost no quality cost; ~$0.002
 * for the whole corpus). Else VOYAGE_API_KEY → voyage-3-lite, also 512. Same DIM either way,
 * but vectors from the two are NOT comparable — run `pnpm embed --force` if you switch.
 */
import { env, need } from "../env";
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
  if (env.OPENAI_API_KEY) return "openai";
  if (env.VOYAGE_API_KEY) return "voyage";
  throw new Error("set OPENAI_API_KEY or VOYAGE_API_KEY");
}

export async function embedTexts(texts: string[], inputType: "document" | "query" = "document"): Promise<Float32Array[]> {
  const prov = provider();
  const url = prov === "openai" ? "https://api.openai.com/v1/embeddings" : "https://api.voyageai.com/v1/embeddings";
  const key = prov === "openai" ? need("OPENAI_API_KEY") : need("VOYAGE_API_KEY");
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

/**
 * The whole corpus as one matrix, in one Redis key (emb:matrix = ids JSON + Float32 block, ~2 MB at 1k,
 * ~20 MB at 10k), versioned with the corpus snapshot. One GET per process per version instead of one
 * pipelined read per vector per request (862 reads = 165 ms at 1.2k; linear). Missing vectors are
 * simply absent from `ids`.
 */
export const MK = { matrix: "emb:matrix", ver: "emb:ver" } as const;

export interface Matrix { ids: string[]; row: Map<string, number>; data: Float32Array; ver: number }
let matrix: { m: Matrix; checkedAt: number } | null = null;
let matrixLoading: Promise<Matrix> | null = null;
const MCHECK = 30_000;

export async function writeMatrix(): Promise<number> {
  const r = redis();
  const keys: string[] = [];
  let cursor = "0";
  do { const [c, ks] = await r.scan(cursor, "MATCH", "emb:*", "COUNT", 1000); cursor = c; for (const k of ks) if (k !== MK.matrix && k !== MK.ver) keys.push(k); } while (cursor !== "0");
  const ids = keys.map((k) => k.slice(4)).sort();
  const vecs = await getEmbeddings(ids);
  const have = ids.filter((id) => vecs.has(id));
  const data = new Float32Array(have.length * DIM);
  have.forEach((id, i) => data.set(vecs.get(id)!, i * DIM));
  const head = Buffer.from(JSON.stringify(have), "utf8");
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
  const buf = Buffer.concat([len, head, Buffer.from(data.buffer)]);
  const [, ver] = await Promise.all([r.set(MK.matrix, buf), r.incr(MK.ver)]);
  return ver;
}

function parseMatrix(buf: Buffer, ver: number): Matrix {
  const hl = buf.readUInt32LE(0);
  const ids = JSON.parse(buf.subarray(4, 4 + hl).toString("utf8")) as string[];
  const body = buf.subarray(4 + hl);
  const data = new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  return { ids, row: new Map(ids.map((id, i) => [id, i])), data, ver };
}

export async function getMatrix(): Promise<Matrix> {
  if (matrix && Date.now() - matrix.checkedAt < MCHECK) return matrix.m;
  if (matrixLoading) return matrixLoading;
  matrixLoading = (async () => {
    try {
      const r = redis();
      if (matrix) { const ver = Number((await r.get(MK.ver)) ?? 0); if (ver === matrix.m.ver) { matrix.checkedAt = Date.now(); return matrix.m; } }
      let [buf, ver] = await Promise.all([r.getBuffer(MK.matrix), r.get(MK.ver)]);
      if (!buf) { await writeMatrix(); [buf, ver] = await Promise.all([r.getBuffer(MK.matrix), r.get(MK.ver)]); }
      const m = parseMatrix(buf!, Number(ver ?? 0));
      matrix = { m, checkedAt: Date.now() };
      return m;
    } finally { matrixLoading = null; }
  })();
  return matrixLoading;
}

/** Test hook: forget the in-process matrix so the next getMatrix() reads Redis. */
export function _resetMatrixCache(): void { matrix = null; }

export function rowOf(m: Matrix, id: string): Float32Array | null {
  const i = m.row.get(id);
  return i === undefined ? null : m.data.subarray(i * DIM, (i + 1) * DIM);
}

/** Cosine of `q` against every row; returns the top k (id, cos) excluding `skip`. One pass, no allocation per row. */
export function topK(m: Matrix, q: Float32Array, k: number, skip?: Set<string>): { id: string; cos: number }[] {
  const out: { id: string; cos: number }[] = [];
  let min = -Infinity;
  const n = m.ids.length, d = m.data;
  for (let r = 0; r < n; r++) {
    const id = m.ids[r];
    if (skip?.has(id)) continue;
    let s = 0; const o = r * DIM;
    for (let i = 0; i < DIM; i++) s += q[i] * d[o + i];
    if (out.length < k) { out.push({ id, cos: s }); if (out.length === k) min = Math.min(...out.map((x) => x.cos)); }
    else if (s > min) { let j = 0; for (let i = 1; i < k; i++) if (out[i].cos < out[j].cos) j = i; out[j] = { id, cos: s }; min = Math.min(...out.map((x) => x.cos)); }
  }
  return out.sort((a, b) => b.cos - a.cos);
}

/** Map view over the matrix for callers that want `Map<id, vec>` (feed, search). Rows are views, not copies. */
export async function getEmbeddingsCached(ids: string[]): Promise<Map<string, Float32Array>> {
  const m = await getMatrix();
  const out = new Map<string, Float32Array>();
  for (const id of ids) { const v = rowOf(m, id); if (v) out.set(id, v); }
  return out;
}

/** Per-id reads straight from Redis. For the matrix builder and for ids that may be newer than the matrix. */
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

/** The user's taste as a unit vector plus the evidence weight behind it. null until the first embedded reaction. */
export async function getTaste(uid: string): Promise<Taste | null> {
  const [b, w] = await Promise.all([redis().getBuffer(EK.taste(uid)), redis().get(EK.tastew(uid))]);
  return tasteFrom(b, Number(w ?? 0));
}

/** Build a Taste from already-fetched bytes (see state.loadUser, which reads them in one pipeline). */
export function tasteFrom(b: Buffer | null, weight: number): Taste | null {
  const sum = fromBuf(b);
  if (!sum) return null;
  // All evidence cancelled (e.g. like then undo): no taste, rather than a random direction from float dust.
  if (weight <= 0 || !sum.some((x) => Math.abs(x) > 1e-6)) return null;
  return { v: normalize(sum), w: weight };
}

/**
 * Move the taste toward (delta>0) or away from (delta<0) a card: sum += delta·card, weight += |delta|.
 * Undo passes −delta; the sum reverts exactly, the weight is reduced by the same |delta|.
 * Skips push away gently; likes and saves pull.
 */
export async function nudgeTaste(uid: string, cardId: string, delta: number, opts: { reverse?: boolean } = {}): Promise<void> {
  const r = redis();
  const [cb, tb, tw] = await Promise.all([r.getBuffer(EK.emb(cardId)), r.getBuffer(EK.taste(uid)), r.get(EK.tastew(uid))]);
  const card = fromBuf(cb);
  if (!card) return;                       // card not embedded yet; term profile still learns
  const sum = fromBuf(tb) ?? new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) sum[i] += card[i] * delta;
  const w = Math.max(0, Number(tw ?? 0) + (opts.reverse ? -Math.abs(delta) : Math.abs(delta)));
  const p = r.pipeline();
  p.set(EK.taste(uid), toBuf(sum));
  p.set(EK.tastew(uid), String(w));
  await p.exec();
}
