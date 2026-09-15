import { redis } from "../store/redis";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// next/headers only works inside a request scope; stub it with a settable jar.
const jar: { uid?: string; header?: string } = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (k === "cuid" && jar.uid ? { value: jar.uid } : undefined) }),
  headers: async () => ({ get: (k: string) => (k === "x-candy-uid" ? jar.header ?? null : null) }),
}));

const { route, HttpError } = await import("./guard");

const req = (url: string, init?: RequestInit & { json?: unknown }) => {
  const i: RequestInit = { ...init };
  if (init?.json !== undefined) { i.method = "POST"; i.body = JSON.stringify(init.json); i.headers = { "content-type": "application/json" }; }
  return new Request(`http://t${url}`, i);
};
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const body = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => null), rid: r.headers.get("x-request-id") });

beforeEach(() => { jar.uid = "abcdef1234567890"; jar.header = undefined; });

describe("route()", () => {
  it("401 without a session, unless anon", async () => {
    jar.uid = undefined;
    const h = route({}, async () => Response.json({ ok: 1 }));
    expect((await body(await h(req("/x"), ctx()))).status).toBe(401);
    const a = route({ anon: true }, async ({ uid }) => Response.json({ uid }));
    expect((await body(await a(req("/x"), ctx()))).json).toEqual({ uid: "anon" });
  });
  it("prefers the middleware header over the cookie (first-visit path)", async () => {
    jar.uid = undefined; jar.header = "freshfreshfresh1";
    const h = route({}, async ({ uid }) => Response.json({ uid }));
    expect((await body(await h(req("/x"), ctx()))).json).toEqual({ uid: "freshfreshfresh1" });
  });
  it("rejects a malformed session id", async () => {
    jar.uid = "<script>";
    const h = route({}, async () => Response.json({}));
    expect((await body(await h(req("/x"), ctx()))).status).toBe(400);
  });
  it("parses query, body and params; 400 names the field", async () => {
    const h = route({ query: z.object({ n: z.coerce.number().max(5) }), body: z.object({ id: z.string() }), params: z.object({ owner: z.string().min(2) }) },
      async ({ query, body, params }) => Response.json({ query, body, params }));
    const ok = await body(await h(req("/x?n=3", { json: { id: "a" } }), ctx({ owner: "ab" })));
    expect(ok.json).toEqual({ query: { n: 3 }, body: { id: "a" }, params: { owner: "ab" } });
    const bad = await body(await h(req("/x?n=9", { json: { id: "a" } }), ctx({ owner: "ab" })));
    expect(bad.status).toBe(400); expect(bad.json.error).toMatch(/^n: /);
    const badBody = await body(await h(req("/x?n=1", { json: {} }), ctx({ owner: "ab" })));
    expect(badBody.status).toBe(400); expect(badBody.json.error).toMatch(/^id: /);
    const badParam = await body(await h(req("/x?n=1", { json: { id: "a" } }), ctx({ owner: "a" })));
    expect(badParam.status).toBe(400); expect(badParam.json.error).toMatch(/^owner: /);
  });
  it("repeated query keys become arrays", async () => {
    const h = route({ query: z.object({ t: z.array(z.string()).or(z.string()) }) }, async ({ query }) => Response.json(query));
    expect((await body(await h(req("/x?t=a&t=b"), ctx()))).json).toEqual({ t: ["a", "b"] });
  });
  it("400 on non-JSON body, 413 on oversize", async () => {
    const h = route({ body: z.object({}), maxBody: 10 }, async () => Response.json({}));
    const r1 = await body(await h(new Request("http://t/x", { method: "POST", body: "nope" }), ctx()));
    expect(r1.status).toBe(400); expect(r1.json.error).toBe("body is not JSON");
    const r2 = await body(await h(new Request("http://t/x", { method: "POST", body: JSON.stringify({ a: "x".repeat(50) }) }), ctx()));
    expect(r2.status).toBe(413);
  });
  it("HttpError passes through with its status and headers", async () => {
    const h = route({}, async () => { throw new HttpError(429, "slow", { "Retry-After": "7" }); });
    const r = await h(req("/x"), ctx());
    expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("7");
  });
  it("unknown throws become a 500 with rid and no message leak", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = route({}, async () => { throw new Error("redis password is hunter2"); });
    const r = await body(await h(req("/x"), ctx()));
    expect(r.status).toBe(500); expect(r.json.error).toBe("internal error"); expect(r.json.rid).toBe(r.rid);
    expect(JSON.stringify(r.json)).not.toContain("hunter2");
    expect(err).toHaveBeenCalled(); err.mockRestore();
    // …but the ring buffer has the real message, under the same rid the client was shown.
    await new Promise((res) => setTimeout(res, 30));
    const rec = JSON.parse((await redis().lindex("err:log", 0))!);
    expect(rec).toMatchObject({ side: "server", where: "api:/x", rid: r.rid, status: 500, msg: "redis password is hunter2" });
  });
  it("rate limit bucket → 429 with Retry-After", async () => {
    const h = route({ limit: "voice" }, async () => Response.json({}));
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) last = await h(req("/x"), ctx());
    expect(last!.status).toBe(429); expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("every response carries x-request-id", async () => {
    const h = route({}, async () => Response.json({}));
    expect((await h(req("/x"), ctx())).headers.get("x-request-id")).toMatch(/^[0-9a-f]{8}$/);
  });
});
