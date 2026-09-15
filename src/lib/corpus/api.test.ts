import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { allItems, getItem, getItemDetail, getItems, matches, sortItems, similar, categories, search, invalidate, upsertSnapshotItem, assembleItems } from "./api";
import { readSnapshot, writeSnapshot } from "./snapshot";
import { saveRepo } from "@/lib/store/corpus";
import { saveCard } from "@/lib/enrich";
import { parseCard, getCard, getCards, CK } from "@/lib/enrich";
import { addEdges } from "@/lib/store/corpus";
import { addAwesome } from "@/lib/store/corpus";
import { K } from "@/lib/store/keys";
import { item, card, seed, daysAgoIso, NOW } from "@/test/fixtures";
import { mockRedis } from "@/test/setup";

beforeAll(() => vi.useFakeTimers({ now: NOW }));
afterAll(() => vi.useRealTimers());
beforeEach(async () => { await mockRedis.flushdb(); await invalidate(); });

describe("parseCard", () => {
  it("null without a pitch; defaults and corrupt-JSON tolerance for everything else", () => {
    expect(parseCard({})).toBeNull();
    const c = parseCard({ pitch: "p", tags: "[broken", interest: "x" })!;
    expect(c).toMatchObject({ pitch: "p", tags: [], interest: 0, category: "other", hook: "none", flags: [], lang: "en" });
  });
});

describe("saveCard / getCard", () => {
  it("stores the card, indexes by category and lowercase tag, records owner/repo alternatives as edges and bumps them onto the frontier", async () => {
    await seed([{ id: "a/b", card: { category: "cli", tags: ["MCP"], ecosystem: ["node"], alternatives: ["Other/Tool", "just a name"], buildsOn: ["x/y"] } }]);
    const c = (await getCard("A/B"))!;
    expect(c.tags).toEqual(["MCP"]);
    expect(await mockRedis.smembers(CK.byCategory("cli"))).toEqual(["a/b"]);
    expect(await mockRedis.smembers(CK.byTag("mcp"))).toEqual(["a/b"]);
    expect(await mockRedis.smembers(CK.alt("a/b"))).toEqual(["other/tool"]);
    expect(await mockRedis.smembers(CK.builds("a/b"))).toEqual(["x/y"]);
    expect(Number(await mockRedis.zscore(K.frontier, "other/tool"))).toBe(1);
    expect((await getCards(["a/b", "nope/x"])).size).toBe(1);
    expect((await getCards([])).size).toBe(0);
  });
});

describe("allItems", () => {
  it("joins repo, card, sources (src:*), awesome lists and frontier priority; caches for 30s; invalidate() busts", async () => {
    await seed([{ id: "a/b", sources: ["hn", "rss:x"] }, { id: "c/d", card: null }]);
    await addAwesome("list/one", ["a/b"]);
    await invalidate();
    const items = await allItems();
    const ab = items.find((i) => i.repo.id === "a/b")!;
    expect(ab.card).not.toBeNull();
    expect(ab.sources.sort()).toEqual(["hn", "rss"]);
    expect(ab.awesome).toEqual(["list/one"]);
    expect(ab.priority).toBeGreaterThan(0);
    expect(items.find((i) => i.repo.id === "c/d")!.card).toBeNull();
    // The read model is a versioned snapshot: in-process copy is served until the stored version moves.
    await seed([{ id: "e/f" }]);
    expect((await allItems()).length).toBe(3);
    const { bumpVersion } = await import("./snapshot");
    await mockRedis.del(K.repo("e/f"));       // change a key without touching the snapshot…
    expect((await allItems()).length).toBe(3);   // …and the snapshot still says 3 (by design: writers must invalidate/upsert)
    await bumpVersion();                          // a writer signals; next read past CHECK re-fetches the snapshot (still 3 items)
    await invalidate();                           // a full rebuild reads keys again
    expect((await allItems()).length).toBe(2);
  });
  it("getItem normalises the id", async () => {
    await seed([{ id: "a/b" }]);
    expect((await getItem("A/B.git"))?.repo.id).toBe("a/b");
    expect(await getItem("nope/x")).toBeNull();
  });
});

describe("matches", () => {
  const it_ = item("a/b", { card: { category: "cli", tags: ["mcp"], ecosystem: ["node"], hook: "viral", interest: 6, flags: ["non-english"] }, repo: { language: "Rust", createdAt: daysAgoIso(5), latestReleaseAt: daysAgoIso(2) }, sources: ["hn"] });
  it("defaults: cards only, spam/no-substance excluded", () => {
    expect(matches(item("x/y", { card: null }), {})).toBe(false);
    expect(matches(item("x/y", { card: null }), { cardsOnly: false })).toBe(true);
    expect(matches(item("x/y", { card: { flags: ["spam-suspect"] } }), {})).toBe(false);
    expect(matches(item("x/y", { card: { flags: ["spam-suspect"] } }), { excludeFlags: [] })).toBe(true);
  });
  it("each filter, scalar or array, case-insensitive where it should be", () => {
    expect(matches(it_, { category: "cli" })).toBe(true);
    expect(matches(it_, { category: ["database", "cli"] })).toBe(true);
    expect(matches(it_, { category: "database" })).toBe(false);
    expect(matches(it_, { tag: "MCP" })).toBe(true);
    expect(matches(it_, { tag: "node" })).toBe(true);           // ecosystem counts
    expect(matches(it_, { tag: "zzz" })).toBe(false);
    expect(matches(it_, { hook: ["viral"] })).toBe(true);
    expect(matches(it_, { minInterest: 6 })).toBe(true);
    expect(matches(it_, { minInterest: 7 })).toBe(false);
    expect(matches(it_, { maxInterest: 5 })).toBe(false);
    expect(matches(it_, { language: "rust" })).toBe(true);
    expect(matches(it_, { source: "hn" })).toBe(true);
    expect(matches(it_, { source: "rss" })).toBe(false);
    expect(matches(it_, { createdWithinDays: 7 })).toBe(true);
    expect(matches(it_, { createdWithinDays: 3 })).toBe(false);
    expect(matches(it_, { releasedWithinDays: 3 })).toBe(true);
    expect(matches(item("n/r", {}), { releasedWithinDays: 3 })).toBe(false);   // no release at all
    expect(matches(it_, { exclude: ["a/b"] })).toBe(false);
  });
});

describe("sortItems", () => {
  const a = item("a/a", { card: { interest: 5 }, repo: { stars: 10, starsPerDay: 5, createdAt: "2024-01-01", latestReleaseAt: "2025-01-01" }, priority: 1 });
  const b = item("b/b", { card: { interest: 5 }, repo: { stars: 20, starsPerDay: 1, createdAt: "2025-01-01", latestReleaseAt: "" }, priority: 2 });
  const c = item("c/c", { card: null, repo: { stars: 5, starsPerDay: 9, createdAt: "2023-01-01", latestReleaseAt: "2026-01-01" }, priority: 3 });
  const ids = (xs: ReturnType<typeof sortItems>) => xs.map((x) => x.repo.id);
  it("does not mutate input and orders by each key", () => {
    const input = [a, b, c];
    expect(ids(sortItems(input, "interest"))).toEqual(["a/a", "b/b", "c/c"]);   // equal interest → starsPerDay; no card → −1
    expect(input.map((x) => x.repo.id)).toEqual(["a/a", "b/b", "c/c"]);
    expect(ids(sortItems(input, "velocity"))).toEqual(["c/c", "a/a", "b/b"]);
    expect(ids(sortItems(input, "stars"))).toEqual(["b/b", "a/a", "c/c"]);
    expect(ids(sortItems(input, "created"))).toEqual(["b/b", "a/a", "c/c"]);
    expect(ids(sortItems(input, "released"))).toEqual(["c/c", "a/a", "b/b"]);
    expect(ids(sortItems(input, "priority"))).toEqual(["c/c", "b/b", "a/a"]);
    expect(sortItems(input, "random").sort()).toHaveLength(3);
  });
});

describe("getItems / categories / search", () => {
  it("filters, sorts, limits", async () => {
    await seed([
      { id: "a/one", card: { category: "cli", interest: 9, tags: ["mcp"], pitch: "MCP server for shells" } },
      { id: "a/two", card: { category: "cli", interest: 4 } },
      { id: "a/three", card: { category: "database", interest: 7 }, repo: { description: "a postgres proxy" } },
    ]);
    expect((await getItems({ category: "cli" }, "interest", 1)).map((i) => i.repo.id)).toEqual(["a/one"]);
    expect(await categories()).toEqual([{ category: "cli", count: 2 }, { category: "database", count: 1 }]);
    expect((await search("mcp")).map((i) => i.repo.id)).toEqual(["a/one"]);
    expect((await search("postgres")).map((i) => i.repo.id)).toEqual(["a/three"]);
    expect((await search("a/")).map((i) => i.repo.id)).toEqual(["a/one", "a/three", "a/two"]);   // id hit ×3, then by interest
    expect(await search("  ")).toEqual([]);
  });
});

describe("getItemDetail", () => {
  it("assembles readme, releases, mentions, edges and awesome siblings (capped, self excluded)", async () => {
    await seed([
      { id: "a/b", readme: "# A", releases: [{ tag_name: "v1", body: "notes" }], sources: ["hn"], card: { alternatives: ["c/d"] } },
      { id: "c/d" }, { id: "e/f" },
    ]);
    await addEdges("a/b", "links", ["e/f"]);
    await addAwesome("l/one", ["a/b", "c/d", "e/f", "not/in-corpus"]);
    await invalidate();
    const d = (await getItemDetail("a/b"))!;
    expect(d.readme).toBe("# A");
    expect(d.releases).toEqual([{ tag_name: "v1", body: "notes" }]);
    expect(d.edges.links).toEqual(["e/f"]);
    expect(d.edges.alt).toEqual(["c/d"]);
    expect(d.edges.awesomeSiblings.sort()).toEqual(["c/d", "e/f"]);
    expect(await getItemDetail("nope/x")).toBeNull();
  });
  it("corrupt releases JSON → [] rather than a 500", async () => {
    await seed([{ id: "a/b" }]);
    await mockRedis.set(K.raw("a/b", "releases"), "{corrupt");
    expect((await getItemDetail("a/b"))!.releases).toEqual([]);
  });
});

describe("similar (the voice's 'related repos', now a view over neighbors())", () => {
  it("maps each neighbour's signals to one human reason, in priority order", async () => {
    await seed([
      { id: "me/x", card: { category: "cli", tags: ["specific-tag"], alternatives: ["alt/y"] }, repo: { language: "Go" } },
      { id: "alt/y", card: { category: "database", tags: [] } },
      { id: "me/sib", card: { category: "database", tags: [] } },
      { id: "tag/z", card: { category: "cli", tags: ["specific-tag"] }, vec: undefined },
    ]);
    const s = await similar("me/x");
    const by = new Map(s.map((x) => [x.item.repo.id, x]));
    expect(by.get("alt/y")!.why).toEqual(["named alternative"]);
    expect(by.get("me/sib")!.why).toEqual(["same author"]);
    expect(by.has("tag/z")).toBe(false);              // a shared tag alone, with no vectors, is not enough to be related
    expect(await similar("nope/x")).toEqual([]);
  });
});

describe("upsertSnapshotItem", () => {
  it("patches one repo into the stored snapshot without losing another process's concurrent patch (regression: cache-based read-modify-write)", async () => {
    await seed([{ id: "a/one" }]);
    await allItems();                                                   // warm the in-process cache with [a/one]
    // "Another process" writes b/two straight to Redis and rebuilds the snapshot; our cache does not know.
    await saveRepo({ id: "b/two", stars: 1 }, {});
    const { readmeHash, model, enrichedAt, inputTokens, outputTokens, ...pure } = card();
    await saveCard("b/two", pure, { readmeHash, model, enrichedAt, inputTokens, outputTokens });
    await writeSnapshot(await assembleItems());
    // Now we upsert c/three. A cache-based patch would write [a/one, c/three] and lose b/two.
    await saveRepo({ id: "c/three", stars: 1 }, {});
    await upsertSnapshotItem("c/three");
    expect((await readSnapshot())!.items.map((i) => i.repo.id).sort()).toEqual(["a/one", "b/two", "c/three"]);
  });
  it("removes a repo from the snapshot when its keys are gone", async () => {
    await seed([{ id: "a/one" }, { id: "b/two" }]);
    await mockRedis.del(K.repo("b/two"));
    await upsertSnapshotItem("b/two");
    expect((await readSnapshot())!.items.map((i) => i.repo.id)).toEqual(["a/one"]);
  });
});
