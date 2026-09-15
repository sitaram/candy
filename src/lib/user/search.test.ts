import { describe, it, expect } from "vitest";
import { keywords, looksLikeName, search } from "./search";

describe("keywords", () => {
  it("lowercases, drops stop-words and 1-char tokens, dedupes, keeps + # . / -", () => {
    expect(keywords("I want to build a Voice Agent for C# and c++")).toEqual(["voice", "agent", "c#", "c++"]);
    expect(keywords("mcp MCP mcp")).toEqual(["mcp"]);
    expect(keywords("a b c")).toEqual([]);
    expect(keywords("e2e-testing node.js owner/repo")).toEqual(["e2e-testing", "node.js", "owner/repo"]);
  });
  it("strips punctuation that is not part of an identifier", () => {
    // The apostrophe becomes a space, and "what"/"best"/"framework" are stop-words; only the identifier survives.
    expect(keywords("what's the best (rust) framework?")).toEqual(["rust"]);
  });
});

describe("looksLikeName", () => {
  it.each([
    ["ollama", true], ["owner/repo", true], ["a.b-c_d/e.f", true], ["ab", false], ["two words", false], ["owner/repo/extra", false], ["", false], ["  ollama  ", true],
  ])("%j → %s", (q, want) => expect(looksLikeName(q)).toBe(want));
});

/* ---- the pipeline, with the embedding call mocked ---- */
import { vi, beforeAll, afterAll } from "vitest";
import { seed, vec, NOW } from "@/test/fixtures";
import { react } from "./state";
import { getItem } from "@/lib/corpus/api";
import * as embed from "@/lib/embed";

function at(cos: number, other = 1) { const v = new Float32Array(512); v[0] = cos; v[other] = Math.sqrt(1 - cos * cos); return v; }

describe("search()", () => {
  beforeAll(() => vi.useFakeTimers({ now: NOW }));
  afterAll(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const U = "u";
  // NB: getEmbeddingsCached() memoises the whole-corpus vector map for 60 s and the fake clock never advances,
  // so every test here must seed the *same* ids with the *same* vectors — which this one fixture guarantees.
  const corpus = async () => seed([
    { id: "pipecat-ai/pipecat", card: { pitch: "Python framework for real-time voice agents", tags: ["voice-agents"], category: "ai-agents" }, repo: { language: "Python", stars: 5000 }, vec: vec(0) },
    { id: "livekit/agents", card: { pitch: "Realtime agent framework", tags: ["voice-agents", "webrtc"], category: "ai-agents" }, repo: { language: "Python", stars: 9000 }, vec: at(0.95) },
    { id: "ts/voice", card: { pitch: "Voice agents in TypeScript", tags: ["voice-agents"], category: "ai-agents" }, repo: { language: "TypeScript", stars: 900 }, vec: at(0.9) },
    { id: "webpack/webpack", card: { pitch: "Module bundler", tags: ["bundler"], category: "frontend" }, repo: { language: "JavaScript", stars: 65_000 }, vec: at(0.2) },
    { id: "spam/my", card: { pitch: "voice agents!!!", tags: ["voice-agents"], flags: ["spam-suspect"] }, vec: at(0.99) },
  ]);

  it("short queries return nothing; an exact name is 'exact' and sets `exact`; a bare name hits by prefix", async () => {
    await corpus();
    expect(await search(U, "a")).toEqual({ q: "a", results: [], semantic: false, exact: null });
    vi.spyOn(embed, "embedTexts").mockRejectedValue(new Error("no network"));
    const r = await search(U, "pipecat");
    expect(r.exact).toBe("pipecat-ai/pipecat");
    expect(r.results[0]).toMatchObject({ id: "pipecat-ai/pipecat", match: "exact" });
    expect(r.results[0].why[0]).toBe("exact match");
    expect(r.semantic).toBe(false);                                   // bare name → no semantic lane
    const p = await search(U, "pipe");
    expect(p.results[0]).toMatchObject({ id: "pipecat-ai/pipecat", match: "name" });
  });
  it("semantic finds the neighbourhood, lexical confirms: a 'typescript' keyword reorders within it; flagged repos never appear", async () => {
    await corpus();
    vi.spyOn(embed, "embedTexts").mockResolvedValue([vec(0)]);       // query embeds where pipecat is
    const r = await search(U, "voice agent framework in typescript");
    expect(r.semantic).toBe(true);
    const ids = r.results.map((x) => x.id);
    expect(ids).not.toContain("spam/my");
    expect(ids).not.toContain("webpack/webpack");                    // cos .2 is outside the top band's .12 gap
    // Raw cosine order: pipecat 1.0 > livekit .95 > ts/voice .90 — all inside the .12 band the semantic lane keeps
    // (webpack at .2 is not). rel = .7·cos/best + .3·min(1, lex/3); lex is 1.2 for the two Python repos (tag substring
    // hits on "voice", "agent") and 2.2 for ts/voice (+2 for `Language: TypeScript` = the third keyword).
    //   pipecat  .7·1.00 + .3·.40 = .820
    //   ts/voice .7·.90  + .3·.73 = .850   ← the keyword lifted it past both higher-cosine peers
    //   livekit  .7·.95  + .3·.40 = .785
    // Same interest, same age, no stars term → quality is equal; rel² decides. Cosine found the neighbourhood,
    // the keyword decided inside it. Neither alone would have put the TypeScript one first for a TypeScript query.
    expect(ids.slice(0, 3)).toEqual(["ts/voice", "pipecat-ai/pipecat", "livekit/agents"]);
    expect(r.results[0].why[0]).toMatch(/^matches "|^close to what you described$/);
  });
  it("degrades to lexical when the embedding call fails, and says so", async () => {
    await corpus();
    vi.spyOn(embed, "embedTexts").mockRejectedValue(new Error("429"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await search(U, "voice agents please");        // a query no earlier test embedded: the LRU must miss
    expect(r.semantic).toBe(false);
    expect(r.results.map((x) => x.id)).toEqual(expect.arrayContaining(["pipecat-ai/pipecat", "livekit/agents", "ts/voice"]));
    expect(r.results.every((x) => x.match === "keyword")).toBe(true);
    expect(warn).toHaveBeenCalledWith("[search] embed", "429");
  });
  it("is personal: the same query ranks differently after the user likes TypeScript things; results carry `saved`", async () => {
    await corpus();
    vi.spyOn(embed, "embedTexts").mockResolvedValue([vec(0)]);
    const before = (await search(U, "voice agents")).results.map((x) => x.id);
    for (let i = 0; i < 4; i++) await react(U, (await getItem("ts/voice"))!, "like");
    await react(U, (await getItem("livekit/agents"))!, "save");
    const after = await search(U, "voice agents");
    expect(after.results.map((x) => x.id).indexOf("ts/voice")).toBeLessThanOrEqual(before.indexOf("ts/voice"));
    // The learned terms, strongest first: voice-agents (4×1) then ai-agents (4×0.6×0.6); typescript (4×0.5×0.5) is third and cut.
    expect(after.results.find((x) => x.id === "ts/voice")!.why).toContain("matches your interest in voice-agents, ai-agents");
    expect(after.results.find((x) => x.id === "livekit/agents")!.saved).toBe(true);
    expect(after.results.length).toBeLessThanOrEqual(20);
  });
  it("honours limit and rounds scores", async () => {
    await corpus();
    vi.spyOn(embed, "embedTexts").mockResolvedValue([vec(0)]);
    const r = await search(U, "voice agents", 2);
    expect(r.results).toHaveLength(2);
    for (const x of r.results) expect(x.score).toBe(Math.round(x.score * 100) / 100);
  });
});
