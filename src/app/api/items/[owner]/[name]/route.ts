import { getItemDetail, similar } from "@/lib/corpus/api";
import { ensureItem } from "@/lib/corpus/ensure";

export const dynamic = "force-dynamic";

/** GET /api/items/:owner/:name  -> full detail + similar */
export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await ctx.params;
  const ens = await ensureItem(`${owner}/${name}`);
  if (!ens.exists) return Response.json({ error: "not found" }, { status: 404 });
  const id = ens.id;
  const [detail, sim] = await Promise.all([getItemDetail(id), similar(id, 10)]);
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...detail, similar: sim.map((s) => ({ id: s.item.repo.id, score: s.score, why: s.why, pitch: s.item.card?.pitch })) });
}
