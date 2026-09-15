import { route } from "@/lib/api/guard";
import { ItemsQuery } from "@/lib/api/schemas";
import { getItems, type Filter } from "@/lib/corpus/api";
import type { Category, Hook } from "@/lib/enrich/card";

export const dynamic = "force-dynamic";

/** GET /api/items?sort=interest&limit=50&category=ai-agents&tag=rust&minInterest=6&hook=major-release&releasedWithinDays=7 */
export const GET = route({ query: ItemsQuery, limit: "read" }, async ({ query: q }) => {
  const filter: Filter = {
    category: q.category.length ? (q.category as Category[]) : undefined,
    tag: q.tag.length ? q.tag : undefined,
    hook: q.hook.length ? (q.hook as Hook[]) : undefined,
    minInterest: q.minInterest,
    language: q.language,
    createdWithinDays: q.createdWithinDays || undefined,
    releasedWithinDays: q.releasedWithinDays || undefined,
    source: q.source,
    collection: q.collection,
    cardsOnly: q.cardsOnly,
    exclude: q.exclude.length ? q.exclude : undefined,
  };
  const items = await getItems(filter, q.sort, q.limit);
  return Response.json({ count: items.length, items });
});
