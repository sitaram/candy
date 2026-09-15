import { describe, it, expect, vi, afterEach } from "vitest";
import { cardText, normalize, dot, provider, embedTexts, putEmbeddings, getEmbeddings, getEmbeddingsCached, hasEmbedding, getTaste, nudgeTaste, DIM, writeMatrix, getMatrix, rowOf, topK, _resetMatrixCache } from "./index";
import { item, vec } from "@/test/fixtures";

describe("cardText", () => {
  it("leads with name + pitch, anchors vocabulary with category/tags/ecosystem, adds audience and language when present", () => {
    const t = cardText(item("acme/tool", { card: { pitch: "Does X.", whyCare: "Because Y.", category: "cli", tags: ["a", "b"], ecosystem: ["node"], audience: ["ops"] }, repo: { language: "Go" } }));
    expect(t).toBe("tool: Does X.\nBecause Y.\nCategory: cli. Tags: a, b. Ecosystem: node.\nFor: ops.\nLanguage: Go.");
  });
  it("omits empty audience/language lines and falls back to id + description without a card", () => {
    expect(cardText(item("a/b", { card: { audience: [] }, repo: { language: "" } }))).not.toMatch(/For:|Language:/);
    expect(cardText(item("a/b", { card: null, repo: { description: "desc" } }))).toBe("a/b. desc");
  });
});

describe("vector math", () => {
  it("normalize yields unit length and tolerates the zero vector", () => {
    const v = normalize(Float32Array.from([3, 4]));
    expect(v[0]).toBeCloseTo(0.6); expect(v[1]).toBeCloseTo(0.8);
    expect(Array.from(normalize(new Float32Array(2)))).toEqual([0, 0]);
  });
  it("dot of unit vectors is cosine", () => {
    expect(dot(vec(0), vec(0))).toBeCloseTo(1);
    expect(dot(vec(0), vec(1))).toBeCloseTo(0);
  });
});

/** `env` is a snapshot taken at import, so the provider tests load a fresh module with a mocked env. */
async function withEnv(over: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({ env: { OPENAI_API_KEY: undefined, VOYAGE_API_KEY: undefined, ...over }, need: (k: string) => over[k], assertEnv: () => {} }));
  return import("./index");
}

describe("provider", () => {
  afterEach(() => { vi.doUnmock("@/lib/env"); vi.resetModules(); });
  it("prefers OpenAI, falls back to Voyage, throws with neither", async () => {
    expect((await withEnv({ OPENAI_API_KEY: "x", VOYAGE_API_KEY: "y" })).provider()).toBe("openai");
    expect((await withEnv({ VOYAGE_API_KEY: "y" })).provider()).toBe("voyage");
    const none = await withEnv({});
    expect(() => none.provider()).toThrow(/OPENAI_API_KEY or VOYAGE_API_KEY/);
  });
});

describe("embedTexts", () => {
  afterEach(() => { vi.doUnmock("@/lib/env"); vi.resetModules(); vi.restoreAllMocks(); });
  it("posts to OpenAI with dimensions=512, restores response order by index, and normalizes", async () => {
    const m = await withEnv({ OPENAI_API_KEY: "k" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 1, embedding: [0, 2, ...new Array(DIM - 2).fill(0)] }, { index: 0, embedding: [3, 0, ...new Array(DIM - 2).fill(0)] }],
    })));
    const [a, b] = await m.embedTexts(["first", "second"]);
    const req = fetchMock.mock.calls[0];
    expect(req[0]).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse((req[1] as RequestInit).body as string);
    expect(body).toMatchObject({ model: "text-embedding-3-small", dimensions: DIM, input: ["first", "second"] });
    expect((req[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer k" });
    expect(a[0]).toBe(1); expect(b[1]).toBe(1);        // reordered by index and unit-normalized
  });
  it("sends input_type to Voyage", async () => {
    const m = await withEnv({ VOYAGE_API_KEY: "v" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(DIM).fill(1) }] })));
    await m.embedTexts(["q"], "query");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ model: "voyage-3-lite", input_type: "query" });
  });
  it("surfaces HTTP errors with provider, status and a body excerpt", async () => {
    const m = await withEnv({ OPENAI_API_KEY: "k" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(m.embedTexts(["x"])).rejects.toThrow(/embeddings\(openai\) 429: rate limited/);
  });
});

describe("storage", () => {
  it("round-trips Float32 vectors through Redis buffers; missing and malformed ids are absent", async () => {
    await putEmbeddings([{ id: "a/b", v: vec(3) }, { id: "c/d", v: vec(4) }]);
    await putEmbeddings([]);
    const m = await getEmbeddings(["a/b", "c/d", "x/y"]);
    expect(m.size).toBe(2);
    expect(dot(m.get("a/b")!, vec(3))).toBeCloseTo(1);
    expect(await hasEmbedding(["a/b", "x/y"])).toEqual(new Set(["a/b"]));
    expect(await getEmbeddings([])).toEqual(new Map());
    expect(await hasEmbedding([])).toEqual(new Set());
  });
  it("rejects a stored buffer of the wrong dimension rather than returning garbage", async () => {
    const { mockRedis } = await import("@/test/setup");
    await mockRedis.set("emb:bad/dim", Buffer.alloc(16));
    expect((await getEmbeddings(["bad/dim"])).size).toBe(0);
  });
});

describe("matrix", () => {
  it("writeMatrix packs every emb:* vector into one key; getMatrix reads it back with row lookup", async () => {
    _resetMatrixCache();
    await putEmbeddings([{ id: "a/b", v: vec(0) }, { id: "c/d", v: vec(1) }]);
    const ver = await writeMatrix();
    expect(ver).toBeGreaterThan(0);
    const m = await getMatrix();
    expect(m.ids).toEqual(["a/b", "c/d"]);
    expect(m.ver).toBe(ver);
    expect(Array.from(rowOf(m, "a/b")!)).toEqual(Array.from(vec(0)));
    expect(rowOf(m, "nope/x")).toBeNull();
  });
  it("getMatrix builds the matrix on first read when the key is absent, and serves from memory after", async () => {
    _resetMatrixCache();
    await putEmbeddings([{ id: "a/b", v: vec(0) }]);
    const m1 = await getMatrix();
    expect(m1.ids).toEqual(["a/b"]);
    await putEmbeddings([{ id: "c/d", v: vec(1) }]);        // not in the matrix until writeMatrix()
    const m2 = await getMatrix();
    expect(m2).toBe(m1);                                     // same object: in-process cache, no Redis hop
  });
  it("topK returns the k most similar rows, best first, honouring skip", async () => {
    _resetMatrixCache();
    const q = normalize(new Float32Array(DIM).map((_, i) => (i === 0 ? 1 : i === 1 ? 0.5 : 0)));
    await putEmbeddings([{ id: "near", v: vec(0) }, { id: "mid", v: vec(1) }, { id: "far", v: vec(2) }, { id: "self", v: q }]);
    await writeMatrix();
    const m = await getMatrix();
    const top = topK(m, q, 2, new Set(["self"]));
    expect(top.map((t) => t.id)).toEqual(["near", "mid"]);
    expect(top[0].cos).toBeGreaterThan(top[1].cos);
    expect(topK(m, q, 10).map((t) => t.id)[0]).toBe("self");
  });
  it("getEmbeddingsCached is a Map view over the matrix; absent ids are absent", async () => {
    _resetMatrixCache();
    await putEmbeddings([{ id: "a/b", v: vec(0) }]);
    await writeMatrix();
    const got = await getEmbeddingsCached(["a/b", "zz/zz"]);
    expect(got.size).toBe(1);
    expect(dot(got.get("a/b")!, vec(0))).toBeCloseTo(1);
  });
});

describe("taste vector", () => {
  it("is null until the first embedded reaction", async () => {
    expect(await getTaste("u")).toBeNull();
    await nudgeTaste("u", "not/embedded", 1);
    expect(await getTaste("u")).toBeNull();
  });
  it("reads as the normalized weighted sum; weight = Σ|delta|", async () => {
    await putEmbeddings([{ id: "a", v: vec(0) }, { id: "b", v: vec(1) }]);
    await nudgeTaste("u", "a", 1);
    await nudgeTaste("u", "b", 1);
    const t = (await getTaste("u"))!;
    expect(t.w).toBe(2);
    expect(t.v[0]).toBeCloseTo(Math.SQRT1_2); expect(t.v[1]).toBeCloseTo(Math.SQRT1_2);
    expect(dot(t.v, t.v)).toBeCloseTo(1);
  });
  it("a skip pushes away: negative component, weight still grows", async () => {
    await putEmbeddings([{ id: "a", v: vec(0) }, { id: "b", v: vec(1) }]);
    await nudgeTaste("u", "a", 1);
    await nudgeTaste("u", "b", -0.5);
    const t = (await getTaste("u"))!;
    expect(t.v[1]).toBeLessThan(0);
    expect(t.w).toBe(1.5);
  });
  it("undo is exact: reverse:true restores both vector and weight (regression — running-mean storage left a 0.28 ghost)", async () => {
    await putEmbeddings([{ id: "a", v: vec(0) }, { id: "b", v: vec(1) }]);
    await nudgeTaste("u", "a", 1);
    await nudgeTaste("u", "b", 1);
    await nudgeTaste("u", "b", -1, { reverse: true });
    const t = (await getTaste("u"))!;
    expect(t.w).toBe(1);
    expect(t.v[0]).toBeCloseTo(1, 5);
    expect(Math.abs(t.v[1])).toBeLessThan(1e-6);
  });
  it("undoing the only reaction leaves no taste rather than a random direction", async () => {
    await putEmbeddings([{ id: "a", v: vec(0) }]);
    await nudgeTaste("u", "a", 1);
    await nudgeTaste("u", "a", -1, { reverse: true });
    expect(await getTaste("u")).toBeNull();
  });
});
