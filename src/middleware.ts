import { NextResponse, type NextRequest } from "next/server";
import { newId, sign, verify } from "@/lib/user/sign";

const UID_COOKIE = "cuid";
export const UID_HEADER = "x-candy-uid";

/**
 * Two jobs on every request.
 *
 * 1. Anonymous identity. The cookie is a signed id; only ids this server minted are acted on. A tampered
 *    or foreign cookie is replaced, not trusted. The *bare* id travels to this same request's handlers as
 *    a request header, because `cookies()` in a route handler reads the *incoming* jar and would not see a
 *    cookie set on the way out — without this a first-visit /api/feed would be a 401. An inbound copy of
 *    the header is stripped so a client cannot pick its own uid.
 *
 * 2. CSP nonce. A fresh nonce per response goes into a Content-Security-Policy set on both the forwarded
 *    request (Next reads it there and stamps every script tag) and the response (the browser enforces it),
 *    so `script-src` needs neither 'unsafe-inline' nor a hash of the hydration bootstrap. Dev keeps 'unsafe-eval' for Fast Refresh. Everything else about the policy
 *    is static and lives here too, so there is exactly one place the browser's rules are written.
 */
export async function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete(UID_HEADER);

  const v = await verify(req.cookies.get(UID_COOKIE)?.value);
  const uid = v?.id ?? newId();
  headers.set(UID_HEADER, uid);

  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const policy = csp(nonce);
  // Next's App Router reads the nonce out of the *request's* CSP header when it renders script tags.
  headers.set("content-security-policy", policy);

  const res = NextResponse.next({ request: { headers } });
  // New id, tampered cookie, or a legacy unsigned one: (re)set it signed.
  if (!v || v.legacy) {
    res.cookies.set(UID_COOKIE, await sign(uid), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  }
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

function csp(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced bootstrap load the chunks it imports without listing them.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",   // gestures drive CSS variables through style=
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://api.openai.com",   // realtime SDP handshake; the audio is SRTP, outside CSP
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
