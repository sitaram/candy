import { search } from "@/lib/user/search";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

/** GET /api/search?q=…&n=20 — personalized search; same FeedItem shape as /api/feed plus `match`. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  const n = Math.min(40, Math.max(1, Number(u.searchParams.get("n") ?? 20)));
  const uid = await getUid();
  const res = await search(uid, q, n);
  return Response.json(res);
}
