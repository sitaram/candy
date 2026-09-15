import { describe, it, expect, vi } from "vitest";
import { safeJson } from "./json";

describe("safeJson", () => {
  it("parses valid JSON, returns fallback for null/empty/corrupt, never throws", () => {
    expect(safeJson('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJson(null, "d")).toBe("d");
    expect(safeJson("", [])).toEqual([]);
    expect(safeJson("{bad", 7)).toBe(7);
  });
  it("warns once per site, then goes quiet", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    safeJson("{bad", 0, "site-A"); safeJson("{bad", 0, "site-A"); safeJson("{bad", 0, "site-B");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/\[site-A\] corrupt JSON/);
    warn.mockRestore();
  });
});
