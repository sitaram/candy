import { getItemDetail, search, similar } from "@/lib/corpus/api";
import { briefOf } from "@/lib/voice/context";
import { askRepo } from "@/lib/ask";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice/tool { name, args }
 * Executes the corpus-reading tools the realtime model calls. Read-only, no LLM, ~50-150 ms.
 * (next_card / react are executed in the client because they drive the UI.)
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  const body = (await req.json().catch(() => ({}))) as { name?: string; args?: Record<string, unknown>; current?: string };
  console.info(`[voice/tool] ${body.name} ${JSON.stringify(body.args ?? {}).slice(0, 120)}${body.current ? ` @${body.current}` : ""}`);
  const args = body.args ?? {};
  try {
    switch (body.name) {
      case "get_repo": {
        const raw = String(args.id ?? "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
        const [detail, sims] = await Promise.all([getItemDetail(raw), similar(raw, 6).catch(() => [])]);
        if (!detail) {
          // Fuzzy: try by name only.
          const hits = await search(raw.split("/").pop() ?? raw, 3);
          if (!hits.length) return Response.json({ output: `Not in the corpus: ${raw}.` });
          return Response.json({ output: `No exact match for ${raw}. Closest:\n${hits.map((h) => `  - ${h.repo.id}: ${h.card?.pitch ?? h.repo.description}`).join("\n")}` });
        }
        const rel = sims.length ? `\nRelated:\n${sims.map((s) => `  - ${s.item.repo.id}: ${s.item.card?.pitch ?? s.item.repo.description}`).join("\n")}` : "";
        return Response.json({ output: briefOf(detail, { full: true }) + rel });
      }
      case "ask_repo": {
        const id = String(args.id ?? body.current ?? "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
        const question = String(args.question ?? "").trim();
        if (!id || !question) return Response.json({ output: "Need a repo and a question." });
        const a = await askRepo({ id, question, spoken: true });
        return Response.json({ output: a ? a.answer : `Not in the corpus: ${id}.` });
      }
      case "find_repos": {
        const q = String(args.query ?? "").trim();
        const limit = Math.min(8, Math.max(1, Number(args.limit ?? 6)));
        if (!q) return Response.json({ output: "Empty query." });
        const hits = await search(q, limit);
        if (!hits.length) return Response.json({ output: `Nothing in the corpus for "${q}".` });
        return Response.json({ output: hits.map((h) => briefOf(h)).join("\n\n") });
      }
      default:
        return Response.json({ output: `Unknown tool ${body.name}` }, { status: 400 });
    }
  } catch (e) {
    console.error(`[voice/tool] ${body.name} threw after ${Date.now() - t0}ms`, e);
    return Response.json({ output: "Tool failed; tell the user briefly and continue." }, { status: 500 });
  }
}
