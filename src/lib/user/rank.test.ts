import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { baseScore, fitScore, tasteFit, tasteConfidence, blendFit, rank } from "./rank";
import { itemTerms } from "./state";
import { item, daysAgoIso, NOW, vec } from "@/test/fixtures";

beforeAll(() => vi.useFakeTimers({ now: NOW }));
afterAll(() => vi.useRealTimers());

describe("itemTerms", () => {
  it("lowercases tags and ecosystem, prefixes category and language, weights them as documented", () => {
    const t = itemTerms(item("a/b", { card: { tags: ["MCP", "cli"], ecosystem: ["Node"], category: "dev-tools" }, repo: { language: "Rust" } }));
    expect(t).toEqual([
      { term: "mcp", w: 1 }, { term: "cli", w: 1 }, { term: "node", w: 1 },
      { term: "cat:dev-tools", w: 0.6 }, { term: "lang:rust", w: 0.5 },
    ]);
  });
  it("carded-less items still contribute language", () => {
    expect(itemTerms(item("a/b", { card: null, repo: { language: "Go" } }))).toEqual([{ term: "lang:go", w: 0.5 }]);
  });
});

describe("fitScore", () => {
  it("is 0 with no profile, and never blames the item", () => {
    expect(fitScore(item("a/b"), new Map())).toEqual({ fit: 0, matched: [] });
  });
  it("credits matched positive terms relative to the profile's top-5 mass, and names them by weight", () => {
    const p = new Map([["rust", 2], ["cli", 1], ["gui", 4]]);
    const { fit, matched } = fitScore(item("a/b", { card: { tags: ["cli", "rust"] } }), p);
    // pos = 2·1 + 1·1 = 3 ; denom = 7
    expect(fit).toBeCloseTo(3 / 7);
    expect(matched).toEqual(["rust", "cli"]);
  });
  it("negative profile terms subtract; result is clamped to [-0.5, 1]", () => {
    const p = new Map([["cli", -50], ["x", 1]]);
    expect(fitScore(item("a/b", { card: { tags: ["cli"] } }), p).fit).toBe(-0.5);
    const q = new Map([["cli", 100]]);
    expect(fitScore(item("a/b", { card: { tags: ["cli"] } }), q).fit).toBe(1);
  });
  it("strips cat:/lang: prefixes from matched names so the UI reads 'rust', not 'lang:rust'", () => {
    const p = new Map([["lang:rust", 1], ["cat:cli", 1]]);
    expect(fitScore(item("a/b", { card: { category: "cli" }, repo: { language: "Rust" } }), p).matched).toEqual(["cli", "rust"]);
  });
});

describe("baseScore", () => {
  it("interest^1.2 with a floor at 0.5, no card → interest 3", () => {
    expect(baseScore(item("a/b", { card: null })).score).toBeCloseTo(Math.pow(3, 1.2));
    expect(baseScore(item("a/b", { card: { interest: 0 } })).score).toBeCloseTo(Math.pow(0.5, 1.2));
  });
  it("recency boosts by up to 60% and decays with a 7-day constant, from whichever is fresher: creation or release", () => {
    const stale = baseScore(item("a/b", { card: { interest: 5 } })).score;
    const fresh = baseScore(item("a/b", { card: { interest: 5 }, repo: { createdAt: daysAgoIso(0) } })).score;
    const released = baseScore(item("a/b", { card: { interest: 5 }, repo: { latestRelease: "v1", latestReleaseAt: daysAgoIso(0) } })).score;
    expect(fresh / stale).toBeCloseTo(1.6, 1);
    expect(released / stale).toBeCloseTo(1.6, 1);
    const week = baseScore(item("a/b", { card: { interest: 5 }, repo: { createdAt: daysAgoIso(7) } })).score;
    expect(week / stale).toBeCloseTo(1 + 0.6 / Math.E, 2);
  });
  it.each([
    ["major-release", 1.2], ["viral", 1.2], ["big-org", 1.15], ["license-change", 1.3], ["novel-approach", 1.1], ["fills-gap", 1.1], ["new-project", 1.1], ["none", 1],
  ] as const)("hook %s multiplies by %s", (hook, mult) => {
    const base = baseScore(item("a/b", { card: { hook: "none" } })).score;
    expect(baseScore(item("a/b", { card: { hook } })).score / base).toBeCloseTo(mult);
  });
  it("explains hooks in why[] with concrete facts", () => {
    expect(baseScore(item("a/b", { card: { hook: "viral" }, repo: { starsPerDay: 1234.4 } })).why).toContain("1,234 stars/day");
    expect(baseScore(item("acme/b", { card: { hook: "big-org" } })).why).toContain("from acme");
    expect(baseScore(item("a/b", { card: { hook: "license-change" } })).why).toContain("license changed");
    const rel = baseScore(item("a/b", { card: { hook: "major-release" }, repo: { latestRelease: "v2.0", latestReleaseAt: daysAgoIso(3) } })).why;
    expect(rel).toContain("released v2.0 3 days ago");
    // A major-release hook on a release older than 30 days is not news; no line.
    expect(baseScore(item("a/b", { card: { hook: "major-release" }, repo: { latestRelease: "v2.0", latestReleaseAt: daysAgoIso(60) } })).why).toEqual([]);
  });
  it("mentions newness with star count, or a fresh release, but not both, and never doubles a stars/day line", () => {
    expect(baseScore(item("a/b", { repo: { createdAt: daysAgoIso(1), stars: 2500 } })).why).toEqual(["new yesterday, 2,500★"]);
    expect(baseScore(item("a/b", { repo: { createdAt: daysAgoIso(0), stars: 1 } })).why).toEqual(["new today, 1★"]);
    expect(baseScore(item("a/b", { card: { hook: "viral" }, repo: { createdAt: daysAgoIso(1) } })).why).toHaveLength(1);
    expect(baseScore(item("a/b", { repo: { latestRelease: "v3", latestReleaseAt: daysAgoIso(2) } })).why).toEqual(["released v3 2 days ago"]);
  });
  it("'broadly notable' only for interest ≥ 8 with fewer than two other reasons", () => {
    expect(baseScore(item("a/b", { card: { interest: 8 } })).why).toEqual(["broadly notable"]);
    expect(baseScore(item("a/b", { card: { interest: 7 } })).why).toEqual([]);
  });
  it("social sources multiply 15% each and are named, deduplicated", () => {
    const none = baseScore(item("a/b")).score;
    const r = baseScore(item("a/b", { sources: ["github", "hn", "hn", "rss"] }));
    expect(r.score / none).toBeCloseTo(1.45);
    expect(r.why).toContain("on Hacker News and a newsletter");
    expect(baseScore(item("a/b", { sources: ["lobsters"] })).why).toContain("on Lobsters");
    expect(baseScore(item("a/b", { sources: ["awesome", "readme-link"] })).why).toEqual([]);
  });
});

describe("tasteFit", () => {
  const T = { v: vec(0), w: 6 };
  it("is 0 without a vector, a taste, or any weight behind the taste", () => {
    expect(tasteFit(undefined, T)).toBe(0);
    expect(tasteFit(vec(0), null)).toBe(0);
    expect(tasteFit(vec(0), { v: vec(0), w: 0 })).toBe(0);
  });
  it("a random card (cos≈corpus median .346) scores ≈0; identical scores 1; orthogonal is clamped to −0.5", () => {
    expect(tasteFit(vec(0), T)).toBe(1);
    expect(tasteFit(vec(1), T)).toBe(-0.5);
    // build a vector at exactly the centre cosine
    const v = new Float32Array(512); v[0] = 0.346; v[1] = Math.sqrt(1 - 0.346 ** 2);
    expect(tasteFit(v, T)).toBeCloseTo(0, 5);
  });
  it("confidence ramps linearly to full at weight 6 so one swipe cannot swing the feed", () => {
    expect(tasteConfidence({ v: vec(0), w: 1 })).toBeCloseTo(1 / 6);
    expect(tasteConfidence({ v: vec(0), w: 3 })).toBeCloseTo(0.5);
    expect(tasteConfidence({ v: vec(0), w: 60 })).toBe(1);
    expect(tasteConfidence(null)).toBe(0);
  });
  it("blend ramps the embedding's share with confidence instead of jumping 100% → 40% on the first like", () => {
    const T1 = { v: vec(0), w: 1 }, T6 = { v: vec(0), w: 6 };
    // Perfect semantic match (t=1), no term fit (f=0):
    expect(blendFit(0, vec(0), T1)).toBeCloseTo(0.6 / 6);   // 1/6 confidence × 60% share
    expect(blendFit(0, vec(0), T6)).toBeCloseTo(0.6);
    // Term fit 0.5 and a card the taste dislikes (t=−0.5), full confidence: 0.5 + 0.6·(−1) = −0.1.
    expect(blendFit(0.5, vec(1), T6)).toBeCloseTo(-0.1);
    // No vector: term fit alone, not a free zero.
    expect(blendFit(0.5, undefined, T6)).toBe(0.5);
    expect(blendFit(-0.2, undefined, T6)).toBe(-0.2);
  });
});

describe("rank", () => {
  const items = [
    item("a/spam", { card: { interest: 9, flags: ["spam-suspect"] } }),
    item("a/nosub", { card: { interest: 9, flags: ["no-substance"] } }),
    item("a/farm", { card: { interest: 9, flags: ["star-farm-suspect"] } }),
    item("a/nocard", { card: null }),
    item("a/hi", { card: { interest: 8, category: "ai-llm", tags: ["llm"] } }),
    item("a/mid", { card: { interest: 5, category: "cli", tags: ["cli"] } }),
    item("a/lo", { card: { interest: 2, category: "cli", tags: ["cli"] } }),
  ];
  it("excludes flagged, cardless and explicitly excluded items", () => {
    const ids = rank(items, new Map(), { n: 10, exclude: new Set(["a/mid"]) }).map((r) => r.item.repo.id);
    expect(ids).toEqual(["a/hi", "a/lo"]);
  });
  it("orders by score and multiplies by (1+fit)", () => {
    const p = new Map([["cli", 5]]);
    const r = rank(items, p, { n: 10, exploreRatio: 0 });
    // 'mid' is interest 5 with full fit; 'hi' interest 8 with none. 5^1.2·2 = 13.8 > 8^1.2 = 12.1
    expect(r[0].item.repo.id).toBe("a/mid");
    expect(r[0].why[0]).toBe("matches your interest in cli");
  });
  it("applies a 0.7 penalty per repeated category so the deck varies", () => {
    const many = Array.from({ length: 6 }, (_, i) => item(`c/${i}`, { card: { interest: 7 - i * 0.1, category: "cli", tags: [`t${i}`] } }));
    const other = item("o/x", { card: { interest: 5, category: "database", tags: ["db"] } });
    const r = rank([...many, other], new Map(), { n: 3 }).map((x) => x.item.repo.id);
    // Scores: c/0 10.33, c/1 10.15, c/2 9.98, o/x 6.90. After two cli picks c/2 is 9.98·0.49 = 4.9 < 6.9, so o/x takes slot 3.
    expect(r).toEqual(["c/0", "c/1", "o/x"]);
  });
  it("penalises tag-cluster repeats: 2+ shared tags with already-picked items", () => {
    const a = item("x/a", { card: { interest: 7, category: "cli", tags: ["p", "q", "r"] } });
    const b = item("x/b", { card: { interest: 6.9, category: "dev-tools", tags: ["p", "q", "r"] } });   // same cluster, other category
    const c = item("x/c", { card: { interest: 6.5, category: "database", tags: ["z"] } });
    expect(rank([a, b, c], new Map(), { n: 3 }).map((x) => x.item.repo.id)).toEqual(["x/a", "x/c", "x/b"]);
  });
  it("reserves explore slots only once there is a profile, for high-interest items the profile does not already like", () => {
    const p = new Map([["cli", 5]]);
    const pool = [
      ...Array.from({ length: 4 }, (_, i) => item(`f/${i}`, { card: { interest: 5, category: "cli", tags: ["cli", `t${i}`] } })),
      item("e/novel", { card: { interest: 7, category: "science", tags: ["bio"] } }),
      item("e/dull", { card: { interest: 4, category: "science", tags: ["bio"] } }),
    ];
    const r = rank(pool, p, { n: 5, exploreRatio: 0.2 });
    const ex = r.filter((x) => x.explore);
    expect(ex).toHaveLength(1);
    expect(ex[0].item.repo.id).toBe("e/novel");
    expect(ex[0].why[0]).toBe("outside your usual — exploring");
    expect(r).toHaveLength(5);
    expect(r[0].explore).toBe(false);                        // the deck opens with a sure thing
    expect(rank(pool, new Map(), { n: 5 }).some((x) => x.explore)).toBe(false);
  });
  it("explore is not a no-op when the main pass would have picked the same item (regression)", () => {
    // e/novel is the best non-cli candidate; a naive main-then-explore order picks it as main and leaves the slot empty.
    const p = new Map([["cli", 5]]);
    const pool = [
      ...Array.from({ length: 8 }, (_, i) => item(`f/${i}`, { card: { interest: 5, category: "cli", tags: ["cli", `t${i}`] } })),
      item("e/novel", { card: { interest: 7, category: "science", tags: ["bio"] } }),
    ];
    const r = rank(pool, p, { n: 5, exploreRatio: 0.2 });
    expect(r.filter((x) => x.explore).map((x) => x.item.repo.id)).toEqual(["e/novel"]);
  });
  it("unused explore slots fall back to main picks so n is honoured", () => {
    const p = new Map([["cli", 5]]);
    const pool = Array.from({ length: 6 }, (_, i) => item(`f/${i}`, { card: { interest: 5, category: "cli", tags: ["cli"] } }));
    expect(rank(pool, p, { n: 5, exploreRatio: 0.2 })).toHaveLength(5);
  });
  it("blends term fit 40/60 with taste when a confident taste vector exists, and explains the embedding when terms do not", () => {
    const vectors = new Map([["a/hi", vec(0)], ["a/mid", vec(1)], ["a/lo", vec(1)]]);
    const taste = { v: vec(0), w: 6 };
    const r = rank(items, new Map([["zzz", 1]]), { n: 3, exploreRatio: 0, taste, vectors });
    const hi = r.find((x) => x.item.repo.id === "a/hi")!;
    expect(hi.fit).toBeCloseTo(0.6);                    // 0.4·0 + 0.6·1
    expect(hi.why[0]).toBe("close to things you liked");
    expect(r.find((x) => x.item.repo.id === "a/mid")!.fit).toBeCloseTo(-0.3);
  });
  it("caps why[] at three lines and returns at most n", () => {
    const busy = item("z/z", { card: { interest: 9, hook: "viral" }, repo: { createdAt: daysAgoIso(1), starsPerDay: 500 }, sources: ["hn", "rss"] });
    const r = rank([busy, ...items], new Map(), { n: 2 });
    expect(r).toHaveLength(2);
    expect(r[0].why.length).toBeLessThanOrEqual(3);
  });
});
