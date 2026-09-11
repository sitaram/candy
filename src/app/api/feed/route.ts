import { feed } from "@/lib/user/feed";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

/** GET /api/feed?n=30&exclude=a/b&exclude=c/d */
export async function GET(req: Request) {
  const uid = await getUid();
  const u = new URL(req.url);
  const n = Math.min(100, Number(u.searchParams.get("n") ?? 30));
  const exclude = u.searchParams.getAll("exclude");
  return Response.json(await feed(uid, n, exclude));
}
