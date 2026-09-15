import { describe, it, expect } from "vitest";
import { lockAxis, resolveGesture, classifyRelease, splitWhy, agoShort, fmt, THRESH, VTHRESH, AXIS_LOCK } from "./logic";

const both = { prev: true, next: true };

describe("lockAxis", () => {
  it("stays unlocked inside the dead zone", () => { expect(lockAxis(AXIS_LOCK - 1, 0)).toBeNull(); expect(lockAxis(3, 3)).toBeNull(); });
  it("picks the dominant axis; ties go to y", () => {
    expect(lockAxis(20, 5)).toBe("x"); expect(lockAxis(5, 20)).toBe("y"); expect(lockAxis(12, 12)).toBe("y");
  });
});

describe("resolveGesture", () => {
  it("x: past THRESH decides, sign picks side", () => {
    expect(resolveGesture("x", THRESH, 0, both)).toBe("like");
    expect(resolveGesture("x", -THRESH, 0, both)).toBe("skip");
    expect(resolveGesture("x", THRESH - 1, 0, both)).toBe("none");
  });
  it("y: up is next, down is prev, gated by can", () => {
    expect(resolveGesture("y", 0, -VTHRESH, both)).toBe("next");
    expect(resolveGesture("y", 0, VTHRESH, both)).toBe("prev");
    expect(resolveGesture("y", 0, -VTHRESH, { prev: true, next: false })).toBe("none");
    expect(resolveGesture("y", 0, VTHRESH, { prev: false, next: true })).toBe("none");
  });
  it("a big dx on the y axis does not decide", () => { expect(resolveGesture("y", 300, -10, both)).toBe("none"); });
  it("unlocked never resolves", () => { expect(resolveGesture(null, 500, 500, both)).toBe("none"); });
});

describe("classifyRelease", () => {
  it("tiny unlocked travel is a tap", () => { expect(classifyRelease(null, 3, 4, both)).toEqual({ kind: "tap" }); });
  it("unlocked but travelled is nothing (finger wandered, no axis)", () => { expect(classifyRelease(null, 9, 0, both).kind).toBe("none"); });
  it("carries the drag so the fly-out starts where the finger left", () => {
    expect(classifyRelease("x", 140, -20, both)).toEqual({ kind: "decide", decision: "like", dx: 140, dy: -20 });
  });
  it("pages with the dy so the slide continues", () => {
    expect(classifyRelease("y", 0, -200, both)).toEqual({ kind: "page", dir: 1, dy: -200 });
    expect(classifyRelease("y", 0, 150, both)).toEqual({ kind: "page", dir: -1, dy: 150 });
  });
  it("short y is a release back to rest, not overscroll", () => {
    expect(classifyRelease("y", 0, -40, both)).toEqual({ kind: "release", dy: -40, overscroll: false });
  });
  it("swiping up with no next is overscroll (splash before the feed lands)", () => {
    expect(classifyRelease("y", 0, -200, { prev: false, next: false })).toEqual({ kind: "release", dy: -200, overscroll: true });
  });
  it("short x is nothing; the card springs back via CSS", () => { expect(classifyRelease("x", 40, 0, both).kind).toBe("none"); });
});

describe("card text helpers", () => {
  it("splitWhy pulls the fit line out", () => {
    expect(splitWhy(["on Hacker News", "matches your interest in rust", "released"])).toEqual({ fit: "rust", rest: ["on Hacker News", "released"] });
    expect(splitWhy(["on HN", "outside your usual"])).toEqual({ fit: null, rest: ["on HN"] });   // explore marker is hidden
  });
  it("agoShort", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    expect(agoShort("2026-09-14T10:00:00Z", now)).toBe("today");
    expect(agoShort("2026-09-11T12:00:00Z", now)).toBe("3d");
    expect(agoShort("2026-07-10T12:00:00Z", now)).toBe("2mo");   // 66 d / 30 → 2
    expect(agoShort("2025-03-14T12:00:00Z", now)).toBe("1.5y");   // one decimal under two years
    expect(agoShort("2024-01-01T12:00:00Z", now)).toBe("3y");
    expect(agoShort("", now)).toBe(""); expect(agoShort("garbage", now)).toBe("");
  });
  it("fmt", () => { expect(fmt(950)).toBe("950"); expect(fmt(1500)).toBe("1.5k"); expect(fmt(124185)).toBe("124k"); });
});
