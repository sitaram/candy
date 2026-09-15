import { describe, it, expect, vi, afterEach } from "vitest";
import { cardText, normalize, dot, provider, embedTexts, putEmbeddings, getEmbeddings, getEmbeddingsCached, hasEmbedding, getTaste, nudgeTaste, DIM } from "./index";
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

describe("provider", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });
  it("prefers OpenAI, falls back to Voyage, throws with neither", () => {
    process.env = { ...env, OPENAI_API_KEY: "x", VOYAGE_API_KEY: "y" };
    expect(provider()).toBe("openai");
    delete process.env.OPENAI_API_KEY;
    expect(provider()).toBe("voyage");
    delete process.env.VOYAGE_API_KEY;
    expect(() => provider()).toThrow(/OPENAI_API_KEY or VOYAGE_API_KEY/);
  });
});

describe("embedTexts", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });
  it("posts to OpenAI with dimensions=512, restores response order by index, and normalizes", async () => {
    process.env = { ...env, OPENAI_API_KEY: "k" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 1, embedding: [0, 2, ...new Array(DIM - 2).fill(0)] }, { index: 0, embedding: [3, 0, ...new Array(DIM - 2).fill(0)] }],
    })));
    const [a, b] = await embedTexts(["first", "second"]);
    const req = fetchMock.mock.calls[0];
    expect(req[0]).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse((req[1] as RequestInit).body as string);
    expect(body).toMatchObject({ model: "text-embedding-3-small", dimensions: DIM, input: ["first", "second"] });
    expect((req[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer k" });
    expect(a[0]).toBe(1); expect(b[1]).toBe(1);        // reordered by index and unit-normalized
  });
  it("sends input_type to Voyage", async () => {
    process.env = { ...env, VOYAGE_API_KEY: "v" }; delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(DIM).fill(1) }] })));
    await embedTexts(["q"], "query");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ model: "voyage-3-lite", input_type: "query" });
  });
  it("surfaces HTTP errors with provider, status and a body excerpt", async () => {
    process.env = { ...env, OPENAI_API_KEY: "k" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(embedTexts(["x"])).rejects.toThrow(/embeddings\(openai\) 429: rate limited/);
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
  it("getEmbeddingsCached serves from memory within 60s for the same id signature", async () => {
    await putEmbeddings([{ id: "a/b", v: vec(0) }]);
    const first = await getEmbeddingsCached(["a/b"]);
    await putEmbeddings([{ id: "a/b", v: vec(1) }]);
    const second = await getEmbeddingsCached(["a/b"]);
    expect(second).toBe(first);                                   // same Map instance: cache hit
    const third = await getEmbeddingsCached(["a/b", "c/d"]);      // different signature: refetch
    expect(third).not.toBe(first);
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
