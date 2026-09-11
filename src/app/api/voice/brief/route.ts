import { getItem } from "@/lib/corpus/api";
import { cardChangeBrief } from "@/lib/voice/context";

export const dynamic = "force-dynamic";

/** GET /api/voice/brief?id=owner/name&why=a&why=b — brief injected when the on-screen card changes. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const item = await getItem(id);
  if (!item) return Response.json({ error: "unknown" }, { status: 404 });
  const why = u.searchParams.getAll("why");
  const brief = await cardChangeBrief({ id, item, score: 0, fit: 0, why, explore: false, saved: false });
  return Response.json({ brief });
}
