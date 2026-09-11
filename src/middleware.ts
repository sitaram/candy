import { NextResponse, type NextRequest } from "next/server";

const UID_COOKIE = "cuid";

/** Assign an anonymous user id on first visit. Real auth replaces this later. */
export function middleware(req: NextRequest) {
  if (req.cookies.get(UID_COOKIE)) return NextResponse.next();
  const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const res = NextResponse.next();
  res.cookies.set(UID_COOKIE, uid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  // Make it visible to this same request's server components too.
  req.cookies.set(UID_COOKIE, uid);
  return res;
}

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
