import { getItems, type Filter, type Sort } from "@/lib/corpus/api";
import type { Category, Hook } from "@/lib/enrich/card";

export const dynamic = "force-dynamic";

/** GET /api/items?sort=interest&limit=50&category=ai-agents&tag=rust&minInterest=6&hook=major-release&releasedWithinDays=7 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) ?? undefined;
  const ga = (k: string) => (u.searchParams.getAll(k).length ? u.searchParams.getAll(k) : undefined);
  const filter: Filter = {
    category: ga("category") as Category[] | undefined,
    tag: ga("tag"),
    hook: ga("hook") as Hook[] | undefined,
    minInterest: g("minInterest") ? Number(g("minInterest")) : undefined,
    language: g("language"),
    createdWithinDays: g("createdWithinDays") ? Number(g("createdWithinDays")) : undefined,
    releasedWithinDays: g("releasedWithinDays") ? Number(g("releasedWithinDays")) : undefined,
    source: g("source"),
    collection: g("collection"),
    cardsOnly: g("cardsOnly") !== "0",
    exclude: ga("exclude"),
  };
  const items = await getItems(filter, (g("sort") as Sort) ?? "interest", Number(g("limit") ?? 50));
  return Response.json({ count: items.length, items });
}
