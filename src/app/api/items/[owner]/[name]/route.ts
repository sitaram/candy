import { getItemDetail, similar } from "@/lib/corpus/api";
import { getRelated } from "@/lib/corpus/related";
import { ensureItem } from "@/lib/corpus/ensure";
import { backfillAlternatives, missingAlternatives } from "@/lib/corpus/backfill";
import { after } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/items/:owner/:name  -> full detail + similar */
export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await ctx.params;
  const ens = await ensureItem(`${owner}/${name}`);
  if (!ens.exists) return Response.json({ error: "not found" }, { status: 404 });
  const id = ens.id;
  const [detail, sim, rel, miss] = await Promise.all([getItemDetail(id), similar(id, 10), getRelated(id), missingAlternatives(id)]);
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  // Tail on demand: fetch + card the alternatives this repo names but the corpus lacks, after the response is sent.
  const pending = miss.missing.length + miss.unresolved.length;
  if (pending) after(() => backfillAlternatives(id).catch((e) => console.warn("[backfill]", e)));
  return Response.json({
    ...detail,
    similar: sim.map((s) => ({ id: s.item.repo.id, score: s.score, why: s.why, pitch: s.item.card?.pitch })),
    related: {
      labelled: rel.labelled,
      pending,
      groups: rel.groups.map((g) => ({
        label: g.label,
        items: g.items.map((it) => ({ id: it.repo.id, name: it.repo.name, owner: it.repo.owner, pitch: it.card?.pitch ?? it.repo.description ?? "", stars: it.repo.stars, lang: it.repo.language, category: it.card?.category ?? "" })),
      })),
    },
  });
}
