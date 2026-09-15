import { route } from "@/lib/api/guard";
import { AskBody } from "@/lib/api/schemas";
import { askRepo } from "@/lib/ask";
import { charge, refund } from "@/lib/api/spend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/ask { id, question, history?, spoken? } → { answer } */
export const POST = route({ body: AskBody, limit: "llm" }, async ({ uid, ip, body }) => {
  const who = { uid, ip };
  await charge("ask", who);
  const a = await askRepo(body).catch(async (e) => { await refund("ask", who); throw e; });
  if (!a) { await refund("ask", who); return Response.json({ error: "not in corpus" }, { status: 404 }); }
  return Response.json(a);
});
