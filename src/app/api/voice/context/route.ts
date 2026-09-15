import { route } from "@/lib/api/guard";
import { VoiceSessionBody } from "@/lib/api/schemas";
import { resolveMode } from "@/lib/voice/mode";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice/context — same body as /api/voice/session, but returns the session fields instead of
 * minting a token. The client sends them as `session.update` on a live connection to move the
 * conversation between surfaces (search ↔ card ↔ card) without tearing the call down.
 */
export const POST = route({ body: VoiceSessionBody, limit: "read", maxBody: 8_192 }, async ({ uid, body }) => {
  const t0 = Date.now();
  const m = await resolveMode(uid, body);
  const label = body.mode === "search" ? body.query ?? "" : body.mode === "doc" ? "design.md" : body.id;
  console.info(`[voice/context] ${uid.slice(0, 8)} → ${body.mode} ${label} · ${m.instructions.length} chars, ${m.tools.length} tools · ${Date.now() - t0}ms`);
  return Response.json(m);
});
