import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { briefOf, spoken, buildSearchContext, buildContext, cardChangeBrief, TOOLS, SEARCH_TOOLS } from "./context";
import { item, daysAgoIso, NOW, seed, feedItem } from "@/test/fixtures";
import { getItem } from "@/lib/corpus/api";
import type { Me } from "@/lib/user/state";

beforeAll(() => vi.useFakeTimers({ now: NOW }));
afterAll(() => vi.useRealTimers());

describe("briefOf", () => {
  it("is a labelled, line-per-fact brief with everything the card knows, and no empty sections", () => {
    const b = briefOf(item("acme/tool", {
      card: { pitch: "P.", whyCare: "W.", category: "cli", kind: "cli", maturity: "mature", interest: 7, audience: ["ops"], tags: ["a"], ecosystem: [], hook: "viral", alternatives: ["x/y"], buildsOn: [], flags: ["abandoned"] },
      repo: { stars: 12_345, starsPerDay: 40, createdAt: daysAgoIso(400), pushedAt: daysAgoIso(1), language: "Go", license: "MIT", latestRelease: "v2", latestReleaseAt: daysAgoIso(3), archived: true },
      sources: ["hn"], awesome: ["l/one"],
    }), { why: ["on Hacker News", "matches your interest in cli"] });
    expect(b).toContain("REPO acme/tool — https://github.com/acme/tool");
    expect(b).toContain("Pitch: P.");
    expect(b).toContain("Category: CLI. Kind: cli. Maturity: mature. Interest 0-10: 7.");
    expect(b).toContain("For: ops.");
    expect(b).not.toContain("Ecosystem:");
    expect(b).toContain("Hook: viral.");
    expect(b).toContain("Alternatives it names: x/y.");
    expect(b).toContain("Quality flags: abandoned.");
    expect(b).toMatch(/Stats: 12k stars, \+40\/day, created 1\.1 years ago, last push yesterday\. Language: Go\. License: MIT\. ARCHIVED\./);
    expect(b).toContain("Latest release: v2 (3 days ago).");
    expect(b).toContain("Seen on: hn; in awesome lists: l/one.");
    expect(b).toContain("Why it is in this user's feed: on Hacker News; matches your interest in cli.");
  });
  it("without a card falls back to the description; slow growth and missing fields are worded, not blank", () => {
    const b = briefOf(item("a/b", { card: null, repo: { description: "D", starsPerDay: 0.2, language: "", license: "" } }));
    expect(b).toContain("Description: D");
    expect(b).toMatch(/slow growth/);
    expect(b).toContain("Language: n/a. License: none.");
    expect(b).not.toContain("Latest release");
  });
  it("full mode appends releases (≤3, bodies squashed to 280 chars), mentions (≤4) and a README excerpt (≤1800)", () => {
    const d = {
      ...item("a/b"), readme: "R ".repeat(2000), mentions: Array.from({ length: 6 }, (_, i) => ({ source: "hn", title: `T${i}`, url: "", ts: "", points: 10 })),
      releases: Array.from({ length: 5 }, (_, i) => ({ tag_name: `v${i}`, name: null, published_at: daysAgoIso(i), prerelease: false, body: "line\n\nline ".repeat(100) })),
      edges: { links: [], alt: [], buildsOn: [], awesomeSiblings: [] },
    };
    const b = briefOf(d, { full: true });
    expect(b.match(/^\s+- v\d/gm)).toHaveLength(3);
    expect(b.match(/^\s+- hn: T/gm)).toHaveLength(4);
    expect(b).toContain("T0 (10 points)");
    const rel = b.split("\n").find((l) => l.includes("- v0"))!;
    expect(rel.length).toBeLessThan(320);
    expect(rel).not.toContain("\n");
    expect(b.split("README (excerpt): ")[1].length).toBeLessThanOrEqual(1800);
    expect(briefOf(d)).not.toContain("README");            // not without full
  });
});

describe("spoken", () => {
  it("uses the dictionary, then rules: short languages upper-cased, long ones capitalised, categories and tags de-hyphenated", () => {
    expect(spoken("cat:ai-agents")).toBe("AI agents");
    expect(spoken("mcp")).toBe("MCP servers");
    expect(spoken("lang:go")).toBe("GO");
    expect(spoken("lang:typescript")).toBe("Typescript");
    expect(spoken("cat:unknown-thing")).toBe("unknown thing");
    expect(spoken("voice-agents")).toBe("voice agents");
  });
});

describe("buildSearchContext", () => {
  const me = (top: string[]): Me => ({ uid: "u", reactions: 9, counts: { like: 5, skip: 2, save: 1, dive: 1 }, topTerms: top.map((t, i) => ({ term: t, w: 5 - i })), avoidTerms: [], saved: [], liked: [], skipped: [], dived: [], seen: 20, lastVisit: 0, firstSeen: 0, tasteWeight: 6 });
  it("new user: generic invitation; returning: names learned interests; typed query: a query-aware invitation", () => {
    const fresh = buildSearchContext(null);
    expect(fresh).toContain("New user.");
    expect(fresh).not.toContain("They have history");
    const ret = buildSearchContext(me(["mcp", "rust", "cat:cli"]));
    expect(ret).toContain("They have history");
    expect(ret).toMatch(/MCP servers|Rust/);
    const typed = buildSearchContext(null, "voice agent framework");
    expect(typed).toContain(`They already typed "voice agent framework"`);
    // The instructions are a style guide: labelled sections, a word budget, a flow — not a paragraph.
    for (const h of ["# Role and Objective", "# Flow", "# Verbosity", "# Rules"]) expect(fresh).toContain(h);
  });
  it("only ever hands the model the search tool set", () => {
    expect(SEARCH_TOOLS.map((t) => t.name)).toContain("search");
    expect(TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["get_repo", "find_repos", "next_card", "react", "show_repo", "ask_repo"]));
    for (const t of [...TOOLS, ...SEARCH_TOOLS]) expect(t).toMatchObject({ type: "function", name: expect.any(String), parameters: expect.any(Object) });
  });
});

describe("buildContext / cardChangeBrief (against the corpus)", () => {
  it("bakes the full brief, the feed reason, six similar repos and the profile into the session instructions", async () => {
    await seed([
      { id: "me/x", card: { category: "cli", tags: ["a"], alternatives: ["alt/y"] }, readme: "# Readme body", releases: [{ tag_name: "v1", published_at: daysAgoIso(1), body: "notes" }] },
      { id: "alt/y", card: { category: "cli", tags: ["a"], pitch: "Alt pitch" } },
    ]);
    const cur = feedItem((await getItem("me/x"))!, { why: ["on Hacker News"] });
    const me: Me = { uid: "u", reactions: 3, counts: { like: 3, skip: 0, save: 0, dive: 0 }, topTerms: [{ term: "mcp", w: 2 }], avoidTerms: [{ term: "lang:php", w: -1 }], saved: [], liked: [], skipped: [], dived: [], seen: 3, lastVisit: 0, firstSeen: 0, tasteWeight: 3 };
    const ctx = await buildContext(cur, me);
    expect(ctx.cardBrief).toContain("README (excerpt): # Readme body");
    expect(ctx.cardBrief).toContain("- v1 (yesterday): notes");
    expect(ctx.instructions).toContain("Why it is in this user's feed: on Hacker News.");
    expect(ctx.instructions).toContain("- alt/y: Alt pitch (1.0k★; named alternative)");
    expect(ctx.instructions).toContain("Interests (learned from swipes, strongest first): MCP servers. Tends to skip: PHP. 3 reactions so far.");
    for (const h of ["# Opening", "# Tools", "# Ending", "# Current card", "# Related repos in the corpus"]) expect(ctx.instructions).toContain(h);
    expect(ctx.instructions).toMatch(/show_repo the moment you shift/);
    const anon = await buildContext(cur, null);
    expect(anon.instructions).toContain("New user; no learned interests yet.");
  });
  it("cardChangeBrief is the short form: no README, up to four related", async () => {
    await seed([{ id: "me/x", card: { tags: ["a"] }, readme: "# R" }, { id: "o/y", card: { tags: ["a"], pitch: "Y pitch" } }]);
    const b = await cardChangeBrief(feedItem((await getItem("me/x"))!));
    expect(b.startsWith("The card on screen is now:\nREPO me/x")).toBe(true);
    expect(b).not.toContain("README");
    expect(b).toContain("Related:\n  - o/y: Y pitch");
  });
});
