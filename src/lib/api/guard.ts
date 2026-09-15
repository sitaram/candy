/**
 * One front door for every route: parse → limit → run → shape the error.
 *
 *   export const GET = route({ query: Q, limit: "read" }, async ({ query, uid }) => Response.json(...));
 *
 * - `query` / `body` / `params` are zod schemas; a failure is a 400 with the first issue named.
 *   Nothing downstream ever sees an unvalidated value.
 * - `limit` names a bucket in ./ratelimit; exceeding it is a 429 with Retry-After. Per uid.
 * - `uid` is the session id. Middleware puts it on `x-candy-uid` for this request (it also sets the
 *   cookie, but a cookie set on the way out is not visible to `cookies()` on the way in, so a first
 *   visit would otherwise be 401). Missing → 401. The old fallback made every cookieless caller share
 *   one "anon" profile, which was both a privacy hole and a way to poison it. Set `anon: true` for
 *   routes that legitimately have no user (none today).
 * - Thrown errors become a 500 with a request id and never leak the message; the message is logged
 *   once with the id so the two can be joined. Zod and body-parse failures are 400.
 * - Every response carries `x-request-id`.
 */
import { cookies, headers } from "next/headers";
import type { ZodTypeAny, z } from "zod";
import { ZodError } from "zod";
import { UID_COOKIE } from "@/lib/user/uid";
import { verify } from "@/lib/user/sign";
import { rateLimit, type Bucket } from "./ratelimit";
import { recordServer } from "@/lib/errors";
import { observe } from "./metrics";

export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) { super(message); }
}

type Infer<S> = S extends ZodTypeAny ? z.infer<S> : undefined;

interface Spec<Q, B, P> {
  query?: Q;
  body?: B;
  params?: P;
  limit?: Bucket;
  /** Allow requests with no uid cookie (default false → 401). */
  anon?: boolean;
  /** Cap on raw body bytes; default 64 KiB. */
  maxBody?: number;
}

interface Ctx<Q, B, P> {
  req: Request;
  uid: string;
  /** Client IP from the edge; "ip:unknown" if absent. For per-IP spend caps. */
  ip: string;
  rid: string;
  query: Infer<Q>;
  body: Infer<B>;
  params: Infer<P>;
}

type NextCtx = { params: Promise<Record<string, string>> };

export function route<Q extends ZodTypeAny | undefined = undefined, B extends ZodTypeAny | undefined = undefined, P extends ZodTypeAny | undefined = undefined>(
  spec: Spec<Q, B, P>,
  handler: (c: Ctx<Q, B, P>) => Promise<Response>,
) {
  return async function wrapped(req: Request, nextCtx: NextCtx): Promise<Response> {
    const rid = crypto.randomUUID().slice(0, 8);
    const t0 = Date.now();
    let res: Response;
    try {
      // Middleware verified the cookie's signature and put the bare id on the header. The cookie fallback is
      // for a handler reached without middleware (tests, an unusual matcher); it verifies the same way.
      let uid = (await headers()).get("x-candy-uid") ?? "";
      if (!uid) uid = (await verify((await cookies()).get(UID_COOKIE)?.value))?.id ?? "";
      if (!uid && !spec.anon) throw new HttpError(401, "no session cookie");
      if (uid && !/^[a-z0-9]{8,40}$/i.test(uid)) throw new HttpError(400, "bad session cookie");
      // Cross-site mutation guard. SameSite=lax already keeps the cookie off cross-site POSTs in every
      // current browser; this is the belt for the braces, and it costs one header compare. Origin is
      // absent on same-origin GETs and on sendBeacon from some browsers, so only its *presence with a
      // different host* is refused.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
        if (origin && host && new URL(origin).host !== host) throw new HttpError(403, "cross-site request refused");
      }

      if (spec.limit) {
        const rl = await rateLimit(spec.limit, uid || ipOf(req), ipOf(req));
        if (!rl.ok) throw new HttpError(429, `rate limited: ${spec.limit}`, { "Retry-After": String(rl.retryAfter) });
      }

      const url = new URL(req.url);
      const query = spec.query ? spec.query.parse(qobj(url.searchParams)) : undefined;
      const params = spec.params ? spec.params.parse((await nextCtx?.params) ?? {}) : undefined;
      let body: unknown = undefined;
      if (spec.body) {
        const raw = await readBody(req, spec.maxBody ?? 64 * 1024);
        let parsed: unknown;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, "body is not JSON"); }
        body = spec.body.parse(parsed);
      }

      res = await handler({ req, uid: uid || "anon", ip: ipOf(req), rid, query: query as Infer<Q>, body: body as Infer<B>, params: params as Infer<P> });
    } catch (e) {
      res = toResponse(e, rid, req);
    }
    res.headers.set("x-request-id", rid);
    const ms = Date.now() - t0, path = new URL(req.url).pathname;
    if (res.status >= 500) console.error(`[api] ${rid} ${req.method} ${path} → ${res.status} ${ms}ms`);
    observe(path, ms, res.status);
    return res;
  };
}

function toResponse(e: unknown, rid: string, req: Request): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, rid }, { status: e.status, headers: e.headers });
  if (e instanceof ZodError) {
    const i = e.issues[0];
    const where = i.path.length ? `${i.path.join(".")}: ` : "";
    return Response.json({ error: `${where}${i.message}`, rid }, { status: 400 });
  }
  // Unknown: log the real thing with the id, tell the client only the id.
  const path = new URL(req.url).pathname;
  console.error(`[api] ${rid} ${req.method} ${path} threw`, e);
  recordServer(`api:${path}`, e, { rid, status: 500, url: path });
  return Response.json({ error: "internal error", rid }, { status: 500 });
}

/** searchParams → plain object; repeated keys become arrays so `z.array()` schemas work on `?tag=a&tag=b`. */
function qobj(sp: URLSearchParams): Record<string, string | string[]> {
  const o: Record<string, string | string[]> = {};
  for (const [k, v] of sp) {
    const cur = o[k];
    if (cur === undefined) o[k] = v;
    else if (Array.isArray(cur)) cur.push(v);
    else o[k] = [cur, v];
  }
  return o;
}

async function readBody(req: Request, max: number): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) throw new HttpError(413, `body over ${max} bytes`);
  const raw = await req.text();
  if (raw.length > max) throw new HttpError(413, `body over ${max} bytes`);
  return raw;
}

export function ipOf(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "ip:unknown";
}
