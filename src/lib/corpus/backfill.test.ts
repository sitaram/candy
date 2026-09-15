import { describe, it, expect, vi } from "vitest";
import { enqueueBackfill, drainOne, missingAlternatives, queueDepth, QUEUE_CAP } from "./backfill";
import { seed } from "@/test/fixtures";
import { mockRedis } from "@/test/setup";

vi.mock("./ensure", () => ({ ensureItem: vi.fn(async (id: string) => ({ id, exists: false, fetched: false, enriched: false })) }));

describe("backfill queue", () => {
  it("enqueues once per repo per week; the second call is a no-op", async () => {
    expect(await enqueueBackfill("a/b")).toBe(true);
    expect(await enqueueBackfill("a/b")).toBe(false);
    expect(await queueDepth()).toBe(1);
    expect(await mockRedis.ttl("bf:a/b")).toBeGreaterThan(6 * 86_400);
  });
  it("is bounded: past QUEUE_CAP the oldest are dropped", async () => {
    for (let i = 0; i < QUEUE_CAP + 5; i++) await enqueueBackfill(`o/r${i}`);
    expect(await queueDepth()).toBe(QUEUE_CAP);
    expect(await mockRedis.lindex("bf:queue", 0)).toBe("o/r5");
  });
  it("drainOne pops FIFO and is idle on empty", async () => {
    await seed([{ id: "x/y", card: { alternatives: [] } }]);
    await enqueueBackfill("x/y");
    expect((await drainOne())?.id).toBe("x/y");
    expect(await drainOne()).toBeNull();
  });
});

describe("missingAlternatives", () => {
  it("splits named alternatives into missing owner/repo ids and bare names; skips hosted products, corpus members, and names already in the corpus", async () => {
    await seed([
      { id: "me/x", card: { alternatives: ["Other/Lib", "bare-name", "elevenlabs", "have/it", "there"] } },
      { id: "have/it" },
      { id: "some/there", card: {} },
    ]);
    expect(await missingAlternatives("me/x")).toEqual({ missing: ["other/lib"], unresolved: ["bare-name"] });
  });
  it("a bare name that already failed to resolve is not pending (regression: weekly re-enqueue forever)", async () => {
    await seed([{ id: "me/x", card: { alternatives: ["ghostname", "realname"] } }]);
    await mockRedis.set("bfname:ghostname", "-");
    expect(await missingAlternatives("me/x")).toEqual({ missing: [], unresolved: ["realname"] });
  });
  it("is empty for a card-less or unknown repo", async () => {
    await seed([{ id: "a/b", card: null }]);
    expect(await missingAlternatives("a/b")).toEqual({ missing: [], unresolved: [] });
    expect(await missingAlternatives("no/pe")).toEqual({ missing: [], unresolved: [] });
  });
});
