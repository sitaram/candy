/** Store layer: key schema, repo serialization, raw-doc compression, discovery, crawl scheduling, edges. */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { K, normId } from "./keys";
import { parseRepo, serializeRepo } from "./types";
import { encodeRaw, decodeRaw, boundReleases, setRaw, getRaw, MAX_README, MAX_RELEASE_BODY, MAX_RELEASES } from "./raw";
import { discover, nextToCrawl, saveRepo, markUnfetchable, addEdges, addAwesome, getRepo, getRepos, getMentions, getTags, getEdges, corpusIds, stats } from "./corpus";
import { mockRedis } from "@/test/setup";
import { NOW } from "@/test/fixtures";

beforeAll(() => vi.useFakeTimers({ now: NOW }));
afterAll(() => vi.useRealTimers());

describe("keys", () => {
  it("normId lowercases, trims and strips .git", () => {
    expect(normId("  OpenAI/Codex.git ")).toBe("openai/codex");
  });
  it("keys are distinct per (id, kind)", () => {
    const ks = [K.repo("a/b"), K.raw("a/b", "readme"), K.raw("a/b", "manifest"), K.raw("a/b", "releases"), K.mentions("a/b"), K.stars("a/b"), K.edges("a/b", "links"), K.edges("a/b", "depends"), K.tags("a/b"), K.awesome("x")];
    expect(new Set(ks).size).toBe(ks.length);
  });
});

describe("parseRepo / serializeRepo", () => {
  it("round-trips a repo through string fields; arrays as JSON, booleans as 'true'/'false'", () => {
    const r = parseRepo(serializeRepo({ id: "a/b", owner: "a", name: "b", stars: 42, topics: ["x", "y"], archived: true, fork: false, starsPerDay: 1.5 }))!;
    expect(r).toMatchObject({ id: "a/b", stars: 42, topics: ["x", "y"], archived: true, fork: false, starsPerDay: 1.5 });
  });
  it("returns null without an id; defaults every missing field; tolerates corrupt JSON and NaN numerics", () => {
    expect(parseRepo({})).toBeNull();
    const r = parseRepo({ id: "a/b", topics: "{not json", stars: "lots", archived: "yes" })!;
    expect(r.topics).toEqual([]);
    expect(r.stars).toBe(0);
    expect(r.archived).toBe(false);
    expect(r.url).toBe("https://github.com/a/b");
    expect(r.defaultBranch).toBe("main");
    expect(r.manifestKind).toBe("none");
  });
  it("serialize skips null/undefined", () => {
    expect(serializeRepo({ id: "a/b", homepage: undefined, license: null as unknown as string })).toEqual({ id: "a/b" });
  });
});

describe("raw docs", () => {
  it("gzip round-trip with marker; legacy plain buffers still decode; null → empty", () => {
    const big = "x".repeat(10_000);
    const enc = encodeRaw(big);
    expect(enc.length).toBeLessThan(big.length / 4);
    expect(decodeRaw(enc)).toBe(big);
    expect(decodeRaw(Buffer.from("plain text"))).toBe("plain text");
    expect(decodeRaw(null)).toBe("");
    expect(decodeRaw(encodeRaw("héllo → 🌍"))).toBe("héllo → 🌍");
  });
  it("boundReleases caps count and body length, keeps null bodies", () => {
    const rel = Array.from({ length: 20 }, (_, i) => ({ tag: `v${i}`, body: i === 0 ? null : "b".repeat(10_000) }));
    const b = boundReleases(rel);
    expect(b).toHaveLength(MAX_RELEASES);
    expect(b[0].body).toBeNull();
    expect(b[1].body).toHaveLength(MAX_RELEASE_BODY);
  });
  it("setRaw/getRaw through Redis", async () => {
    await setRaw("a/b", "readme", "# hi");
    expect(await getRaw("a/b", "readme")).toBe("# hi");
    expect(await getRaw("a/b", "manifest")).toBe("");
  });
});

describe("discover", () => {
  it("bumps frontier once per (repo, source) per run, records first-seen NX, tags the source family, logs evidence", async () => {
    const n = await discover([
      { repo: "A/B", source: "rss:changelog", weight: 1, evidence: { source: "rss", title: "t", url: "u", ts: "now" } },
      { repo: "a/b", source: "rss:changelog", weight: 1 },          // same repo+source: no second bump
      { repo: "a/b", source: "hn", weight: 2 },
      { repo: "not a repo", source: "hn", weight: 5 },              // rejected
    ]);
    expect(n).toBe(1);
    expect(Number(await mockRedis.zscore(K.frontier, "a/b"))).toBe(3);
    expect(await getTags("a/b")).toEqual(expect.arrayContaining(["src:rss", "src:hn"]));
    expect(await getMentions("a/b")).toEqual([{ source: "rss", title: "t", url: "u", ts: "now" }]);
    expect(await mockRedis.zscore(K.frontier, "not a repo")).toBeNull();
    expect(await discover([])).toBe(0);
  });
  it("dedupes mentions on URL across runs and caps the list: an hourly HN window re-run does not append the same story again", async () => {
    const ev = (url: string) => ({ source: "hn" as const, title: "t", url, ts: "now" });
    await discover([{ repo: "a/b", source: "hn", weight: 1, evidence: ev("u1") }]);
    await discover([{ repo: "a/b", source: "hn", weight: 1, evidence: ev("u1") }, { repo: "a/b", source: "rss", weight: 1, evidence: ev("u2") }]);
    expect((await getMentions("a/b")).map((m) => m.url)).toEqual(["u1", "u2"]);
    for (let i = 0; i < 60; i++) await discover([{ repo: "a/b", source: "hn", weight: 0, evidence: ev(`x${i}`) }]);
    expect((await getMentions("a/b")).length).toBe(50);
  });
  it("getMentions drops corrupt rows instead of throwing", async () => {
    await mockRedis.rpush(K.mentions("a/b"), "{bad", JSON.stringify({ source: "hn", title: "ok", url: "u", ts: "t" }));
    expect(await getMentions("a/b")).toEqual([{ source: "hn", title: "ok", url: "u", ts: "t" }]);
  });
});

describe("saveRepo / getRepo", () => {
  it("stores the hash, joins corpus, marks fetched, snapshots stars, folds log2(stars) into priority, tags language and topics, compresses raw docs", async () => {
    await saveRepo({ id: "A/B", owner: "a", name: "b", stars: 1023, language: "Rust", topics: ["cli"] }, { readme: "# R", manifest: "{}", releases: JSON.stringify([{ tag_name: "v1", body: "x".repeat(9000) }]) });
    const r = (await getRepo("a/b"))!;
    expect(r.stars).toBe(1023);
    expect(r.fetchedAt).toBe(new Date(NOW).toISOString());
    expect(await corpusIds()).toEqual(["a/b"]);
    expect(Number(await mockRedis.zscore(K.frontier, "a/b"))).toBeCloseTo(10);
    expect(await getTags("a/b")).toEqual(expect.arrayContaining(["lang:rust", "topic:cli"]));
    expect(await getRaw("a/b", "readme")).toBe("# R");
    const rel = JSON.parse(await getRaw("a/b", "releases")) as { body: string }[];
    expect(rel[0].body).toHaveLength(MAX_RELEASE_BODY);
    expect(await stats()).toMatchObject({ corpus: 1, fetched: 1 });
  });
  it("tiny repos are penalised in priority; README is capped", async () => {
    await saveRepo({ id: "t/iny", stars: 3 }, { readme: "y".repeat(MAX_README + 500) });
    expect(Number(await mockRedis.zscore(K.frontier, "t/iny"))).toBe(-3);
    expect((await getRaw("t/iny", "readme")).length).toBe(MAX_README);
  });
  it("getRepos preserves found repos and skips unknown ids", async () => {
    await saveRepo({ id: "a/b", stars: 1 }, {});
    await saveRepo({ id: "c/d", stars: 1 }, {});
    expect((await getRepos(["a/b", "nope/x", "c/d"])).map((r) => r.id)).toEqual(["a/b", "c/d"]);
    expect(await getRepos([])).toEqual([]);
    expect(await getRepo("nope/x")).toBeNull();
  });
});

describe("nextToCrawl", () => {
  it("returns top-priority unfetched or stale repos, skipping fresh ones and parked ones", async () => {
    await discover([{ repo: "hi/p", source: "hn", weight: 10 }, { repo: "fresh/x", source: "hn", weight: 9 }, { repo: "stale/y", source: "hn", weight: 8 }, { repo: "parked/z", source: "hn", weight: 7 }, { repo: "lo/p", source: "hn", weight: 1 }]);
    await mockRedis.zadd(K.fetched, NOW - 1000, "fresh/x");
    await mockRedis.zadd(K.fetched, NOW - 8 * 86_400_000, "stale/y");
    await markUnfetchable("parked/z");
    expect(await nextToCrawl(3)).toEqual(["hi/p", "stale/y", "lo/p"]);
    expect(await nextToCrawl(3, 30 * 86_400_000)).toEqual(["hi/p", "lo/p"]);
    await mockRedis.flushdb();
    expect(await nextToCrawl(3)).toEqual([]);
  });
});

describe("edges / awesome", () => {
  it("addEdges normalises, drops self-links, is a no-op when empty", async () => {
    await addEdges("A/B", "links", ["a/b", "C/D.git", "e/f"]);
    expect((await getEdges("a/b", "links")).sort()).toEqual(["c/d", "e/f"]);
    await addEdges("a/b", "links", ["a/b"]);
    expect(await getEdges("a/b", "links")).toHaveLength(2);
  });
  it("addAwesome records membership both ways", async () => {
    await addAwesome("sindresorhus/awesome", ["X/Y"]);
    expect(await mockRedis.smembers(K.awesome("sindresorhus/awesome"))).toEqual(["x/y"]);
    expect(await getTags("x/y")).toEqual(["awesome:sindresorhus/awesome"]);
  });
});
