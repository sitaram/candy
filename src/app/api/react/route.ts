import { route } from "@/lib/api/guard";
import { ReactBody } from "@/lib/api/schemas";
import { act } from "@/lib/user/feed";

export const dynamic = "force-dynamic";

/** POST /api/react { id, kind }  kind: like | skip | save | dive | unsave | undo */
export const POST = route({ body: ReactBody, limit: "write", maxBody: 2_048 }, async ({ uid, body }) => {
  const ok = await act(uid, body.id, body.kind);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
});
