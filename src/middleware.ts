import { NextResponse, type NextRequest } from "next/server";

const UID_COOKIE = "cuid";
export const UID_HEADER = "x-candy-uid";

/**
 * Assign an anonymous user id on first visit. Real auth replaces this later.
 *
 * The id also travels to this same request's handlers as a request header, because `cookies()` in a
 * route handler reads the *incoming* jar and would not see a cookie we are setting on the way out.
 * Without this, a first-visit /api/feed would be a 401. An inbound copy of the header is stripped so
 * a client cannot pick its own uid.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete(UID_HEADER);
  const existing = req.cookies.get(UID_COOKIE)?.value;
  if (existing) {
    headers.set(UID_HEADER, existing);
    return NextResponse.next({ request: { headers } });
  }
  const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  headers.set(UID_HEADER, uid);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(UID_COOKIE, uid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  return res;
}

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
