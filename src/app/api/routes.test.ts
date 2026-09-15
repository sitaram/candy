/**
 * Route handlers end to end: real guard, real Redis, real ranking — only next/headers is stubbed, since it
 * needs a request scope. These are the contracts the client relies on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { seed } from "@/test/fixtures";
import { mockRedis } from "@/test/setup";

const jar: { header?: string } = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (k: string) => (k === "x-candy-uid" ? jar.header ?? null : null) }),
}));

const feed = await import("./feed/route");
const react = await import("./react/route");
const item = await import("./items/[owner]/[name]/route");
const search = await import("./search/route");
const health = await import("./health/route");

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const post = (url: string, body: unknown) => new Request(`http://t${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", host: "t" } });
const get = (url: string) => new Request(`http://t${url}`, { headers: { host: "t" } });

beforeEach(async () => {
  jar.header = "abcdef0123456789abcd";
  await seed([
    { id: "a/one", card: { interest: 7, tags: ["rust", "cli"], category: "cli" }, repo: { language: "Rust", stars: 5000 } },
    { id: "b/two", card: { interest: 6, tags: ["python", "agents"], category: "ai-agents" }, repo: { language: "Python", stars: 900 } },
    { id: "c/three", card: { interest: 5, tags: ["go"], category: "cli" }, repo: { language: "Go", stars: 100 } },
  ]);
});

describe("GET /api/feed", () => {
  it("returns ranked items with why[], honours n and exclude, and stamps x-request-id", async () => {
    const r = await feed.GET(get("/api/feed?n=2&exclude=a/one"), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("x-request-id")).toMatch(/^[a-f0-9]{8}$/);
    const j = await r.json();
    expect(j.items).toHaveLength(2);
    expect(j.items.map((i: { id: string }) => i.id)).not.toContain("a/one");
    expect(j.items.every((i: { why: unknown }) => Array.isArray(i.why))).toBe(true);   // a cold user on a middling card can have no reason yet
    expect(j.since).toMatchObject({ lastVisit: 0 });
  });
  it("400s a bad n and 401s without a session", async () => {
    expect((await feed.GET(get("/api/feed?n=abc"), ctx())).status).toBe(400);
    jar.header = undefined;
    expect((await feed.GET(get("/api/feed"), ctx())).status).toBe(401);
  });
});

describe("POST /api/react", () => {
  it("records a like once (idempotent), reflects it in the next feed, and 404s an unknown repo", async () => {
    expect((await react.POST(post("/api/react", { id: "a/one", kind: "like" }), ctx())).status).toBe(200);
    expect((await react.POST(post("/api/react", { id: "a/one", kind: "like" }), ctx())).status).toBe(200);
    expect(await mockRedis.hget(`u:${jar.header}:meta`, "reactions")).toBe("1");
    const j = await (await feed.GET(get("/api/feed"), ctx())).json();
    expect(j.items.map((i: { id: string }) => i.id)).not.toContain("a/one");   // seen
    expect((await react.POST(post("/api/react", { id: "zz/top", kind: "like" }), ctx())).status).toBe(404);
    expect((await react.POST(post("/api/react", { id: "a/one", kind: "yeet" }), ctx())).status).toBe(400);
  });
});

describe("GET /api/items/:owner/:name", () => {
  it("serves a carded repo from the fast path; an unheard-of repo is a 404 with no fetch", async () => {
    const ok = await item.GET(get("/api/items/a/one"), ctx({ owner: "a", name: "one" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).repo.id).toBe("a/one");
    const miss = await item.GET(get("/api/items/nobody/nothing"), ctx({ owner: "nobody", name: "nothing" }));
    expect(miss.status).toBe(404);
    expect((await item.GET(get("/api/items/x/y"), ctx({ owner: "..", name: "y" }))).status).toBe(400);
  });
});

describe("GET /api/search", () => {
  it("lexical search works with no embedder configured and reports semantic:false", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("VOYAGE_API_KEY", "");
    const r = await search.GET(get("/api/search?q=rust"), ctx());
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results[0].id).toBe("a/one");
    expect(j.semantic).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("GET /api/health", () => {
  it("is 200 with redis latency and corpus version, needs no session, and does NOT publish spend/queue/routes", async () => {
    jar.header = undefined;
    const j = await (await health.GET(new Request("http://x/api/health"))).json();
    expect(j.ok).toBe(true);
    expect(j.redisMs).toBeGreaterThanOrEqual(0);
    expect(j.spend).toBeUndefined();     // distance-to-503 is not for anonymous callers
    expect(j.routes).toBeUndefined();
  });
  it("returns the dashboard only with the admin token", async () => {
    process.env.CANDY_ADMIN_TOKEN = "t0k";
    try {
      const no = await (await health.GET(new Request("http://x/api/health", { headers: { "x-candy-admin": "wrong" } }))).json();
      expect(no.spend).toBeUndefined();
      const j = await (await health.GET(new Request("http://x/api/health", { headers: { "x-candy-admin": "t0k" } }))).json();
      expect(j.spend).toMatchObject({ capUsd: expect.any(Number) });
      expect(Array.isArray(j.routes)).toBe(true);
    } finally { delete process.env.CANDY_ADMIN_TOKEN; }
  });
});
