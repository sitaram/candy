import { route } from "@/lib/api/guard";
import { RepoId, Text, VoiceToolBody } from "@/lib/api/schemas";
import { getItemDetail, search, similar } from "@/lib/corpus/api";
import { briefOf } from "@/lib/voice/context";
import { askRepo } from "@/lib/ask";
import { recordServer } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/voice/tool { name, args, current? }
 * Executes the corpus-reading tools the realtime model calls. Read-only; only ask_repo calls a model.
 * (next_card / react / show_repo are executed in the client because they drive the UI.)
 *
 * `args` come from the model, not the user, but the model repeats what the user said — so they are
 * re-validated here with the same schemas as the typed routes. A tool failure is a 200 with an
 * `output` telling the model to say so: a 500 here would just make the voice go silent.
 */
export const POST = route({ body: VoiceToolBody, limit: "llm", maxBody: 8_192 }, async ({ body }) => {
  const t0 = Date.now();
  const { name, args } = body;
  console.info(`[voice/tool] ${name} ${JSON.stringify(args).slice(0, 120)}${body.current ? ` @${body.current}` : ""}`);
  const say = (output: string) => Response.json({ output });
  try {
    switch (name) {
      case "get_repo": {
        const p = RepoId.safeParse(args.id);
        const raw = p.success ? p.data : Text(100).parse(String(args.id ?? ""));
        if (!raw) return say("Need a repo name.");
        const [detail, sims] = p.success ? await Promise.all([getItemDetail(raw), similar(raw, 6).catch(() => [])]) : [null, []];
        if (!detail) {
          const hits = await search(raw.split("/").pop() ?? raw, 3);
          if (!hits.length) return say(`Not in the corpus: ${raw}.`);
          return say(`No exact match for ${raw}. Closest:\n${hits.map((h) => `  - ${h.repo.id}: ${h.card?.pitch ?? h.repo.description}`).join("\n")}`);
        }
        const rel = sims.length ? `\nRelated:\n${sims.map((s) => `  - ${s.item.repo.id}: ${s.item.card?.pitch ?? s.item.repo.description}`).join("\n")}` : "";
        return say(briefOf(detail, { full: true }) + rel);
      }
      case "ask_repo": {
        const id = RepoId.safeParse(args.id ?? body.current);
        const question = Text(1_000).parse(String(args.question ?? ""));
        if (!id.success || !question) return say("Need a repo and a question.");
        const a = await askRepo({ id: id.data, question, spoken: true });
        return say(a ? a.answer : `Not in the corpus: ${id.data}.`);
      }
      case "find_repos": {
        const q = Text(200).parse(String(args.query ?? ""));
        const limit = Math.min(8, Math.max(1, Number(args.limit) || 6));
        if (!q) return say("Empty query.");
        const hits = await search(q, limit);
        if (!hits.length) return say(`Nothing in the corpus for "${q}".`);
        return say(hits.map((h) => briefOf(h)).join("\n\n"));
      }
    }
  } catch (e) {
    // Swallowed on purpose — the model must keep talking — but not silently: this is the one server
    // failure the user never sees as an error, so the sink is the only place it will show up.
    console.error(`[voice/tool] ${name} threw after ${Date.now() - t0}ms`, e);
    recordServer(`voice/tool:${name}`, e);
    return say("Tool failed; tell the user briefly and continue.");
  }
});
