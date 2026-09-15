import { cookies, headers } from "next/headers";

export const UID_COOKIE = "cuid";

/**
 * Anonymous user id. Middleware sets the cookie and mirrors it onto `x-candy-uid` so the very first
 * request can see it too; this only reads. Route handlers should use `route()` from lib/api/guard,
 * which 401s on a missing id; this is for server components, which fall back to a throwaway id
 * rather than sharing one "anon" profile across everyone without a cookie.
 */
export async function getUid(): Promise<string> {
  const h = await headers();
  const fromHeader = h.get("x-candy-uid");
  if (fromHeader) return fromHeader;
  const c = await cookies();
  return c.get(UID_COOKIE)?.value ?? `nocookie-${crypto.randomUUID().slice(0, 8)}`;
}
