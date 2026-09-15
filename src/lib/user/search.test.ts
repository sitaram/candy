import { describe, it, expect } from "vitest";
import { keywords, looksLikeName } from "./search";

describe("keywords", () => {
  it("lowercases, drops stop-words and 1-char tokens, dedupes, keeps + # . / -", () => {
    expect(keywords("I want to build a Voice Agent for C# and c++")).toEqual(["voice", "agent", "c#", "c++"]);
    expect(keywords("mcp MCP mcp")).toEqual(["mcp"]);
    expect(keywords("a b c")).toEqual([]);
    expect(keywords("e2e-testing node.js owner/repo")).toEqual(["e2e-testing", "node.js", "owner/repo"]);
  });
  it("strips punctuation that is not part of an identifier", () => {
    expect(keywords("what's the best (rust) framework?")).toEqual(["what", "rust"]);
  });
});

describe("looksLikeName", () => {
  it.each([
    ["ollama", true], ["owner/repo", true], ["a.b-c_d/e.f", true], ["ab", false], ["two words", false], ["owner/repo/extra", false], ["", false], ["  ollama  ", true],
  ])("%j → %s", (q, want) => expect(looksLikeName(q)).toBe(want));
});
