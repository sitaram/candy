import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { react, unsave, undo, getProfile, getSeen, getReactions, isSaved, markSeen, touchVisit, me, resetTaste, loadUser, UK } from "./state";
import { EK, getTaste, putEmbeddings } from "@/lib/embed";
import { item, vec, NOW } from "@/test/fixtures";
import { mockRedis } from "@/test/setup";

beforeAll(() => vi.useFakeTimers({ now: NOW }));
beforeEach(() => vi.setSystemTime(NOW));
afterAll(() => vi.useRealTimers());

const U = "u1";
const A = item("x/a", { card: { tags: ["mcp", "cli"], ecosystem: ["node"], category: "dev-tools" }, repo: { language: "TypeScript" } });
const B = item("x/b", { card: { tags: ["bio"], category: "science" }, repo: { language: "Python" } });

const prof = async () => Object.fromEntries(await getProfile(U));

describe("react", () => {
  it("like: +1 per tag/eco, +0.6 category, +0.5 language; marks seen and records the reaction", async () => {
    await react(U, A, "like");
    expect(await prof()).toEqual({ mcp: 1, cli: 1, node: 1, "cat:dev-tools": 0.6, "lang:typescript": 0.5 });
    expect(await getSeen(U)).toEqual(new Set(["x/a"]));
    expect(await getReactions(U)).toEqual(new Map([["x/a", "like"]]));
    expect(await mockRedis.hgetall(UK.meta(U))).toMatchObject({ reactions: "1", n_like: "1" });
  });
  it("skip is a gentle −0.5 and also marks seen", async () => {
    await react(U, A, "skip");
    expect((await prof()).mcp).toBe(-0.5);
    expect(await getSeen(U)).toEqual(new Set(["x/a"]));
  });
  it("save weighs 2, bookmarks, and does NOT mark seen (the card must stay on screen)", async () => {
    await react(U, A, "save");
    expect((await prof()).mcp).toBe(2);
    expect(await isSaved(U, ["x/a", "x/b"])).toEqual(new Set(["x/a"]));
    expect(await getSeen(U)).toEqual(new Set());
    expect(await getReactions(U).then((m) => m.size)).toBe(0);
  });
  it("dive weighs 1.5", async () => {
    await react(U, A, "dive");
    expect((await prof()).mcp).toBe(1.5);
  });
  it("accumulates across reactions and prunes terms that decay to |w| < 0.05", async () => {
    // Two cards with the same terms: like one, skip both. 1 − 0.5 − 0.5 = 0 → pruned. (Reacting to the
    // same card twice with the same kind is a no-op now, so the second skip must come from a sibling.)
    const A2 = item("a/b2", { card: { tags: ["mcp", "cli", "node"], category: "dev-tools" }, repo: { language: "TypeScript" } });
    await react(U, A, "like");
    await react(U, A, "skip");
    await react(U, A2, "skip");
    expect(await prof()).toEqual({});
  });
  it("decays the profile by 0.98/day between reactions", async () => {
    await react(U, A, "like");
    vi.setSystemTime(NOW + 10 * 86_400_000);
    await react(U, B, "like");
    const p = await prof();
    expect(p.mcp).toBeCloseTo(Math.pow(0.98, 10), 3);
    expect(p.bio).toBe(1);
  });
  it("nudges the taste vector toward liked cards when the card is embedded, weight = Σ|delta|", async () => {
    await putEmbeddings([{ id: "x/a", v: vec(0) }, { id: "x/b", v: vec(1) }]);
    await react(U, A, "like");
    let t = (await getTaste(U))!;
    expect(t.w).toBe(1);
    expect(t.v[0]).toBeCloseTo(1);
    await react(U, B, "save");
    t = (await getTaste(U))!;
    expect(t.w).toBe(3);
    // (1·[1,0] + 2·[0,1]) normalized → [0.447, 0.894]
    expect(t.v[0]).toBeCloseTo(1 / Math.sqrt(5));
    expect(t.v[1]).toBeCloseTo(2 / Math.sqrt(5));
  });
  it("skips push the taste vector away", async () => {
    await putEmbeddings([{ id: "x/a", v: vec(0) }, { id: "x/b", v: vec(1) }]);
    await react(U, A, "like");
    await react(U, B, "skip");
    const t = (await getTaste(U))!;
    expect(t.v[1]).toBeLessThan(0);
    expect(t.w).toBe(1.5);
  });
  it("without an embedding the term profile still learns and no taste vector is created", async () => {
    await react(U, A, "like");
    expect(await getTaste(U)).toBeNull();
    expect((await prof()).mcp).toBe(1);
  });
  it("is idempotent: the same (id, kind) twice applies the delta once (replay / double tap / retried beacon)", async () => {
    await react(U, item("a/b", { card: { tags: ["t1"] } }), "like");
    const once = await mockRedis.hgetall(UK.profile(U));
    const n1 = await mockRedis.hget(UK.meta(U), "reactions");
    await react(U, item("a/b", { card: { tags: ["t1"] } }), "like");
    expect(await mockRedis.hgetall(UK.profile(U))).toEqual(once);
    expect(await mockRedis.hget(UK.meta(U), "reactions")).toBe(n1);
    // A *different* kind on the same id still counts (a like after a skip is a change of mind).
    await react(U, item("a/b", { card: { tags: ["t1"] } }), "skip");
    expect(await mockRedis.hget(UK.react(U), "a/b")).toBe("skip");
    // Saving twice is one save.
    await react(U, item("c/d"), "save"); await react(U, item("c/d"), "save");
    expect(await mockRedis.hget(UK.meta(U), "n_save")).toBe("1");
  });
  it("keeps only the newest SEEN_CAP seen marks", async () => {
    const { SEEN_CAP } = await import("./state");
    const args: (string | number)[] = [];
    for (let i = 0; i < SEEN_CAP + 10; i++) args.push(i, `old/${i}`);
    await mockRedis.zadd(UK.seen(U), ...args);
    await react(U, item("new/one"), "like");
    expect(await mockRedis.zcard(UK.seen(U))).toBe(SEEN_CAP);
    expect(await mockRedis.zscore(UK.seen(U), "new/one")).not.toBeNull();
    expect(await mockRedis.zscore(UK.seen(U), "old/0")).toBeNull();
  });
});

describe("unsave", () => {
  it("removes the bookmark and reverses exactly the save's contribution", async () => {
    await react(U, A, "like");
    await react(U, A, "save");
    await unsave(U, A);
    expect(await isSaved(U, ["x/a"])).toEqual(new Set());
    expect((await prof()).mcp).toBe(1);
    expect((await mockRedis.hgetall(UK.meta(U))).n_save).toBe("0");
  });
});

describe("undo", () => {
  it("reverts a like: un-sees, forgets the reaction, reverses the delta and the taste vector, returns true", async () => {
    await putEmbeddings([{ id: "x/a", v: vec(0) }, { id: "x/b", v: vec(1) }]);
    await react(U, B, "like");
    await react(U, A, "like");
    expect(await undo(U, A)).toBe(true);
    const t = (await getTaste(U))!;
    expect(t.w).toBe(1);
    expect(Math.abs(t.v[0])).toBeLessThan(1e-6);
    expect(await getSeen(U)).toEqual(new Set(["x/b"]));
    expect(await getReactions(U)).toEqual(new Map([["x/b", "like"]]));
    expect((await prof()).mcp).toBeUndefined();
    expect(await mockRedis.hgetall(UK.meta(U))).toMatchObject({ reactions: "1", n_like: "1" });
  });
  it("reverts a skip", async () => {
    await react(U, A, "skip");
    expect(await undo(U, A)).toBe(true);
    expect(await prof()).toEqual({});
  });
  it("refuses to undo a dive, a save, or nothing", async () => {
    expect(await undo(U, A)).toBe(false);
    await react(U, A, "dive");
    expect(await undo(U, A)).toBe(false);
    expect((await prof()).mcp).toBe(1.5);
  });
});

describe("markSeen / touchVisit", () => {
  it("markSeen is NX: a later call does not move the timestamp", async () => {
    await markSeen(U, ["x/a"]);
    vi.setSystemTime(NOW + 1000);
    await markSeen(U, ["x/a", "x/b"]);
    expect(await mockRedis.zscore(UK.seen(U), "x/a")).toBe(String(NOW));
    expect(await mockRedis.zscore(UK.seen(U), "x/b")).toBe(String(NOW + 1000));
    await markSeen(U, []);   // no-op, no throw
  });
  it("touchVisit returns the previous visit and records now", async () => {
    expect(await touchVisit(U)).toEqual({ lastVisit: 0 });
    vi.setSystemTime(NOW + 5000);
    expect(await touchVisit(U)).toEqual({ lastVisit: NOW });
  });
});

describe("me", () => {
  it("summarises counts, top/avoid terms, saved, and histories newest-first", async () => {
    await react(U, A, "like");
    vi.setSystemTime(NOW + 1000);
    await react(U, B, "skip");
    await react(U, B, "save");
    const m = await me(U);
    expect(m.counts).toEqual({ like: 1, skip: 1, save: 1, dive: 0 });
    expect(m.reactions).toBe(3);                                   // saves count as reactions in the tally
    expect(m.topTerms[0]).toMatchObject({ term: "bio" });         // 2 − 0.5 = 1.5 > mcp 1
    expect(m.avoidTerms).toEqual([]);
    expect(m.saved).toEqual(["x/b"]);
    expect(m.liked.map((x) => x.id)).toEqual(["x/a"]);
    expect(m.skipped.map((x) => x.id)).toEqual(["x/b"]);
    expect(m.seen).toBe(2);
    expect(m.firstSeen).toBe(NOW);
  });
  it("avoidTerms lists negatives, most negative first", async () => {
    const A2 = item("a/b2", { card: { tags: ["mcp", "cli", "node"], category: "dev-tools" }, repo: { language: "TypeScript" } });
    await react(U, A, "skip");
    await react(U, A2, "skip");
    await react(U, B, "skip");
    const m = await me(U);
    // A's terms were skipped twice (−1 total, via two cards sharing them), B's once (−0.5): the A terms come first.
    expect(m.avoidTerms.slice(0, 3).map((t) => t.w)).toEqual([-1, -1, -1]);
    expect(m.avoidTerms.map((t) => t.term)).toContain("bio");
    expect(m.avoidTerms.every((t) => t.w < 0)).toBe(true);
  });
  it("is empty and does not throw for an unknown user", async () => {
    const m = await me("nobody");
    expect(m).toMatchObject({ reactions: 0, saved: [], liked: [], seen: 0, lastVisit: 0, firstSeen: 0, tasteWeight: 0 });
  });
});

describe("resetTaste", () => {
  it("forgets likes/passes/dives, the profile and the taste vector; un-sees reacted items; keeps saves and browse-seen", async () => {
    await putEmbeddings([{ id: "x/a", v: vec(0) }]);
    await react(U, A, "like");
    await react(U, B, "skip");
    await react(U, B, "save");
    await markSeen(U, ["x/c"]);           // browsed past, never reacted
    const r = await resetTaste(U);
    expect(r.forgot).toBe(2);
    expect(await prof()).toEqual({});
    expect(await getTaste(U)).toBeNull();
    expect(await getReactions(U).then((m) => m.size)).toBe(0);
    expect(await getSeen(U)).toEqual(new Set(["x/c"]));
    expect(await isSaved(U, ["x/b"])).toEqual(new Set(["x/b"]));
    const meta = await mockRedis.hgetall(UK.meta(U));
    expect(meta.resets).toBe("1");
    expect(meta.n_save).toBe("1");
    expect(meta.reactions).toBeUndefined();
  });
  it("is safe on an empty user", async () => {
    expect(await resetTaste("nobody")).toEqual({ forgot: 0 });
  });
});

describe("key schema", () => {
  it("is namespaced per user and does not collide with corpus keys", () => {
    expect(UK.profile("a")).toBe("u:a:profile");
    expect(EK.taste("a")).toBe("u:a:taste");
    expect(EK.emb("o/r")).toBe("emb:o/r");
    expect(new Set([UK.seen("a"), UK.react("a"), UK.saved("a"), UK.profile("a"), UK.meta("a"), EK.taste("a"), EK.tastew("a")]).size).toBe(7);
  });
});

describe("loadUser", () => {
  it("returns profile, seen, saved, lastVisit and taste bytes in one pipeline, and touches lastVisit", async () => {
    await putEmbeddings([{ id: "a/b", v: vec(0) }]);
    await react("u", item("a/b"), "like");
    await react("u", item("c/d"), "save");
    await markSeen("u", ["e/f"]);
    const u1 = await loadUser("u");
    expect(u1.profile.size).toBeGreaterThan(0);
    expect(u1.seen.has("e/f")).toBe(true);
    expect(u1.saved.has("c/d")).toBe(true);
    expect(u1.tasteBuf?.length).toBe(512 * 4);
    expect(u1.tasteW).toBeGreaterThan(0);
    // Without `touch` nothing is stamped: search and voice load the user but are not visits.
    expect(await mockRedis.hget(UK.meta("u"), "lastVisit")).toBeNull();
    expect(u1.lastVisit).toBe(0);
    // With it, the pipeline reads lastVisit *then* writes now: the next call sees this call's stamp.
    await loadUser("u", { touch: true });
    const stamp = Number(await mockRedis.hget(UK.meta("u"), "lastVisit"));
    expect(stamp).toBeGreaterThan(0);
    const u2 = await loadUser("u", { touch: true });
    expect(u2.lastVisit).toBe(stamp);
    // Every load refreshes the profile's lease (regression: user keys never expired).
    expect(await mockRedis.ttl(UK.profile("u"))).toBeGreaterThan(300 * 86_400);
    expect(await mockRedis.ttl(UK.seen("u"))).toBeGreaterThan(300 * 86_400);
  });
  it("search-shaped loads (no touch) never move lastVisit — the bug react() once had, from the other side", async () => {
    await loadUser("u", { touch: true });
    const stamp = await mockRedis.hget(UK.meta("u"), "lastVisit");
    vi.setSystemTime(NOW + 60_000);
    await loadUser("u"); await loadUser("u");
    expect(await mockRedis.hget(UK.meta("u"), "lastVisit")).toBe(stamp);
  });
  it("is all-empty for an unknown user and does not throw", async () => {
    const u = await loadUser("nobody");
    expect(u.profile.size).toBe(0); expect(u.seen.size).toBe(0); expect(u.saved.size).toBe(0);
    expect(u.lastVisit).toBe(0); expect(u.tasteBuf).toBeNull(); expect(u.tasteW).toBe(0);
  });
});
