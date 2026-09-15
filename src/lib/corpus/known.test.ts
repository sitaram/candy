import { describe, it, expect } from "vitest";
import { isKnown } from "./known";
import { discover } from "@/lib/store/corpus";
import { seed } from "@/test/fixtures";

describe("isKnown", () => {
  it("corpus > frontier > absent", async () => {
    await seed([{ id: "in/corpus" }]);
    await discover([{ repo: "on/frontier", source: "hn", weight: 1 }]);
    expect(await isKnown("in/corpus")).toBe("corpus");
    expect(await isKnown("on/frontier")).toBe("frontier");
    expect(await isKnown("never/heard")).toBe("absent");
  });
});
