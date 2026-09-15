/**
 * Voice context: everything the realtime model is told before it says a word.
 *
 * The card is the context. The model gets the current repo in full (card, stats, release, why it's
 * in your feed, alternatives, similar repos with one-line pitches) plus a compact profile, and three
 * tools that hit the same read-only corpus API the feed uses. No LLM on the tool path.
 */
import { getItemDetail, similar, type Item, type ItemDetail } from "@/lib/corpus/api";
import type { FeedItem } from "@/lib/user/feed";
import type { Me } from "@/lib/user/state";

const CAT: Record<string, string> = {
  "ai-llm": "AI / LLM", "ai-agents": "AI agents", "ml-infra": "ML infra", "dev-tools": "dev tools", cli: "CLI",
  "web-framework": "web framework", frontend: "frontend", backend: "backend", database: "database", "data-eng": "data engineering",
  "devops-infra": "DevOps / infra", security: "security", networking: "networking", systems: "systems",
  "languages-compilers": "languages / compilers", mobile: "mobile", desktop: "desktop", "games-graphics": "games / graphics",
  science: "science", productivity: "productivity", "learning-resource": "learning resource", "awesome-list": "curated list", other: "other",
};

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
function ago(iso: string): string {
  if (!iso) return "unknown";
  const d = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.round(d)} days ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  return `${(d / 365).toFixed(1)} years ago`;
}

/** One-paragraph brief of a repo: what the model reads for the current card, and what tools return. */
export function briefOf(it: Item | ItemDetail, opts: { why?: string[]; full?: boolean } = {}): string {
  const r = it.repo, c = it.card;
  const lines: string[] = [];
  lines.push(`REPO ${r.id} — ${r.url}`);
  if (c) {
    lines.push(`Pitch: ${c.pitch}`);
    lines.push(`Why it matters: ${c.whyCare}`);
    lines.push(`Category: ${CAT[c.category] ?? c.category}. Kind: ${c.kind}. Maturity: ${c.maturity}. Interest 0-10: ${c.interest}.`);
    if (c.audience.length) lines.push(`For: ${c.audience.join(", ")}.`);
    if (c.tags.length) lines.push(`Tags: ${c.tags.join(", ")}.`);
    if (c.ecosystem.length) lines.push(`Ecosystem: ${c.ecosystem.join(", ")}.`);
    if (c.hook !== "none") lines.push(`Hook: ${c.hook}.`);
    if (c.alternatives.length) lines.push(`Alternatives it names: ${c.alternatives.join(", ")}.`);
    if (c.buildsOn.length) lines.push(`Builds on: ${c.buildsOn.join(", ")}.`);
    if (c.flags.length) lines.push(`Quality flags: ${c.flags.join(", ")}.`);
  } else {
    lines.push(`Description: ${r.description}`);
  }
  lines.push(`Stats: ${fmt(r.stars)} stars, ${r.starsPerDay >= 1 ? `+${Math.round(r.starsPerDay)}/day` : "slow growth"}, created ${ago(r.createdAt)}, last push ${ago(r.pushedAt)}. Language: ${r.language || "n/a"}. License: ${r.license || "none"}.${r.archived ? " ARCHIVED." : ""}`);
  if (r.latestRelease) lines.push(`Latest release: ${r.latestRelease} (${ago(r.latestReleaseAt)}).`);
  if (it.sources.length) lines.push(`Seen on: ${it.sources.join(", ")}${it.awesome.length ? `; in awesome lists: ${it.awesome.slice(0, 4).join(", ")}` : ""}.`);
  if (opts.why?.length) lines.push(`Why it is in this user's feed: ${opts.why.join("; ")}.`);
  if (opts.full && "readme" in it) {
    const d = it as ItemDetail;
    if (d.releases.length) {
      lines.push("Recent releases:");
      for (const rel of d.releases.slice(0, 3)) lines.push(`  - ${rel.tag_name} (${ago(rel.published_at)})${rel.body ? `: ${rel.body.replace(/\s+/g, " ").slice(0, 280)}` : ""}`);
    }
    if (d.mentions.length) {
      lines.push("Mentions:");
      for (const m of d.mentions.slice(0, 4)) lines.push(`  - ${m.source}: ${m.title}${m.points ? ` (${m.points} points)` : ""}`);
    }
    if (d.readme) lines.push(`README (excerpt): ${d.readme.replace(/\s+/g, " ").slice(0, 1800)}`);
  }
  return lines.join("\n");
}

export const TOOLS = [
  {
    type: "function",
    name: "get_repo",
    description: "Fetch everything known about one repository in the candy corpus: card, stats, releases, mentions, README excerpt, alternatives, related repos. Use when the user asks about a specific repo other than the one on screen, or wants more depth than the brief gives.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "owner/name, e.g. microsoft/playwright. Case-insensitive." } },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "find_repos",
    description: "Search the corpus by free text over names, pitches, tags and categories. Use for 'what else like this', 'alternatives to X', 'anything for <topic>'. Returns up to 8 briefs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query, 1-6 words." },
        limit: { type: "integer", description: "Max results, default 6." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "next_card",
    description: "Advance the user's feed to the next card and return its brief. Use when the user says next, skip ahead, what else, move on. The screen changes too.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "ask_repo",
    description: "Answer a hard or specific question about one repo by reading its FULL README, manifest, release notes, and mentions — far more than the brief you have. Use for: how does it actually work, does it support X, how do I install/configure it, what changed in the last release, what are its limits, how does it compare to Y, is it production-ready, who maintains it, what's the license catch. Takes 3-6 seconds; say 'let me read' first. Returns a spoken-length answer you should relay nearly verbatim.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "owner/name of the repo. Defaults to the one on screen." },
        question: { type: "string", description: "The user's question, restated precisely." },
      },
      required: ["question"],
    },
  },
  {
    type: "function",
    name: "show_repo",
    description: "Put a repository's card on the user's screen. Call this whenever you start talking about a repo other than the one on screen — an alternative, a related project, a find_repos result the user picked, anything you name by name — so what they see matches what they hear. Inserts the card right after the current one and pages to it; the user can swipe back. Returns the card's brief.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "owner/name, e.g. simonw/llm. Case-insensitive. A bare name is resolved if unambiguous." } },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "react",
    description: "Record the user's decision on the card currently on screen. 'like' = interesting (swipe right), 'skip' = not for me (swipe left), 'save' = bookmark. like/skip also advance to the next card.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["like", "skip", "save"] } },
      required: ["kind"],
    },
  },
] as const;

export interface VoiceContext {
  instructions: string;
  cardBrief: string;
}

/** Build the system instructions for a session that starts on `cur`. */
export async function buildContext(cur: FeedItem, meInfo: Me | null): Promise<VoiceContext> {
  const [detail, sims] = await Promise.all([getItemDetail(cur.id), similar(cur.id, 6)]);
  const cardBrief = briefOf(detail ?? cur.item, { why: cur.why, full: true });
  const simBrief = sims.length
    ? sims.map((s) => `  - ${s.item.repo.id}: ${s.item.card?.pitch ?? s.item.repo.description} (${fmt(s.item.repo.stars)}★${s.why[0] ? `; ${s.why[0]}` : ""})`).join("\n")
    : "  (none computed)";
  const profile = meInfo && meInfo.topTerms.length
    ? `Interests (learned from swipes, strongest first): ${meInfo.topTerms.slice(0, 10).map((t) => t.term).join(", ")}.${meInfo.avoidTerms.length ? ` Tends to skip: ${meInfo.avoidTerms.slice(0, 5).map((t) => t.term).join(", ")}.` : ""} ${meInfo.reactions} reactions so far.`
    : "New user; no learned interests yet. Ask what they work on if it would help.";

  const instructions = `# Role and Objective
You are candy, a voice guide to open-source software. The user is looking at one repository card on their phone, often while walking or driving. Help them understand it fast, go deeper on request, and move through their feed by voice. Everything you say is spoken aloud.

# Personality and Tone
Sharp, warm, opinionated engineer-friend. Plain words. No hype, no filler, no "great question". Say repo names naturally (say "playwright", not "microsoft slash playwright") unless disambiguation is needed.

# Language
English. Match the user if they switch.

# Opening
On connection, without waiting for the user to speak, give a spoken take on the current repo in at most 20 seconds (roughly 45-60 words): what it is, why it is in their feed, and the one most interesting thing (a hook, a release, a mention, an alternative). Then offer a choice in one short sentence, e.g. "Want the story, what it competes with, or what's new?" Then stop and listen.

# Verbosity
- Direct answers: 1-2 short sentences.
- Explanations: at most 3 sentences, then ask if they want more.
- Comparisons: name the key difference and who each fits, in 2-3 sentences.
- Never read lists longer than 3 items aloud; summarize and offer to go on.
- Ask one question at a time.

# Reasoning
Answer from the brief directly. Do not reason at length for simple lookups.

# Tools
- The current repo is fully described below; do not call get_repo for it.
- Related repos are listed with one-line pitches; you can discuss them from that. Call get_repo only when the user wants real depth on one.
- Call find_repos for "what else", "alternatives", "anything for <topic>". Say what you are doing in a few words while it runs ("let me look").
- Call ask_repo when the user asks something the brief cannot answer — how it works internally, install/config, a specific feature, what changed, limits, licensing, production readiness, a comparison. Do not guess from the brief; the brief is a summary and the user wants the bottom of it. Say "let me read" (2-3 words) and call it. Relay the answer; do not pad it.
- Call show_repo the moment you shift to talking about a different repo — an alternative, a related project, one result from find_repos, anything you name. The screen should always show the repo you are describing. Do not ask permission; do not announce it. If the user says "show me that" or "put it up", it is the same tool.
- Call next_card when the user says next / move on / what else is in my feed. After it returns, give the new card the same 20-second opening.
- Call react when the user expresses a decision: "like that", "not for me", "save it", "bookmark". Confirm in 3-5 words. like and skip move to the next card; treat that like next_card.
- Never invent a repo or a fact. If a tool returns nothing, say the corpus does not have it yet.

# Unclear Audio
If audio is unclear or silent, ask them to repeat once, briefly. Do not guess repo names; if unsure of a name, spell what you heard.

# Ending
If the user says done, stop, bye, or thanks that's all: say a 2-4 word goodbye and stop. Do not restart the conversation on your own.

# User
${profile}

# Current card
${cardBrief}

# Related repos in the corpus
${simBrief}`;

  return { instructions, cardBrief };
}

/* ---------------- search mode ---------------- */

export const SEARCH_TOOLS = [
  {
    type: "function",
    name: "search",
    description: "Run the user's request as a search over the candy corpus (open-source repos). Call this as soon as you understand what they want — a repo name, a topic, or a description of something they want to build. The results appear on the user's screen; you get them back as briefs. Refinements ('just the Rust ones', 'smaller projects') are a new search with the refined query.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The search, in the user's words, lightly cleaned. Keep intent: 'voice agent framework python real time', not 'voice'." } },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "open_result",
    description: "Open one of the results on screen as a card. Use when the user says open it / show me the second one / the Pipecat one.",
    parameters: {
      type: "object",
      properties: { which: { type: "string", description: "1-based position ('2'), or a repo name from the results ('pipecat')." } },
      required: ["which"],
    },
  },
] as const;

/** Instructions for a session started from the search box. */
export function buildSearchContext(meInfo: Me | null, initialQuery?: string): string {
  const profile = meInfo && meInfo.topTerms.length
    ? `Interests (learned from swipes, strongest first): ${meInfo.topTerms.slice(0, 10).map((t) => t.term).join(", ")}.`
    : "New user; no learned interests yet.";
  return `# Role and Objective
You are candy's search. The user opened a search box on their phone and tapped the voice button. They will say what they are looking for — a repo by name, a topic, or something they want to build. Turn it into a search, read them the shape of the results, and help them pick. Everything you say is spoken aloud.

# Personality and Tone
Quick, plain, helpful. No preamble, no "sure", no "great question".

# Opening
On connection, before the user speaks, say one short invitation and stop. Under twelve words, warm, no list. Pick one that fits:
${initialQuery
  ? `- They already typed "${initialQuery}": say something like "Searching that — or tell me more about what you're after."`
  : meInfo && meInfo.topTerms.length
    ? `- They have history: weave in one interest, e.g. "What are you after? More ${meInfo.topTerms[0].term}, or something new?"`
    : `- New user: "What are you looking for? A name, a topic, or a problem."`}
Do not explain the tool. Do not list options. One sentence, then listen.

# Flow
1. After the opening, listen.
2. As soon as you understand the request, call search(query). Do not ask clarifying questions before the first search; search first, refine after.
3. When results return, say ONE sentence: how many good options and the strongest one with a five-word reason. Example: "Six matches — Pipecat is the strongest, a Python framework for real-time voice agents." Then stop.
4. If they refine ("just TypeScript", "something smaller", "not that one"), call search again with the refined query and give one sentence again.
5. If they say open / show me / the second one / the <name> one, call open_result. Confirm in two or three words.
6. If they ask about a result, answer from the brief in at most two sentences.

# Verbosity
One sentence after a search. Two at most for a question. Never read more than two repo names aloud.

# Rules
- Never invent a repo. If search returns nothing, say so in one sentence and suggest different words.
- Say repo names naturally ("pipecat", not "pipecat-ai slash pipecat").
- If audio is unclear, ask them to say it again, once.
- If they say done, stop, or thanks: say "okay" and stop.

# User
${profile}
${initialQuery ? `
# Already in the box
"${initialQuery}" — they may be refining this.` : ""}`;
}

/** Brief injected when the on-screen card changes mid-conversation. */
export async function cardChangeBrief(next: FeedItem): Promise<string> {
  const [detail, sims] = await Promise.all([getItemDetail(next.id), similar(next.id, 4)]);
  const brief = briefOf(detail ?? next.item, { why: next.why, full: false });
  const simBrief = sims.map((s) => `  - ${s.item.repo.id}: ${s.item.card?.pitch ?? s.item.repo.description}`).join("\n");
  return `The card on screen is now:\n${brief}\nRelated:\n${simBrief}`;
}
