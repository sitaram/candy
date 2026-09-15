import { describe, it, expect } from "vitest";
import { RepoId, RepoSeg, Int, Many, Text, FeedQuery, SearchQuery, ReactBody, AskBody, ItemsQuery, VoiceSessionBody, VoiceToolBody, VoiceTrace } from "./schemas";

describe("RepoId", () => {
  it("normalizes case, URL prefix, trailing slash and .git", () => {
    expect(RepoId.parse("  OpenAI/Codex ")).toBe("openai/codex");
    expect(RepoId.parse("https://github.com/OpenAI/codex/")).toBe("openai/codex");
    expect(RepoId.parse("openai/codex.git")).toBe("openai/codex");
  });
  it("rejects anything that is not owner/name", () => {
    for (const bad of ["", "codex", "a/b/c", "../etc/passwd", "a b/c", ".hidden/x", "a/", "/b", "owner/na me", `${"o".repeat(40)}/x`]) {
      expect(RepoId.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("RepoSeg", () => {
  it("accepts GitHub-legal segments and nothing else", () => {
    expect(RepoSeg.parse("Next.js")).toBe("Next.js");
    for (const bad of ["", "..", "a/b", "a%2Fb", "a b", "x".repeat(101)]) expect(RepoSeg.safeParse(bad).success, bad).toBe(false);
  });
});

describe("Int / Many / Text", () => {
  it("Int defaults on missing, clamps by rejecting, refuses NaN and floats", () => {
    const N = Int(1, 100, 30);
    expect(N.parse(undefined)).toBe(30);
    expect(N.parse("")).toBe(30);
    expect(N.parse("7")).toBe(7);
    for (const bad of ["abc", "0", "101", "1.5", "-3"]) expect(N.safeParse(bad).success, bad).toBe(false);
  });
  it("Many accepts one or several, bounds the count", () => {
    const M = Many(RepoId, 2);
    expect(M.parse(undefined)).toEqual([]);
    expect(M.parse("a/b")).toEqual(["a/b"]);
    expect(M.parse(["a/b", "c/d"])).toEqual(["a/b", "c/d"]);
    expect(M.safeParse(["a/b", "c/d", "e/f"]).success).toBe(false);
  });
  it("Text strips control chars, trims, bounds length", () => {
    expect(Text(10).parse("  hi\u0000\u0007there\u001b ")).toBe("hithere");
    expect(Text(3).safeParse("abcd").success).toBe(false);
    expect(Text(10).parse("tab\tok\nnl")).toBe("tab\tok\nnl");   // whitespace controls kept
  });
});

describe("route schemas", () => {
  it("FeedQuery: defaults and bounds", () => {
    expect(FeedQuery.parse({})).toEqual({ n: 30, exclude: [] });
    expect(FeedQuery.parse({ n: "5", exclude: ["A/B", "c/d"] })).toEqual({ n: 5, exclude: ["a/b", "c/d"] });
    expect(FeedQuery.safeParse({ n: "1000" }).success).toBe(false);
    expect(FeedQuery.safeParse({ exclude: Array.from({ length: 201 }, (_, i) => `a/b${i}`) }).success).toBe(false);
  });
  it("SearchQuery: q optional, bounded", () => {
    expect(SearchQuery.parse({})).toEqual({ q: "", n: 20 });
    expect(SearchQuery.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
  it("ReactBody: only known kinds", () => {
    expect(ReactBody.parse({ id: "A/B", kind: "like" })).toEqual({ id: "a/b", kind: "like" });
    expect(ReactBody.safeParse({ id: "a/b", kind: "nuke" }).success).toBe(false);
    expect(ReactBody.safeParse({ kind: "like" }).success).toBe(false);
  });
  it("AskBody: non-empty question, bounded history", () => {
    expect(AskBody.safeParse({ id: "a/b", question: "   " }).success).toBe(false);
    expect(AskBody.parse({ id: "a/b", question: " why? " }).question).toBe("why?");
    expect(AskBody.safeParse({ id: "a/b", question: "q", history: Array.from({ length: 9 }, () => ({ q: "a", a: "b" })) }).success).toBe(false);
  });
  it("ItemsQuery: enums are enforced, cardsOnly defaults true", () => {
    const q = ItemsQuery.parse({});
    expect(q.sort).toBe("interest"); expect(q.cardsOnly).toBe(true); expect(q.limit).toBe(50);
    expect(ItemsQuery.parse({ cardsOnly: "0" }).cardsOnly).toBe(false);
    expect(ItemsQuery.safeParse({ sort: "evil" }).success).toBe(false);
    expect(ItemsQuery.safeParse({ category: "not-a-category" }).success).toBe(false);
    expect(ItemsQuery.safeParse({ tag: "rm -rf" }).success).toBe(false);
  });
  it("VoiceSessionBody: discriminated on mode, legacy no-mode means card", () => {
    expect(VoiceSessionBody.parse({ mode: "search", query: "x" })).toEqual({ mode: "search", query: "x" });
    expect(VoiceSessionBody.parse({ mode: "card", id: "A/B" })).toEqual({ mode: "card", id: "a/b" });
    expect(VoiceSessionBody.parse({ id: "a/b" })).toMatchObject({ mode: "card", id: "a/b" });
    expect(VoiceSessionBody.safeParse({ mode: "card" }).success).toBe(false);
    expect(VoiceSessionBody.safeParse({ mode: "other" }).success).toBe(false);
  });
  it("VoiceToolBody: only the three server tools", () => {
    expect(VoiceToolBody.parse({ name: "get_repo" })).toEqual({ name: "get_repo", args: {} });
    expect(VoiceToolBody.safeParse({ name: "react" }).success).toBe(false);
  });
  it("VoiceTrace: bounded entries", () => {
    expect(VoiceTrace.safeParse({ id: "t1", entries: new Array(5001).fill(0) }).success).toBe(false);
    expect(VoiceTrace.safeParse({}).success).toBe(false);
  });
});
