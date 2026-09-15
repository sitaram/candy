import { route } from "@/lib/api/guard";
import { AskBody } from "@/lib/api/schemas";
import { askRepo } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/ask { id, question, history?, spoken? } → { answer } */
export const POST = route({ body: AskBody, limit: "llm" }, async ({ body }) => {
  const a = await askRepo(body);
  if (!a) return Response.json({ error: "not in corpus" }, { status: 404 });
  return Response.json(a);
});
