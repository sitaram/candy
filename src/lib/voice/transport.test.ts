import { describe, it, expect } from "vitest";
import { friendlyError } from "./transport";

describe("friendlyError", () => {
  it("mic denial, both spellings", () => {
    expect(friendlyError(new Error("Permission denied"))).toBe("microphone blocked");
    expect(friendlyError(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe("microphone blocked");
  });
  it("passes a real message through", () => { expect(friendlyError(new Error("realtime 402: insufficient credits"))).toBe("realtime 402: insufficient credits"); });
  it("never returns empty", () => { expect(friendlyError(new Error(""))).toBe("voice error"); expect(friendlyError(undefined)).toBe("voice error"); });
});
