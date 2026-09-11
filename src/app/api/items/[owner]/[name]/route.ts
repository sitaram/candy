import { getItemDetail, similar } from "@/lib/corpus/api";

export const dynamic = "force-dynamic";

/** GET /api/items/:owner/:name  -> full detail + similar */
export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await ctx.params;
  const id = `${owner}/${name}`;
  const [detail, sim] = await Promise.all([getItemDetail(id), similar(id, 10)]);
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ...detail, similar: sim.map((s) => ({ id: s.item.repo.id, score: s.score, why: s.why, pitch: s.item.card?.pitch })) });
}
