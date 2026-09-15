/**
 * Related projects, structured.
 *
 * A flat "similar" list makes the reader do the clustering. Instead: gather neighbours from every
 * signal we have (named alternatives, README links, shared tags, embedding cosine), then group them
 * with a *specific* label — "Also runs models locally", "Built on top of it", "Same idea in Rust" —
 * so a glance tells you what each group is.
 *
 * Labels are written offline by the card model (`pnpm relate`) and stored at rel:{id}. When absent,
 * a deterministic grouping runs at read time so the UI never degrades to a list.
 *
 * rel:{id}  STRING  gzip? no — small JSON: { groups: [{ label, ids }], at, model }
 */
import { redis } from "../store/redis";
import { CK } from "../enrich";
import { dot, getEmbeddings } from "../embed";
import { allItems, getItem, type Item } from "./api";
import { getEdges } from "../store/corpus";

export interface Neighbor {
  item: Item;
  score: number;
  /** machine-readable signals, used to build fallback groups and to brief the labeller */
  signals: { alt?: true; linksTo?: true; linkedFrom?: true; sameOwner?: true; shared: string[]; cos?: number; sameCategory?: true };
}

export interface RelGroup { label: string; ids: string[] }
export interface Related { groups: { label: string; items: Item[] }[]; labelled: boolean }

const RK = (id: string) => `rel:${id}`;

/** Tags that co-occur with everything and say nothing about *what* a repo is. Never count them as shared. */
const NOISE_TAGS = new Set([
  "openai", "chatgpt", "anthropic", "claude", "cursor", "vs-code", "vscode", "local-first", "open-source", "self-hosted",
  "ai", "llm", "ai-automation", "productivity", "developer-tools", "dev-tools", "cli", "terminal", "python", "typescript",
  "javascript", "rust", "go", "api", "sdk", "framework", "library", "tool", "tools", "mcp", "agents", "ai-agents",
  "openai-api", "nodejs", "node", "nextjs", "react", "web", "github", "docker", "linux", "macos", "windows", "webui", "gui",
]);

/** Tag IDF over the corpus: a tag shared by 5 repos is worth a lot more than one shared by 300. Cached per process. */
let idfCache: { at: number; idf: Map<string, number> } | null = null;
function tagIdf(all: Item[]): Map<string, number> {
  if (idfCache && Date.now() - idfCache.at < 300_000) return idfCache.idf;
  const df = new Map<string, number>();
  let n = 0;
  for (const it of all) { if (!it.card) continue; n++; for (const t of new Set([...it.card.tags, ...it.card.ecosystem].map((x) => x.toLowerCase()))) df.set(t, (df.get(t) ?? 0) + 1); }
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)));
  idfCache = { at: Date.now(), idf };
  return idf;
}

/**
 * Candidate neighbours from every signal, scored, best first.
 *
 * Scoring principles (learned the hard way — the first version surfaced a 4★ toy above the 30k★ peer):
 *  - A named alternative is the strongest signal we have; it dominates.
 *  - Shared tags are weighted by IDF and noise tags ("openai", "cursor", "local-first") count for nothing.
 *  - Embedding cosine is a *gate and a tiebreaker*, not the score: below .52 a candidate needs another
 *    reason to be here at all; above it, it adds modestly.
 *  - Stars matter — log-scaled, so a 30k★ peer beats a 30★ one but 100k doesn't crush 10k. A neighbour
 *    nobody uses is rarely the one you want to hear about.
 *  - Same category alone is worth almost nothing; half the corpus is ai-agents.
 */
export async function neighbors(id: string, limit = 24): Promise<Neighbor[]> {
  const me = await getItem(id);
  if (!me?.card) return [];
  const r = redis();
  const [all, altIds, links] = await Promise.all([allItems(), r.smembers(CK.alt(me.repo.id)), getEdges(me.repo.id, "links")]);
  const idf = tagIdf(all);
  const carded = all.filter((it) => it.card && it.repo.id !== me.repo.id);
  // Alternatives by id, and by bare name when the card only names them ("aider", "cline").
  const byName = new Map<string, string>();
  for (const it of carded) { const nm = it.repo.name.toLowerCase(); if (!byName.has(nm) || it.repo.stars > (all.find((x) => x.repo.id === byName.get(nm))?.repo.stars ?? 0)) byName.set(nm, it.repo.id); }
  const alt = new Set(altIds.map((x) => x.toLowerCase()));
  for (const a of me.card.alternatives) { const al = a.toLowerCase(); if (al.includes("/")) alt.add(al); else { const hit = byName.get(al) ?? byName.get(al.replace(/\s+/g, "-")); if (hit) alt.add(hit); } }
  const out = new Set(links);
  const inbound = new Set(await r.smembers(`edges:${me.repo.id}:linked-by`).catch(() => [] as string[]));
  const myTags = new Set([...me.card.tags, ...me.card.ecosystem].map((t) => t.toLowerCase()).filter((t) => !NOISE_TAGS.has(t)));
  const emb = await getEmbeddings([me.repo.id, ...carded.map((it) => it.repo.id)]);
  const mine = emb.get(me.repo.id);
  const meNamesMe = (it: Item) => it.card!.alternatives.some((a) => { const al = a.toLowerCase(); return al === me.repo.id || al === me.repo.name.toLowerCase(); });

  const res: Neighbor[] = [];
  for (const it of carded) {
    const c = it.card!;
    const s: Neighbor["signals"] = { shared: [] };
    let score = 0;
    const isAlt = alt.has(it.repo.id) || meNamesMe(it);
    if (isAlt) { s.alt = true; score += 8; }
    if (out.has(it.repo.id)) { s.linksTo = true; score += 2.5; }
    if (inbound.has(it.repo.id)) { s.linkedFrom = true; score += 2.5; }
    if (it.repo.owner.toLowerCase() === me.repo.owner.toLowerCase()) { s.sameOwner = true; score += 1.5; }
    if (c.category === me.card.category) { s.sameCategory = true; score += 0.3; }
    const shared = Array.from(new Set([...c.tags, ...c.ecosystem].map((t) => t.toLowerCase()).filter((t) => myTags.has(t))));
    s.shared = shared;
    score += Math.min(4, shared.reduce((a, t) => a + (idf.get(t) ?? 1), 0) * 0.8);
    const v = emb.get(it.repo.id);
    const cos = mine && v ? dot(mine, v) : 0;
    if (cos) s.cos = cos;
    const hard = isAlt || !!s.linksTo || !!s.linkedFrom || !!s.sameOwner;
    if (cos > 0.50) score += (cos - 0.50) * 12;                          // .60 → +1.2, .70 → +2.4
    // Low cosine says "the text is about something else". That should veto a *tag-only* candidate, but not
    // an explicit relationship: a README link or a sibling repo is related whatever the embedding thinks.
    else if (cos && cos < 0.42 && !hard) score -= (0.42 - cos) * 15;    // .30 → −1.8
    // Popularity: log10 stars, centred so 1k★ is neutral. 30k★ → +1.5, 30★ → −1.5.
    score += (Math.log10(Math.max(1, it.repo.stars)) - 3) * 1.0;
    // Admission: a hard edge (always, in case a low score would hide it), OR meaning + a specific shared tag, OR very close meaning alone.
    const hasReason = hard || (cos > 0.50 && shared.length >= 1) || cos > 0.58;
    if (hasReason && (hard || score >= 1.0)) res.push({ item: it, score, signals: s });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Deterministic grouping from signals alone. Specific enough to be useful, never wrong.
 * Order matters: a neighbour lands in the first group that claims it.
 */
export function fallbackGroups(me: Item, ns: Neighbor[]): RelGroup[] {
  const groups: RelGroup[] = [];
  const taken = new Set<string>();
  const claim = (label: string, pick: (n: Neighbor) => boolean, min = 1, max = 6) => {
    const ids = ns.filter((n) => !taken.has(n.item.repo.id) && pick(n)).map((n) => n.item.repo.id).slice(0, max);
    if (ids.length >= min) { groups.push({ label, ids }); ids.forEach((i) => taken.add(i)); }
  };
  const name = me.repo.name;
  const myLang = me.repo.language;
  const strong = (n: Neighbor) => (n.signals.cos ?? 0) > 0.60;
  // 1. Relationships we actually know.
  claim(`Does the same job as ${name}`, (n) => !!n.signals.alt);
  claim(`Built on ${name}`, (n) => !!n.signals.linkedFrom);
  claim(`What ${name} builds on`, (n) => !!n.signals.linksTo);
  claim(`More from ${me.repo.owner}`, (n) => !!n.signals.sameOwner, 2);
  // 2. Closest by meaning, split by whether they share the stack — the difference is the interesting part.
  claim(`Same idea, not ${myLang}`, (n) => strong(n) && !!myLang && !!n.item.repo.language && n.item.repo.language !== myLang, 2, 5);
  claim(`Closest in spirit`, strong, 2, 5);
  if (!groups.length) claim(`Closest in spirit`, (n) => (n.signals.cos ?? 0) > 0.52, 2, 5);
  // 3. The most common shared tag among what's left, phrased as what they have in common.
  const usedTag = new Set<string>();
  for (let k = 0; k < 2; k++) {
    const count = new Map<string, number>();
    for (const n of ns) if (!taken.has(n.item.repo.id)) for (const t of n.signals.shared) if (!usedTag.has(t) && t !== myLang?.toLowerCase()) count.set(t, (count.get(t) ?? 0) + 1);
    const top = Array.from(count).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < 2) break;
    usedTag.add(top[0]);
    claim(`Also about ${top[0]}`, (n) => n.signals.shared.includes(top[0]), 2, 5);
  }
  // 4. The biggest thing in the same corner, if nothing claimed it — the incumbent worth knowing about.
  const big = ns.filter((n) => !taken.has(n.item.repo.id) && n.signals.sameCategory).sort((a, b) => b.item.repo.stars - a.item.repo.stars)[0];
  if (big && big.item.repo.stars > me.repo.stars * 3) claim(`The big one in ${me.card?.category.replace(/-/g, " ")}`, (n) => n === big, 1, 1);
  return groups.slice(0, 4);
}

export async function getRelated(id: string): Promise<Related> {
  const me = await getItem(id);
  if (!me) return { groups: [], labelled: false };
  const [stored, ns] = await Promise.all([redis().get(RK(me.repo.id)), neighbors(me.repo.id)]);
  const byId = new Map(ns.map((n) => [n.item.repo.id, n.item]));
  let groups: RelGroup[]; let labelled = false;
  if (stored) {
    try { groups = (JSON.parse(stored) as { groups: RelGroup[] }).groups; labelled = true; } catch { groups = fallbackGroups(me, ns); }
  } else groups = fallbackGroups(me, ns);
  // Stored groups may name ids that fell out of the neighbour set since; resolve what we can, fetch the rest.
  const missing = groups.flatMap((g) => g.ids).filter((i) => !byId.has(i));
  if (missing.length) for (const m of missing) { const it = await getItem(m); if (it) byId.set(m, it); }
  return {
    labelled,
    groups: groups.map((g) => ({ label: g.label, items: g.ids.map((i) => byId.get(i)).filter(Boolean) as Item[] })).filter((g) => g.items.length),
  };
}

export async function putRelated(id: string, groups: RelGroup[], model: string): Promise<void> {
  await redis().set(RK(id), JSON.stringify({ groups, at: Date.now(), model }));
}
export async function hasRelated(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const p = redis().pipeline(); for (const id of ids) p.exists(RK(id));
  const res = await p.exec();
  return new Set(ids.filter((_, i) => (res?.[i]?.[1] as number) === 1));
}
