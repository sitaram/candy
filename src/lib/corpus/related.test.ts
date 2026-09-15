/**
 * Related-project ranking. These encode the lesson from the codex screenshot: a 4★ toy with three
 * noisy shared tags must not outrank the 30k★ peer, and "openai"/"cursor"/"local-first" mean nothing.
 */
import { describe, it, expect } from "vitest";
import { neighbors, fallbackGroups, getRelated, putRelated, hasRelated, type Neighbor } from "./related";
import { addEdges } from "@/lib/store/corpus";
import { invalidate, getItem } from "./api";
import { item, seed, vec } from "@/test/fixtures";
import { mockRedis } from "@/test/setup";

/** A vector that is `cos` away from vec(0), in the plane of axes 0 and `other`. */
function at(cos: number, other = 1): Float32Array {
  const v = new Float32Array(512); v[0] = cos; v[other] = Math.sqrt(1 - cos * cos); return v;
}

describe("neighbors", () => {
  it("a named alternative dominates; bare names resolve to the highest-starred repo of that name; reverse naming counts", async () => {
    await seed([
      { id: "me/x", card: { alternatives: ["Peer", "org/direct"], tags: ["t1"] }, vec: vec(0) },
      { id: "small/peer", repo: { stars: 10 }, card: { tags: [] }, vec: at(0.3) },
      { id: "big/peer", repo: { stars: 50_000 }, card: { tags: [] }, vec: at(0.3) },
      { id: "org/direct", repo: { stars: 100 }, card: { tags: [] }, vec: at(0.3) },
      { id: "names/me", repo: { stars: 100 }, card: { alternatives: ["me/x"], tags: [] }, vec: at(0.3) },
      { id: "noise/y", repo: { stars: 100_000 }, card: { tags: ["openai", "cursor", "local-first"] }, vec: at(0.3) },
    ]);
    const ns = await neighbors("me/x");
    const ids = ns.map((n) => n.item.repo.id);
    expect(ids.slice(0, 3)).toEqual(expect.arrayContaining(["big/peer", "org/direct", "names/me"]));
    expect(ns.filter((n) => n.signals.alt)).toHaveLength(3);
    expect(ids).not.toContain("small/peer");          // "peer" resolved to the bigger one only
    expect(ids).not.toContain("noise/y");             // 100k★ but only noise tags and cos .3: no reason to be here
  });
  it("noise tags count for nothing; a specific shared tag needs cos > .50 to admit; log-stars orders peers", async () => {
    await seed([
      { id: "me/x", card: { tags: ["whisper-cpp", "openai"] }, vec: vec(0) },
      { id: "toy/a", repo: { stars: 4 }, card: { tags: ["whisper-cpp"] }, vec: at(0.6) },
      { id: "peer/b", repo: { stars: 30_000 }, card: { tags: ["whisper-cpp"] }, vec: at(0.6) },
      { id: "tagonly/c", repo: { stars: 30_000 }, card: { tags: ["whisper-cpp"] }, vec: at(0.45) },   // shares a real tag but text disagrees
      { id: "noiseonly/d", repo: { stars: 30_000 }, card: { tags: ["openai"] }, vec: at(0.55) },      // only a noise tag
    ]);
    const ns = await neighbors("me/x");
    const ids = ns.map((n) => n.item.repo.id);
    expect(ids[0]).toBe("peer/b");
    expect(ids).not.toContain("toy/a");               // 4★ with the same evidence: below the admission floor
    expect(ids).not.toContain("tagonly/c");
    expect(ids).not.toContain("noiseonly/d");
    expect(ns.find((n) => n.item.repo.id === "peer/b")!.signals.shared).toEqual(["whisper-cpp"]);
  });
  it("very close meaning (cos > .58) is admitted alone; README links and same owner are hard edges that a low cosine cannot veto (regression); same category alone is not", async () => {
    await seed([
      { id: "me/x", card: { category: "cli", tags: ["zzz"] }, vec: vec(0) },
      { id: "close/a", repo: { stars: 2000 }, card: { category: "database", tags: [] }, vec: at(0.7) },
      { id: "me/sibling", repo: { stars: 2000 }, card: { category: "database", tags: [] }, vec: at(0.2) },
      { id: "linked/c", repo: { stars: 2000 }, card: { category: "database", tags: [] }, vec: at(0.2) },
      { id: "samecat/d", repo: { stars: 2000 }, card: { category: "cli", tags: [] }, vec: at(0.45) },
    ]);
    await addEdges("me/x", "links", ["linked/c"]);
    await invalidate();
    const ns = await neighbors("me/x");
    const by = new Map(ns.map((n) => [n.item.repo.id, n]));
    expect(by.get("close/a")?.signals.cos).toBeCloseTo(0.7);
    expect(by.get("me/sibling")?.signals.sameOwner).toBe(true);
    expect(by.get("linked/c")?.signals.linksTo).toBe(true);
    expect(by.has("samecat/d")).toBe(false);
  });
  it("returns [] for an unknown or card-less repo, and respects limit", async () => {
    await seed([{ id: "me/x", card: null }, { id: "o/p", card: {} }]);
    expect(await neighbors("me/x")).toEqual([]);
    expect(await neighbors("nope/x")).toEqual([]);
  });
});

describe("fallbackGroups", () => {
  const me = item("me/x", { card: { category: "ai-agents" }, repo: { language: "Rust", stars: 1000, owner: "me" } });
  const n = (id: string, signals: Neighbor["signals"], over: { language?: string; stars?: number } = {}): Neighbor => ({
    item: item(id, { repo: { language: over.language ?? "Rust", stars: over.stars ?? 500 }, card: { category: "ai-agents" } }), score: 1, signals,
  });
  it("claims in priority order: alternatives → built-on → builds-on → owner (≥2) → cross-language close → close → shared tag (≥2) → the big one", () => {
    const ns = [
      n("alt/a", { alt: true, shared: [] }),
      n("up/b", { linkedFrom: true, shared: [] }),
      n("down/c", { linksTo: true, shared: [] }),
      n("me/d", { sameOwner: true, shared: [] }), n("me/e", { sameOwner: true, shared: [] }),
      n("py/f", { cos: 0.7, shared: [] }, { language: "Python" }), n("go/g", { cos: 0.65, shared: [] }, { language: "Go" }),
      n("rs/h", { cos: 0.7, shared: [] }), n("rs/i", { cos: 0.62, shared: [] }),
      n("tag/j", { shared: ["mcp"] }), n("tag/k", { shared: ["mcp"] }),
      n("big/l", { sameCategory: true, shared: [] }, { stars: 100_000 }),
    ];
    const g = fallbackGroups(me, ns);
    expect(g.map((x) => x.label)).toEqual(["Does the same job as x", "Built on x", "What x builds on", "More from me"]);   // capped at 4
    expect(g[0].ids).toEqual(["alt/a"]);
    expect(g[3].ids).toEqual(["me/d", "me/e"]);
  });
  it("language split, tag groups and the incumbent when the hard edges are absent", () => {
    const ns = [
      n("py/f", { cos: 0.7, shared: [] }, { language: "Python" }), n("go/g", { cos: 0.65, shared: [] }, { language: "Go" }),
      n("rs/h", { cos: 0.7, shared: [] }), n("rs/i", { cos: 0.62, shared: [] }),
      n("tag/j", { shared: ["mcp"], cos: 0.3 }), n("tag/k", { shared: ["mcp"], cos: 0.3 }),
      n("big/l", { sameCategory: true, shared: [] }, { stars: 100_000 }),
    ];
    const g = fallbackGroups(me, ns);
    expect(g.map((x) => x.label)).toEqual(["Same idea, not Rust", "Closest in spirit", "Also about mcp", "The big one in ai agents"]);
    expect(g[0].ids).toEqual(["py/f", "go/g"]);
    expect(g[1].ids).toEqual(["rs/h", "rs/i"]);
    expect(g[3].ids).toEqual(["big/l"]);
  });
  it("each neighbour lands in exactly one group; the incumbent needs 3× the stars; nothing → []", () => {
    const ns = [n("a/a", { alt: true, cos: 0.9, shared: ["mcp"] }), n("b/b", { sameCategory: true, shared: [] }, { stars: 2000 })];
    const g = fallbackGroups(me, ns);
    expect(g.flatMap((x) => x.ids)).toEqual(["a/a"]);
    expect(fallbackGroups(me, [])).toEqual([]);
  });
  it("relaxes the 'closest' threshold to .52 when nothing else claims", () => {
    const g = fallbackGroups(me, [n("a/a", { cos: 0.55, shared: [] }), n("b/b", { cos: 0.53, shared: [] })]);
    expect(g).toEqual([{ label: "Closest in spirit", ids: ["a/a", "b/b"] }]);
  });
});

describe("getRelated / putRelated", () => {
  it("prefers stored labels, resolves their ids (even outside the neighbour set), drops empty groups; falls back when absent or corrupt", async () => {
    await seed([{ id: "me/x", card: { alternatives: ["p/q"] }, vec: vec(0) }, { id: "p/q", vec: at(0.3) }, { id: "far/z", vec: at(0.1) }]);
    let r = await getRelated("me/x");
    expect(r.labelled).toBe(false);
    expect(r.groups[0].label).toBe("Does the same job as x");
    await putRelated("me/x", [{ label: "Custom", ids: ["far/z", "gone/gone"] }, { label: "Empty", ids: ["gone/gone"] }], "test");
    r = await getRelated("me/x");
    expect(r.labelled).toBe(true);
    expect(r.groups).toEqual([{ label: "Custom", items: [await getItem("far/z")] }]);
    expect(await hasRelated(["me/x", "p/q"])).toEqual(new Set(["me/x"]));
    await mockRedis.set("rel:me/x", "{corrupt");
    expect((await getRelated("me/x")).labelled).toBe(false);
    expect(await getRelated("nope/x")).toEqual({ groups: [], labelled: false });
  });
});
