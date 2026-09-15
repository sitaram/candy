import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { alert } from "./alert";
import { record, fingerprint } from "./index";
import { ERR_SPIKE } from "./alert";

const flush = () => new Promise((r) => setTimeout(r, 30));
let posts: string[];
beforeEach(() => { posts = []; vi.stubEnv("CANDY_ALERT_WEBHOOK", "https://hook.test/x"); vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { posts.push(JSON.parse(init.body as string).text); return new Response(null, { status: 200 }); })); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("alert()", () => {
  it("posts once per kind per hour; a second call inside the hour is swallowed; a different dedupe key is not", async () => {
    alert("spend-cap", "a"); alert("spend-cap", "b"); alert("error-spike", "c", "error-spike:fp1"); alert("error-spike", "d", "error-spike:fp2");
    await flush();
    expect(posts).toEqual(["[candy] spend-cap: a", "[candy] error-spike: c", "[candy] error-spike: d"]);
  });
  it("without a webhook it only logs", async () => {
    vi.stubEnv("CANDY_ALERT_WEBHOOK", "");
    alert("redis-down", "x"); await flush();
    expect(posts).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("[alert]", "[candy] redis-down: x");
  });
  it("record() raises error-spike exactly when a fingerprint hits ERR_SPIKE in a day, not before, not again", async () => {
    const e = { at: Date.now(), side: "server" as const, where: "api:/x", msg: "boom 123" };
    for (let i = 0; i < ERR_SPIKE + 3; i++) await record(e);
    await flush();
    const spikes = posts.filter((p) => p.includes("error-spike"));
    expect(spikes).toHaveLength(1);
    expect(spikes[0]).toContain(fingerprint(e));
    expect(spikes[0]).toContain(`${ERR_SPIKE}×`);
  });
});
