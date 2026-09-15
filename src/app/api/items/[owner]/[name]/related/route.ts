import { HttpError, route } from "@/lib/api/guard";
import { ItemParams, RepoId } from "@/lib/api/schemas";
import { getItem, similar } from "@/lib/corpus/api";
import { enqueueBackfill, missingAlternatives } from "@/lib/corpus/backfill";
import { getRelated } from "@/lib/corpus/related";

export const dynamic = "force-dynamic";

/**
 * GET /api/items/:owner/:name/related — the slow half of a deep dive: labelled groups, flat similar
 * fallback, and how many alternatives are still being fetched. Split from the detail route so the
 * description paints in ~150 ms and this streams in behind it. Never fetches: the detail route did.
 */
export const GET = route({ params: ItemParams, limit: "read" }, async ({ params }) => {
  const id = RepoId.parse(`${params.owner}/${params.name}`);
  if (!(await getItem(id))) throw new HttpError(404, "not found");
  const [sim, rel, miss] = await Promise.all([similar(id, 10), getRelated(id), missingAlternatives(id)]);
  const pending = miss.missing.length + miss.unresolved.length;
  if (pending) await enqueueBackfill(id).catch(() => {});
  return Response.json({
    similar: sim.map((s) => ({ id: s.item.repo.id, score: s.score, why: s.why, pitch: s.item.card?.pitch })),
    labelled: rel.labelled,
    pending,
    groups: rel.groups.map((g) => ({
      label: g.label,
      items: g.items.map((it) => ({ id: it.repo.id, name: it.repo.name, owner: it.repo.owner, pitch: it.card?.pitch ?? it.repo.description ?? "", stars: it.repo.stars, lang: it.repo.language, category: it.card?.category ?? "" })),
    })),
  });
});
