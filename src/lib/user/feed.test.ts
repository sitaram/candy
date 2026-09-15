import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { feed, act } from "./feed";
import { react, getSeen, isSaved, touchVisit } from "./state";
import { getItem, invalidate } from "@/lib/corpus/api";
import { seed, daysAgoIso, NOW, vec } from "@/test/fixtures";

beforeAll(() => vi.useFakeTimers({ now: NOW }));
beforeEach(() => vi.setSystemTime(NOW));
afterAll(() => vi.useRealTimers());
const U = "u";

describe("feed", () => {
  it("returns ranked FeedItems minus seen and excluded, rounds scores, marks saved, reports profile size", async () => {
    await seed([
      { id: "a/hi", card: { interest: 9, tags: ["x"] } }, { id: "a/mid", card: { interest: 6, tags: ["y"] } },
      { id: "a/seen", card: { interest: 9, tags: ["z"] } }, { id: "a/ex", card: { interest: 9, tags: ["w"] } }, { id: "a/nocard", card: null },
    ]);
    await react(U, (await getItem("a/seen"))!, "skip");
    await react(U, (await getItem("a/mid"))!, "save");
    const f = await feed(U, 10, ["a/ex"]);
    expect(f.items.map((i) => i.id)).toEqual(["a/hi", "a/mid"]);
    expect(f.items[1].saved).toBe(true);
    expect(f.items[0].saved).toBe(false);
    expect(f.items[0].score).toBe(Math.round(f.items[0].score * 100) / 100);
    expect(f.profileSize).toBeGreaterThan(0);
    expect(f.items[0].item.card).not.toBeNull();
  });
  it("first visit: since is empty and lastVisit 0; second visit: counts fresh cards, fresh in your categories, releases on saved", async () => {
    await seed([
      { id: "s/aved", card: { category: "cli", enrichedAt: daysAgoIso(10) }, repo: { latestRelease: "v9", latestReleaseAt: daysAgoIso(0) } },
      { id: "o/ld", card: { category: "cli", enrichedAt: daysAgoIso(10) } },
    ]);
    await react(U, (await getItem("s/aved"))!, "save");
    await react(U, (await getItem("o/ld"))!, "like");            // teaches cat:cli — and must NOT count as a visit (regression)
    let f = await feed(U);
    expect(f.since).toEqual({ lastVisit: 0, newInCorpus: 0, newInYourAreas: 0, releasesOnSaved: [] });
    // Come back 3 days later; two cards were enriched meanwhile, one in cli.
    vi.setSystemTime(NOW + 3 * 86_400_000);
    await seed([{ id: "n/ew1", card: { category: "cli", enrichedAt: new Date(NOW + 86_400_000).toISOString() } }, { id: "n/ew2", card: { category: "science", enrichedAt: new Date(NOW + 86_400_000).toISOString() } }]);
    // releases on saved: s/aved's release must be *after* the last visit; move it.
    const { saveRepo } = await import("@/lib/store/corpus");
    await saveRepo({ id: "s/aved", latestRelease: "v10", latestReleaseAt: new Date(NOW + 2 * 86_400_000).toISOString() }, {});
    await invalidate();
    f = await feed(U);
    expect(f.since.lastVisit).toBe(NOW);
    expect(f.since.newInCorpus).toBe(2);
    expect(f.since.newInYourAreas).toBe(1);
    expect(f.since.releasesOnSaved).toEqual([{ id: "s/aved", tag: "v10", at: new Date(NOW + 2 * 86_400_000).toISOString() }]);
  });
  it("uses the taste vector only when confident; a liked card's neighbour rises", async () => {
    function at(cos: number) { const v = new Float32Array(512); v[0] = cos; v[1] = Math.sqrt(1 - cos * cos); return v; }
    await seed([
      { id: "l/iked", card: { interest: 5, tags: ["q"] }, vec: vec(0) },
      { id: "n/ear", card: { interest: 5, tags: ["r"] }, vec: at(0.75) },
      { id: "f/ar", card: { interest: 5.5, tags: ["s"] }, vec: at(0.1) },
    ]);
    // Six likes of the *same* card are now one like (idempotent); use six identical-vector cards for weight 6 → full confidence.
    await seed([1, 2, 3, 4, 5].map((i) => ({ id: `l/iked${i}`, card: { interest: 5, tags: ["q"] }, vec: vec(0) })));
    for (const id of ["l/iked", "l/iked1", "l/iked2", "l/iked3", "l/iked4", "l/iked5"]) await react(U, (await getItem(id))!, "like");
    const f = await feed(U);
    expect(f.items.map((i) => i.id)).toEqual(["n/ear", "f/ar"]);
    expect(f.items[0].fit).toBeGreaterThan(0.5);                 // 0.4·terms + 0.6·cos-fit(≈1)
    expect(f.items[1].fit).toBeLessThan(0);
    // Both share the liked card's category/language terms, so the term line wins the explanation slot; the
    // embedding line appears only when terms have nothing to say (covered in rank.test).
    expect(f.items[0].why[0]).toMatch(/^matches your interest/);
  });
});

describe("act", () => {
  it("routes like/skip/save/dive to react, unsave and undo to their handlers; false for unknown ids", async () => {
    await seed([{ id: "a/b" }]);
    expect(await act(U, "a/b", "like")).toBe(true);
    expect(await getSeen(U)).toEqual(new Set(["a/b"]));
    expect(await act(U, "a/b", "undo")).toBe(true);
    expect(await getSeen(U)).toEqual(new Set());
    expect(await act(U, "a/b", "undo")).toBe(false);          // nothing to undo now
    expect(await act(U, "a/b", "save")).toBe(true);
    expect(await isSaved(U, ["a/b"])).toEqual(new Set(["a/b"]));
    expect(await act(U, "a/b", "unsave")).toBe(true);
    expect(await isSaved(U, ["a/b"])).toEqual(new Set());
    expect(await act(U, "nope/x", "like")).toBe(false);
  });
});
