import { describe, it, expect } from "vitest";
import { HUE, hueOf, fmt, agoShort, splitWhy, lockAxis, resolveGesture, THRESH, VTHRESH, AXIS_LOCK } from "./logic";
import { CATEGORIES } from "@/lib/enrich/card";
import { feedItem, item, NOW } from "@/test/fixtures";

describe("hue", () => {
  it("every category has a hue, so no card falls back to the default by accident", () => {
    for (const c of CATEGORIES) expect(HUE[c], c).toBeDefined();
    expect(hueOf(feedItem(item("a/b", { card: { category: "security" } })))).toBe(0);
    expect(hueOf(feedItem(item("a/b", { card: null })))).toBe(230);
    expect(hueOf(undefined)).toBe(230);
  });
});

describe("fmt / agoShort", () => {
  it.each([[0, "0"], [999, "999"], [1000, "1.0k"], [1500, "1.5k"], [9999, "10.0k"], [10_000, "10k"], [124_185, "124k"]])("fmt(%i) = %s", (n, s) => expect(fmt(n)).toBe(s));
  it("agoShort buckets: today, 1d, Nd, Nmo, N.Ny / Ny", () => {
    const d = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
    expect(agoShort(d(0.5), NOW)).toBe("today");
    expect(agoShort(d(1.5), NOW)).toBe("1d");
    expect(agoShort(d(12), NOW)).toBe("12d");
    expect(agoShort(d(75), NOW)).toBe("3mo");   // Math.round(2.5)
    expect(agoShort(d(500), NOW)).toBe("1.4y");
    expect(agoShort(d(1000), NOW)).toBe("3y");
    expect(agoShort("", NOW)).toBe("");
    expect(agoShort("garbage", NOW)).toBe("");
  });
});

describe("splitWhy", () => {
  it("lifts the personal-fit line into a chip, hides the explore marker, keeps the rest in order", () => {
    expect(splitWhy(["outside your usual — exploring", "released v2 today", "matches your interest in mcp, cli", "on Hacker News"]))
      .toEqual({ fit: "mcp, cli", rest: ["released v2 today", "on Hacker News"] });
    expect(splitWhy([])).toEqual({ fit: null, rest: [] });
  });
});

describe("gestures", () => {
  it("axis locks only after AXIS_LOCK px of travel, by dominant direction; ties go vertical", () => {
    expect(lockAxis(3, 3)).toBeNull();
    expect(lockAxis(AXIS_LOCK, 0)).toBeNull();          // hypot must exceed, not equal
    expect(lockAxis(AXIS_LOCK + 1, 0)).toBe("x");
    expect(lockAxis(0, AXIS_LOCK + 1)).toBe("y");
    expect(lockAxis(8, 8)).toBe("y");
    expect(lockAxis(30, -20)).toBe("x");
  });
  it("horizontal: right past THRESH likes, left skips; vertical: up nexts, down prevs; both gated by availability", () => {
    expect(resolveGesture("x", THRESH, 0)).toBe("like");
    expect(resolveGesture("x", -THRESH, 0)).toBe("skip");
    expect(resolveGesture("x", THRESH - 1, 0)).toBe("none");
    expect(resolveGesture("y", 0, -VTHRESH)).toBe("next");
    expect(resolveGesture("y", 0, VTHRESH)).toBe("prev");
    expect(resolveGesture("y", 0, -VTHRESH, { prev: true, next: false })).toBe("none");
    expect(resolveGesture("y", 0, VTHRESH, { prev: false, next: true })).toBe("none");
    expect(resolveGesture(null, 500, 500)).toBe("none");
  });
});
