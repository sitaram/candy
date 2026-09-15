/**
 * Voice context: everything the realtime model is told before it says a word.
 *
 * The card is the context. The model gets the current repo in full (card, stats, release, why it's
 * in your feed, alternatives, similar repos with one-line pitches) plus a compact profile, and three
 * tools that hit the same read-only corpus API the feed uses. No LLM on the tool path.
 */
import { getItemDetail, type Item, type ItemDetail } from "@/lib/corpus/api";
import { similar } from "@/lib/corpus/related";
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
    ? `Interests (learned from swipes, strongest first): ${meInfo.topTerms.slice(0, 10).map((t) => spoken(t.term)).join(", ")}.${meInfo.avoidTerms.length ? ` Tends to skip: ${meInfo.avoidTerms.slice(0, 5).map((t) => spoken(t.term)).join(", ")}.` : ""} ${meInfo.reactions} reactions so far.`
    : "New user; no learned interests yet. Ask what they work on if it would help.";

  const instructions = `# Role and Objective
You are candy, a voice guide to open-source software. The user is looking at one repository card on their phone, often while walking or driving. Help them understand it fast, go deeper on request, and move through their feed by voice. Everything you say is spoken aloud.

# Personality and Tone
A sharp, warm, opinionated engineer-friend — the colleague who has already tried the thing and tells you straight. Speak in full, natural sentences, the way a person talks on the phone: contractions, a bit of rhythm, an opinion. No hype, no filler ("sure", "great question"), and no clipped telegraph-style fragments joined by dashes — if you wouldn't say it out loud to a friend, don't say it. Say repo names naturally ("playwright", not "microsoft slash playwright") unless disambiguation is needed.

# Language
English. Match the user if they switch.

# Opening
On connection, without waiting for the user to speak, give a spoken take on the current repo in at most 20 seconds (roughly 45-60 words): what it is, why it is in their feed, and the one most interesting thing (a hook, a release, a mention, an alternative). The user's microphone is closed while you give this take — they cannot interrupt — so end it by handing the floor over clearly. Close with one sentence that (a) tells them they can now talk and (b) names two or three concrete things they could ask, using this repo's own terms — an alternative by name, a release, a hook. For example: "I'm listening now — ask me how it compares to Whisper, what changed in 0.4, or say next." Then stop. After that first take the mic stays open and they can interrupt you at any time.

# Verbosity
- Direct answers: one or two natural sentences. Short is good; terse is not.
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

/** Profile terms as a voice would say them: cat:ai-llm → "AI and LLMs", lang:rust → "Rust", mcp → "MCP servers". */
const SPOKEN: Record<string, string> = {
  "cat:ai-llm": "AI and LLM tools", "cat:ai-agents": "AI agents", "cat:ml-infra": "ML infrastructure", "cat:dev-tools": "dev tools", "cat:cli": "command-line tools",
  "cat:web-framework": "web frameworks", "cat:frontend": "frontend", "cat:backend": "backend", "cat:database": "databases", "cat:data-eng": "data engineering",
  "cat:devops-infra": "DevOps and infra", "cat:security": "security", "cat:networking": "networking", "cat:systems": "systems programming",
  "cat:languages-compilers": "languages and compilers", "cat:mobile": "mobile", "cat:desktop": "desktop apps", "cat:games-graphics": "games and graphics",
  "cat:science": "scientific computing", "cat:productivity": "productivity", "cat:learning-resource": "learning resources",
  mcp: "MCP servers", llm: "LLM tooling", "local-inference": "local LLMs", rag: "RAG", agents: "agents", cli: "CLI tools", rust: "Rust", python: "Python",
  typescript: "TypeScript", go: "Go", "vs code": "VS Code extensions", vscode: "VS Code extensions", neovim: "Neovim", terminal: "terminal tools",
  "self-hosted": "self-hosted software", "local-first": "local-first apps", kubernetes: "Kubernetes", postgres: "Postgres", postgresql: "Postgres",
  voice: "voice", tts: "text-to-speech", stt: "speech-to-text", testing: "testing", e2e: "end-to-end testing", observability: "observability",
  claude: "Claude tooling", openai: "OpenAI tooling", anthropic: "Anthropic tooling", huggingface: "Hugging Face", "hugging-face": "Hugging Face",
  pytorch: "PyTorch", cuda: "CUDA", react: "React", nextjs: "Next.js", "next.js": "Next.js", vue: "Vue", svelte: "Svelte", tailwind: "Tailwind",
  docker: "Docker", wasm: "WebAssembly", webassembly: "WebAssembly", privacy: "privacy tools", "speaker-diarization": "speaker diarization",
  whisper: "Whisper", langchain: "LangChain", "vector-database": "vector databases", embeddings: "embeddings", "fine-tuning": "fine-tuning",
  "open-source": "open source", oss: "open source", github: "GitHub tooling", git: "Git tools", sqlite: "SQLite", redis: "Redis", graphql: "GraphQL",
};
export function spoken(term: string): string {
  if (SPOKEN[term]) return SPOKEN[term];
  if (term.startsWith("lang:")) { const l = term.slice(5); return l.length <= 3 ? l.toUpperCase() : l[0].toUpperCase() + l.slice(1); }
  if (term.startsWith("cat:")) return term.slice(4).replace(/-/g, " ");
  return term.replace(/-/g, " ");
}

/**
 * Two interests to name in the opener, drawn from the top five so it is not "mcp" every time.
 * Deterministic per hour, so a retry within a session sounds the same, but tomorrow sounds different.
 * Skips categories/languages when tags are available — "more MCP servers" beats "more dev tools".
 */
function openerInterests(meInfo: Me): string[] {
  const pool = meInfo.topTerms.slice(0, 6);
  const tags = pool.filter((t) => !t.term.startsWith("cat:") && !t.term.startsWith("lang:"));
  const pick = (tags.length >= 2 ? tags : pool).slice(0, 5);
  if (pick.length <= 2) return pick.map((t) => spoken(t.term));
  const seed = Math.floor(Date.now() / 3_600_000);
  const a = seed % pick.length;
  const b = (a + 1 + (seed >> 3) % (pick.length - 1)) % pick.length;
  return [spoken(pick[a].term), spoken(pick[b].term)];
}

/** Instructions for a session started from the search box. */
export function buildSearchContext(meInfo: Me | null, initialQuery?: string): string {
  const profile = meInfo && meInfo.topTerms.length
    ? `Interests (learned from swipes, strongest first): ${meInfo.topTerms.slice(0, 10).map((t) => spoken(t.term)).join(", ")}.`
    : "New user; no learned interests yet.";
  // Only lean on the profile once it has some weight behind it; a three-swipe profile is noise.
  const confident = !!meInfo && meInfo.topTerms.length >= 3 && (meInfo.tasteWeight >= 6 || meInfo.reactions >= 8);
  const ints = confident && meInfo ? openerInterests(meInfo) : [];
  return `# Role and Objective
You are candy's search. The user opened a search box on their phone and tapped the voice button. They will say what they are looking for — a repo by name, a topic, or something they want to build. Turn it into a search, read them the shape of the results, and help them pick. Everything you say is spoken aloud.

# Personality and Tone
A friend who knows open source well and is glad you asked. Speak in full, natural sentences the way a person does on the phone — warm, relaxed, specific. Contractions are fine. No filler ("sure", "great question"), no bullet-point cadence, no clipped fragments joined by dashes. If you would not say it out loud to a colleague, do not say it.

# Opening
On connection, before the user speaks, say a short, friendly invitation — two sentences at most, around fifteen to twenty-five words — then stop and listen. It should do two things: sound like a real greeting, and tell them in passing what they can say (a project name, a topic, or the thing they are trying to build). Do not read a menu. Do not say "or a wild card". Vary the wording each time.
${initialQuery
  ? `They already typed "${initialQuery}". Acknowledge that and invite more, e.g. "I'll look for ${initialQuery} — tell me a bit more about what you need and I'll narrow it down."`
  : ints.length
    ? `They have history — you know they've been into ${ints.join(" and ")} lately. Bring one of those in naturally, the way a friend who remembers would, and leave the door open. For example: "Hey. You've been deep in ${ints[0]} lately — want more of that, or is there something you're trying to build today? Just tell me what you're after." Or: "Welcome back. I can find a project by name, or by what you need it to do — and if you want more ${ints[1] ?? ints[0]}, I've got plenty. What are you looking for?"`
    : `New user. For example: "Hi. Tell me a project you've heard of, a topic you're curious about, or something you're trying to build, and I'll find what's out there."`}

# Flow
1. After the opening, listen.
2. As soon as you understand the request, call search(query). Do not ask clarifying questions before the first search; search first, refine after.
3. When results return, say one sentence: roughly how many good options there are and which one looks strongest, with a reason a person would give. Example: "There are six decent ones, and Pipecat looks like the strongest — it's a Python framework for real-time voice agents." Then stop and let them steer.
4. If they refine ("just TypeScript", "something smaller", "not that one"), call search again with the refined query and give one sentence again.
5. If they say open / show me / the second one / the <name> one, call open_result. Confirm in two or three words.
6. If they ask about a result, answer from the brief in at most two sentences.

# Verbosity
One natural sentence after a search, two at most for a question. Never read more than two repo names aloud. Short is good; terse is not — "Six matches, and Pipecat looks strongest: it's a Python framework for real-time voice agents" is right, "Six. Pipecat. Python voice." is not.

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

/* ---------------- doc mode: talk about the design document ---------------- */

/**
 * The whole design doc goes into the instructions (it is ~4k tokens; the realtime context holds it
 * comfortably and it is cached across turns). The opening is a spoken one-minute summary that
 * covers every section in proportion, then a conversation grounded in the text.
 */
export function buildDocContext(md: string): string {
  // Strip the markdown table and link syntax the model would otherwise try to read aloud.
  const plain = md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\|.*\|$/gm, (row) => row.split("|").map((c) => c.trim()).filter(Boolean).join(" — "))
    .replace(/^\|?\s*-{3,}.*$/gm, "");
  return `# Role and Objective
You are candy's guide to its own design document. The user is on the "How it works" page of candy, an app for discovering open-source projects, and tapped the voice button in the header. First give them a spoken summary of the whole document, about one minute long. Then answer questions and discuss it, grounded in the text below. Everything you say is spoken aloud.

# Personality and Tone
Someone who built this and is explaining it to a colleague they respect. Plain, warm, specific. Full natural sentences, contractions fine. No filler, no bullet cadence, no reading headings aloud. If you would not say it out loud to a colleague, do not say it.

# Opening: the one-minute summary
Speak for about a minute — roughly 140 to 170 words — and stop. It must be balanced across the whole document, not front-loaded. Cover, in this order and in roughly these proportions:
1. The problem and the idea (about 25 words): finding open source is accidental and desk-bound; consumer apps solved this for other things; bring those patterns to code.
2. What is novel (about 60 words): pick four or five — fusing six sources so agreement is the signal; the card as typed answers to an engineer's questions; two swipe grammars, browse free and decide cheap; two learning models, one that explains and one that scores; related projects in labelled groups; the corpus growing behind attention.
3. Voice and search (about 35 words): a live, interruptible conversation you can have on a walk or a drive; the guide already knows the card; hard questions go to a second model that has read the README; search is the feed with a query, ranked for you.
4. What was learned and what is next (about 25 words): one or two concrete learnings, then one line on where it is going.
End with one short sentence inviting a question, e.g. "Ask me about any part of it." Then stop and listen.

# After the opening
- Answer from the document. Two to four sentences for most questions; go longer only if asked to.
- If they ask for detail on a section, give it from the text, in your own words, not by reading it.
- If they ask something the document does not cover, say so plainly, then offer what it does say that is closest.
- Numbers matter here (the corpus counts, the costs, the search evaluation). Quote them when relevant; do not round them into vagueness.
- Say "the doc" or "the design" rather than "the document" every time.
- If they say done, stop, or thanks: say "okay" and stop.

# Verbosity
The opening is the only long turn. After that, conversational length.

# The document
${plain}`;
}
