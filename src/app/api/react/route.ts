import { act } from "@/lib/user/feed";
import type { Action } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

const KINDS = new Set<Action>(["like", "skip", "save", "dive", "unsave", "undo"]);

/** POST /api/react { id, kind }  kind: like | skip | save | dive | unsave | undo */
export async function POST(req: Request) {
  const uid = await getUid();
  const body = (await req.json().catch(() => ({}))) as { id?: string; kind?: string };
  if (!body.id || !KINDS.has(body.kind as Action)) return Response.json({ error: "id and kind required" }, { status: 400 });
  const ok = await act(uid, body.id, body.kind as Action);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
