import { cookies } from "next/headers";

export const UID_COOKIE = "cuid";

/** Anonymous user id from cookie. Middleware sets it; this only reads. */
export async function getUid(): Promise<string> {
  const c = await cookies();
  return c.get(UID_COOKIE)?.value ?? "anon";
}
