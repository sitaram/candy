import { describe, it, expect } from "vitest";
import { rmsOf, toLevels } from "./meter";

describe("rmsOf", () => {
  it("silence (all 128) is 0", () => { expect(rmsOf(new Uint8Array(128).fill(128))).toBe(0); });
  it("full-scale square wave is 1", () => { const b = new Uint8Array(128); b.forEach((_, i) => { b[i] = i % 2 ? 255 : 1; }); expect(rmsOf(b)).toBeCloseTo(0.996, 2); });
  it("half amplitude is ~0.5", () => { const b = new Uint8Array(128); b.forEach((_, i) => { b[i] = i % 2 ? 192 : 64; }); expect(rmsOf(b)).toBeCloseTo(0.5, 2); });
});

describe("toLevels", () => {
  it("mixed is the louder side; local is the mic alone", () => {
    expect(toLevels(0.1, 0.05)).toEqual({ mixed: 0.4, local: 0.2 });
    expect(toLevels(0.05, 0.1)).toEqual({ mixed: 0.4, local: 0.4 });
  });
  it("clamps at 1", () => { expect(toLevels(0.9, 0.9)).toEqual({ mixed: 1, local: 1 }); });
  it("normal speech (~0.25 rms) lands near full", () => { expect(toLevels(0.25, 0).mixed).toBe(1); expect(toLevels(0.15, 0).mixed).toBeCloseTo(0.6); });
});
