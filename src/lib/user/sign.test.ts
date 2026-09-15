import { describe, it, expect, vi, afterEach } from "vitest";
import { newId, sign, verify, _resetKey } from "./sign";

afterEach(() => { vi.unstubAllEnvs(); _resetKey(); });

describe("signed session id", () => {
  it("round-trips: what sign() makes, verify() accepts, as not-legacy", async () => {
    const id = newId();
    expect(id).toMatch(/^[a-f0-9]{20}$/);
    const c = await sign(id);
    expect(c).toMatch(/^[a-f0-9]{20}\.[a-f0-9]{12}$/);
    expect(await verify(c)).toEqual({ id, legacy: false });
  });
  it("rejects a tampered id, a tampered signature, a wrong-length signature, junk, and nothing", async () => {
    const c = await sign(newId());
    const [id, sig] = c.split(".");
    expect(await verify(`${id.replace(/^./, (ch) => (ch === "0" ? "1" : "0"))}.${sig}`)).toBeNull();
    expect(await verify(`${id}.${sig.replace(/^./, (ch) => (ch === "0" ? "1" : "0"))}`)).toBeNull();
    expect(await verify(`${id}.${sig}00`)).toBeNull();
    expect(await verify("not-a-cookie.at.all")).toBeNull();
    expect(await verify("")).toBeNull();
    expect(await verify(undefined)).toBeNull();
  });
  it("a legacy unsigned 20-hex id is accepted and flagged so middleware re-signs it; other unsigned strings are not", async () => {
    expect(await verify("abcdef0123456789abcd")).toEqual({ id: "abcdef0123456789abcd", legacy: true });
    expect(await verify("anon")).toBeNull();
    expect(await verify("ABCDEF0123456789ABCD")).toBeNull();          // the old regex allowed this; the new one does not
  });
  it("a cookie signed under one secret is rejected under another", async () => {
    vi.stubEnv("SESSION_SECRET", "one"); _resetKey();
    const c = await sign(newId());
    vi.stubEnv("SESSION_SECRET", "two"); _resetKey();
    expect(await verify(c)).toBeNull();
  });
});
