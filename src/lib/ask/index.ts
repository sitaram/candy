/**
 * Deep questions about one repo, answered from everything we hold on it: full README (≤60k chars),
 * manifest, last 10 releases with notes, mentions, card, graph edges. A text model reads it all
 * and answers the question — the realtime voice model only ever sees a brief, so it hands hard
 * questions here. Also usable from the detail view as a typed Q&A.
 *
 * Cost: a 60k README is ~15k tokens → ~$0.015 on Haiku per question. Cache-friendly: the repo
 * context is the system prompt and is stable across questions on the same repo.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getItemDetail } from "../corpus/api";
import { getRaw } from "../store/raw";

const MODEL = process.env.CANDY_ASK_MODEL ?? process.env.CANDY_MODEL ?? "claude-haiku-4-5-20251001";
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export interface Ask { id: string; question: string; history?: { q: string; a: string }[]; spoken?: boolean }
export interface Answer { answer: string; model: string; contextChars: number }

export async function askRepo({ id, question, history = [], spoken = false }: Ask): Promise<Answer | null> {
  const d = await getItemDetail(id);
  if (!d) return null;
  const manifest = await getRaw(d.repo.id, "manifest").catch(() => "");
  const r = d.repo, c = d.card;

  const ctx: string[] = [
    `# ${r.id}`,
    r.description ?? "",
    `Stars ${r.stars} (${r.starsPerDay.toFixed(1)}/day) · created ${r.createdAt.slice(0, 10)} · last push ${r.pushedAt.slice(0, 10)} · language ${r.language ?? "?"} · license ${r.license ?? "?"} · ${r.openIssues} open issues · ${r.forks} forks`,
    r.homepage ? `Homepage: ${r.homepage}` : "",
    r.topics.length ? `GitHub topics: ${r.topics.join(", ")}` : "",
  ];
  if (c) ctx.push(`\n## Card (our summary)\nPitch: ${c.pitch}\nWhy care: ${c.whyCare}\nCategory ${c.category} · maturity ${c.maturity} · hook ${c.hook}\nTags: ${c.tags.join(", ")}\nEcosystem: ${c.ecosystem.join(", ")}\nAudience: ${c.audience.join(", ")}\nAlternatives (from README/our read): ${c.alternatives.join(", ") || "none listed"}`);
  if (d.edges.alt.length || d.edges.buildsOn.length || d.edges.links.length)
    ctx.push(`\n## Graph\nAlternatives in corpus: ${d.edges.alt.join(", ") || "-"}\nBuilds on: ${d.edges.buildsOn.join(", ") || "-"}\nLinks to (from README): ${d.edges.links.slice(0, 20).join(", ") || "-"}`);
  if (d.releases.length) ctx.push(`\n## Releases (newest first)\n${d.releases.map((x) => `### ${x.tag_name}${x.name && x.name !== x.tag_name ? ` — ${x.name}` : ""} (${x.published_at.slice(0, 10)})\n${x.body?.trim() || "(no notes)"}`).join("\n\n")}`);
  if (d.mentions.length) ctx.push(`\n## Mentions\n${d.mentions.map((m) => `- ${m.source}: ${m.title}${m.points ? ` (${m.points} pts, ${m.comments ?? 0} comments)` : ""} ${m.url}`).join("\n")}`);
  if (manifest) ctx.push(`\n## Manifest (${r.manifestKind ?? "package"})\n${manifest.slice(0, 6000)}`);
  if (d.readme) ctx.push(`\n## README\n${d.readme}`);
  const context = ctx.filter(Boolean).join("\n");

  const system = [
    `You answer hard, specific questions about one open-source repository using only the material below. You are talking to an experienced engineer deciding whether to use, adopt, contribute to, or ignore this project.`,
    `Rules: Be direct and concrete. Quote or paraphrase the README/release notes when they answer the question; say so when they do not ("the README doesn't cover this"). Never invent APIs, numbers, or features. Distinguish what the project claims from what is verified (stars, releases, mentions are verified; README prose is a claim). If the question is comparative and the other project is not in the material, say what you can about this one and name what you'd need to check.`,
    spoken
      ? `The answer will be spoken aloud: 2-4 sentences, no lists, no code, no URLs, no markdown. Lead with the answer.`
      : `Format: short paragraphs or a tight list. Code snippets only if the README has them and they answer the question. Under 200 words unless the question genuinely needs more.`,
    `\n---\n${context}`,
  ].join("\n\n");

  const messages: Anthropic.MessageParam[] = [];
  for (const h of history.slice(-4)) { messages.push({ role: "user", content: h.q }); messages.push({ role: "assistant", content: h.a }); }
  messages.push({ role: "user", content: question });

  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: spoken ? 300 : 700,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  });
  const answer = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
  return { answer, model: res.model, contextChars: context.length };
}
