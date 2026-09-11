import { react } from "@/lib/user/feed";
import type { Reaction } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

const KINDS = new Set<Reaction>(["like", "skip", "save", "dive"]);

/** POST /api/react { id, kind } */
export async function POST(req: Request) {
  const uid = await getUid();
  const body = (await req.json().catch(() => ({}))) as { id?: string; kind?: string };
  if (!body.id || !KINDS.has(body.kind as Reaction)) return Response.json({ error: "id and kind required" }, { status: 400 });
  const ok = await react(uid, body.id, body.kind as Reaction);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
