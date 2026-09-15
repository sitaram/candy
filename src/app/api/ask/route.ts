import { askRepo } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/ask { id, question, history?, spoken? } → { answer } */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; question?: string; history?: { q: string; a: string }[]; spoken?: boolean };
  if (!b.id || !b.question?.trim()) return Response.json({ error: "id and question required" }, { status: 400 });
  try {
    const a = await askRepo({ id: b.id, question: b.question.trim(), history: b.history, spoken: b.spoken });
    if (!a) return Response.json({ error: "not in corpus" }, { status: 404 });
    return Response.json(a);
  } catch (e) {
    console.error("[ask]", e);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
