import { describe, it, expect, vi, beforeEach } from "vitest";
import { seed } from "@/test/fixtures";

const fetchRepo = vi.fn();
vi.mock("../crawl/fetchRepo", () => ({ fetchRepo: (...a: unknown[]) => fetchRepo(...a) }));
const enrichOne = vi.fn();
vi.mock("../enrich/llm", () => ({ enrichOne: (...a: unknown[]) => enrichOne(...a) }));

const { ensureItem } = await import("./ensure");

beforeEach(() => { fetchRepo.mockReset(); enrichOne.mockReset(); });

describe("ensureItem", () => {
  it("a repo already in the corpus with a fresh card costs nothing: no fetch, no model", async () => {
    await seed([{ id: "a/b", card: {} }]);
    const r = await ensureItem("a/b");
    expect(r).toEqual({ id: "a/b", fetched: false, enriched: false, exists: true });
    expect(fetchRepo).not.toHaveBeenCalled(); expect(enrichOne).not.toHaveBeenCalled();
  });
  it("an unknown repo GitHub does not have is exists:false, and nothing is written", async () => {
    fetchRepo.mockResolvedValue(null);
    expect(await ensureItem("no/pe")).toEqual({ id: "no/pe", fetched: false, enriched: false, exists: false });
  });
  it("concurrent calls for the same id share one in-flight promise (one fetch, one card), then the map is cleared", async () => {
    let release!: () => void;
    fetchRepo.mockImplementation(() => new Promise((res) => { release = () => res({ repo: { id: "x/y", owner: "x", name: "y", url: "https://github.com/x/y", description: "d", homepage: null, language: "Go", license: null, topics: [], stars: 1, forks: 0, watchers: 0, openIssues: 0, createdAt: "2025-01-01T00:00:00Z", pushedAt: "2025-01-02T00:00:00Z", starsPerDay: 0, archived: false, fork: false, releaseCount: 0, latestRelease: "", latestReleaseAt: "", fetchedAt: "2025-01-02T00:00:00Z" }, readme: "# y", manifest: null, manifestKind: null, releases: [] }); }));
    enrichOne.mockResolvedValue({ card: { pitch: "p", whyCare: "w", voice: "v", category: "cli", tags: ["t"], audience: [], ecosystem: [], maturity: "usable", kind: "cli", alternatives: [], buildsOn: [], hook: "none", interest: 5, flags: [], lang: "en" }, model: "m", inputTokens: 1, outputTokens: 1 });
    const p1 = ensureItem("x/y"), p2 = ensureItem("X/Y"), p3 = ensureItem(" x/y.git ");
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(fetchRepo).toHaveBeenCalledTimes(1);
    expect(enrichOne).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2); expect(r2).toEqual(r3);
    expect(r1).toMatchObject({ id: "x/y", fetched: true, enriched: true, exists: true });
    // Done: a later call is a fresh, cheap lookup.
    const again = await ensureItem("x/y");
    expect(again.fetched).toBe(false); expect(fetchRepo).toHaveBeenCalledTimes(1);
  });
});
