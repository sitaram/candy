import { describe, it, expect, beforeEach } from "vitest";
import { redis } from "../store/redis";
import { record, recordServer, fingerprint } from "./index";

describe("error sink", () => {
  beforeEach(async () => { await redis().del("err:log"); });

  it("fingerprint strips numbers and hex ids so the same bug is one key", () => {
    const a = fingerprint({ side: "client", where: "feed", msg: "Request failed (503) rid=deadbeef01" });
    const b = fingerprint({ side: "client", where: "feed", msg: "Request failed (502) rid=cafebabe99" });
    expect(a).toBe(b);
    expect(a).not.toBe(fingerprint({ side: "server", where: "feed", msg: "Request failed (503)" }));
  });

  it("record pushes newest-first, caps at 500, and counts by fingerprint per day", async () => {
    const r = redis();
    for (let i = 0; i < 503; i++) await record({ at: Date.now(), side: "server", where: "t", msg: `boom ${i}` });
    expect(await r.llen("err:log")).toBe(500);
    const top = JSON.parse((await r.lindex("err:log", 0))!);
    expect(top.msg).toBe("boom 502");
    const day = new Date().toISOString().slice(0, 10);
    expect(Number(await r.hget(`err:count:${day}`, "server:t:boom #"))).toBeGreaterThanOrEqual(503);
    await r.del(`err:count:${day}`);
  });

  it("recordServer keeps 8 stack lines, the rid and status", async () => {
    const e = new Error("kaboom"); e.stack = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    recordServer("api:/x", e, { rid: "abcd1234", status: 500 });
    await new Promise((r) => setTimeout(r, 30));
    const rec = JSON.parse((await redis().lindex("err:log", 0))!);
    expect(rec).toMatchObject({ side: "server", where: "api:/x", msg: "kaboom", rid: "abcd1234", status: 500 });
    expect(rec.stack.split("\n")).toHaveLength(8);
  });

  it("never throws when redis is unusable", async () => {
    const r = redis(); const real = r.pipeline.bind(r);
    (r as unknown as { pipeline: () => never }).pipeline = () => { throw new Error("down"); };
    await expect(record({ at: 0, side: "client", where: "x", msg: "y" })).resolves.toBeUndefined();
    r.pipeline = real;
  });
});
