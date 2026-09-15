import { HttpError, route } from "@/lib/api/guard";
import { VoiceBriefQuery } from "@/lib/api/schemas";
import { getItem } from "@/lib/corpus/api";
import { cardChangeBrief } from "@/lib/voice/context";

export const dynamic = "force-dynamic";

/** GET /api/voice/brief?id=owner/name&why=a&why=b — brief injected when the on-screen card changes. */
export const GET = route({ query: VoiceBriefQuery, limit: "read" }, async ({ query }) => {
  const item = await getItem(query.id);
  if (!item) throw new HttpError(404, "unknown");
  const brief = await cardChangeBrief({ id: query.id, item, score: 0, fit: 0, why: query.why, explore: false, saved: false });
  return Response.json({ brief });
});
