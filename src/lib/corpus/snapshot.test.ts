import { describe, it, expect } from "vitest";
import { writeSnapshot, readSnapshot, bumpVersion, currentVersion, SK } from "./snapshot";
import { item } from "@/test/fixtures";
import { mockRedis } from "@/test/setup";

describe("corpus snapshot", () => {
  it("round-trips items through one gzip'd key and bumps the version", async () => {
    const items = [item("a/b"), item("c/d", { card: null })];
    const v1 = await writeSnapshot(items);
    const back = await readSnapshot();
    expect(back?.ver).toBe(v1);
    expect(back?.items.map((i) => i.repo.id)).toEqual(["a/b", "c/d"]);
    expect(back?.items[1].card).toBeNull();
    const v2 = await writeSnapshot(items);
    expect(v2).toBe(v1 + 1);
  });
  it("is null when absent; a corrupt blob is deleted and reported as absent rather than thrown", async () => {
    expect(await readSnapshot()).toBeNull();
    await mockRedis.set(SK.snap, Buffer.from("not gzip"));
    expect(await readSnapshot()).toBeNull();
    expect(await mockRedis.exists(SK.snap)).toBe(0);
  });
  it("bumpVersion lets a writer signal change without rewriting the blob", async () => {
    expect(await currentVersion()).toBe(0);
    await bumpVersion();
    expect(await currentVersion()).toBe(1);
  });
});
