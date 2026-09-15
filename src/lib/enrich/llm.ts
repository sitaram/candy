import Anthropic from "@anthropic-ai/sdk";
import type { Mention, Repo } from "../store/types";
import { CATEGORIES, type Card } from "./card";

export const MODEL = process.env.CANDY_MODEL ?? "claude-haiku-4-5-20251001";

let client: Anthropic | undefined;
export function ai(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM = `You write structured metadata cards for open-source repositories for a tool that helps busy engineers keep up with what's new. You are terse, honest, and skeptical. You never use marketing language.

Interest scale (be strict; the median repo is a 4):
- 9-10: foundational or field-changing; almost every engineer should know it exists (pytorch, rust, a new protocol everyone will use)
- 7-8: notable within a large field; a real advance or a widely useful tool
- 5-6: solid and useful for its niche
- 3-4: fine, ordinary, one of many
- 0-2: low substance, spam, piracy, or nothing to learn

Flags: only set star-farm-suspect when velocity is implausible AND at least one other weak signal is present (no description, no releases, thin README, brand-new account, non-English docs for a global-audience tool, piracy/circumvention). High velocity alone from a known org or a substantive project is not a flag. Use ai-slop for repos that are mostly prompts, skills, or generated boilerplate with little engineering.`;

const TOOL: Anthropic.Tool = {
  name: "emit_card",
  description: "Emit the metadata card for this repository.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["pitch", "whyCare", "voice", "category", "tags", "audience", "ecosystem", "maturity", "kind", "alternatives", "buildsOn", "hook", "interest", "flags", "lang"],
    properties: {
      pitch: { type: "string", description: "One plain sentence: what it is, for whom." },
      whyCare: { type: "string", description: "1-2 sentences. Why care now. Concrete." },
      voice: { type: "string", description: "20-40 second spoken script. Plain speech, no markdown, no URLs, no repo slug punctuation (say the name naturally)." },
      category: { type: "string", enum: CATEGORIES },
      tags: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8 },
      audience: { type: "array", items: { type: "string" }, maxItems: 4 },
      ecosystem: { type: "array", items: { type: "string" }, maxItems: 5 },
      maturity: { type: "string", enum: ["experiment", "early", "usable", "mature", "legacy"] },
      kind: { type: "string", enum: ["library", "framework", "app", "cli", "service", "model", "dataset", "list", "tutorial", "config", "plugin", "other"] },
      alternatives: { type: "array", items: { type: "string" }, maxItems: 6, description: "owner/repo if known, else names. Empty if none." },
      buildsOn: { type: "array", items: { type: "string" }, maxItems: 6 },
      hook: { type: "string", enum: ["new-project", "major-release", "big-org", "viral", "license-change", "novel-approach", "fills-gap", "none"] },
      interest: { type: "integer", minimum: 0, maximum: 10 },
      flags: { type: "array", items: { type: "string", enum: ["spam-suspect", "star-farm-suspect", "no-substance", "non-english", "abandoned", "fork-of-known", "ai-slop"] } },
      lang: { type: "string", description: "ISO 639-1 of README" },
    },
  },
};

interface Release {
  tag_name: string;
  name: string | null;
  published_at: string;
  body: string | null;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "\n…[truncated]";
}

function ageDays(iso: string): number {
  return iso ? Math.round((Date.now() - Date.parse(iso)) / 86_400_000) : -1;
}

export function buildPrompt(repo: Repo, readme: string, releases: Release[], mentions: Mention[]): string {
  const rel = releases.slice(0, 3).map((r) => `- ${r.tag_name} (${r.published_at.slice(0, 10)}): ${clip((r.body ?? r.name ?? "").replace(/\s+/g, " "), 400)}`).join("\n");
  const men = mentions.slice(0, 5).map((m) => `- [${m.source}] ${m.title}${m.points != null ? ` (${m.points} pts, ${m.comments ?? 0} comments)` : ""}`).join("\n");
  return `Repository: ${repo.id}
URL: ${repo.url}
Description: ${repo.description || "(none)"}
Homepage: ${repo.homepage || "(none)"}
Language: ${repo.language || "(unknown)"}  License: ${repo.license || "(none)"}
Topics: ${repo.topics.join(", ") || "(none)"}
Stars: ${repo.stars}  Forks: ${repo.forks}  Watchers: ${repo.watchers}  Open issues: ${repo.openIssues}
Created: ${repo.createdAt.slice(0, 10)} (${ageDays(repo.createdAt)} days ago)  Last push: ${ageDays(repo.pushedAt)} days ago
Stars per day since creation: ${repo.starsPerDay}
Archived: ${repo.archived}  Fork: ${repo.fork}  Manifest: ${repo.manifestKind} (${repo.depCount} deps)
Releases: ${repo.releaseCount}${repo.latestRelease ? `, latest ${repo.latestRelease} ${ageDays(repo.latestReleaseAt)} days ago` : ""}

Recent releases:
${rel || "(none)"}

Mentions:
${men || "(none)"}

README:
${clip(readme, 12_000) || "(empty)"}`;
}

/** The schema is enforced, but models still occasionally return a string where an array is declared. Coerce. */
export function normalizeCard(raw: Record<string, unknown>): Card {
  const arr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === "string" && v.trim()) return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    return [];
  };
  const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || d);
  const flags = arr(raw.flags).filter((f): f is Card["flags"][number] =>
    ["spam-suspect", "star-farm-suspect", "no-substance", "non-english", "abandoned", "fork-of-known", "ai-slop"].includes(f),
  );
  return {
    pitch: str(raw.pitch),
    whyCare: str(raw.whyCare),
    voice: str(raw.voice),
    category: (CATEGORIES.includes(raw.category as Card["category"]) ? raw.category : "other") as Card["category"],
    tags: arr(raw.tags).map((t) => t.toLowerCase()),
    audience: arr(raw.audience),
    ecosystem: arr(raw.ecosystem).map((t) => t.toLowerCase()),
    maturity: oneOf(raw.maturity, ["experiment", "early", "usable", "mature", "legacy"] as const, "usable"),
    kind: oneOf(raw.kind, ["library", "framework", "app", "cli", "service", "model", "dataset", "list", "tutorial", "config", "plugin", "other"] as const, "other"),
    alternatives: arr(raw.alternatives),
    buildsOn: arr(raw.buildsOn),
    hook: oneOf(raw.hook, ["new-project", "major-release", "big-org", "viral", "license-change", "novel-approach", "fills-gap", "none"] as const, "none"),
    interest: Math.max(0, Math.min(10, Math.round(num(raw.interest)))),
    flags,
    lang: str(raw.lang, "en"),
  };
}

export interface Enriched {
  card: Card;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function enrichOne(repo: Repo, readme: string, releases: Release[], mentions: Mention[]): Promise<Enriched> {
  const res = await ai().messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "emit_card" },
    messages: [{ role: "user", content: buildPrompt(repo, readme, releases, mentions) }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no tool_use in response");
  return {
    card: normalizeCard(block.input as Record<string, unknown>),
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}
