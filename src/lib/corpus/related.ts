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

/** Candidate neighbours from every signal, scored, best first. */
export async function neighbors(id: string, limit = 24): Promise<Neighbor[]> {
  const me = await getItem(id);
  if (!me?.card) return [];
  const r = redis();
  const [all, altIds, links] = await Promise.all([allItems(), r.smembers(CK.alt(me.repo.id)), getEdges(me.repo.id, "links")]);
  const alt = new Set(altIds), out = new Set(links);
  const myTags = new Set([...me.card.tags, ...me.card.ecosystem].map((t) => t.toLowerCase()));
  const carded = all.filter((it) => it.card && it.repo.id !== me.repo.id);
  // Who links to me? One scan over edges is too many round trips; use the reverse-link set if present, else skip.
  const inbound = new Set(await r.smembers(`edges:${me.repo.id}:linked-by`).catch(() => [] as string[]));
  const emb = await getEmbeddings([me.repo.id, ...carded.map((it) => it.repo.id)]);
  const mine = emb.get(me.repo.id);

  const res: Neighbor[] = [];
  for (const it of carded) {
    const c = it.card!;
    const s: Neighbor["signals"] = { shared: [] };
    let score = 0;
    if (alt.has(it.repo.id)) { s.alt = true; score += 5; }
    if (out.has(it.repo.id)) { s.linksTo = true; score += 2; }
    if (inbound.has(it.repo.id)) { s.linkedFrom = true; score += 2; }
    if (it.repo.owner.toLowerCase() === me.repo.owner.toLowerCase()) { s.sameOwner = true; score += 1.5; }
    if (c.category === me.card.category) { s.sameCategory = true; score += 1; }
    const shared = Array.from(new Set([...c.tags, ...c.ecosystem].map((t) => t.toLowerCase()).filter((t) => myTags.has(t))));
    s.shared = shared; score += Math.min(3, shared.length);
    const v = emb.get(it.repo.id);
    if (mine && v) { const cos = dot(mine, v); s.cos = cos; if (cos > 0.45) score += (cos - 0.45) * 12; }   // .55 → +1.2, .70 → +3
    if (score >= 1.5 || (s.cos ?? 0) > 0.5) res.push({ item: it, score, signals: s });
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
  const strong = (n: Neighbor) => (n.signals.cos ?? 0) > 0.58;
  // 1. Relationships we actually know.
  claim(`Does the same job as ${name}`, (n) => !!n.signals.alt);
  claim(`Built on ${name}`, (n) => !!n.signals.linkedFrom);
  claim(`What ${name} builds on`, (n) => !!n.signals.linksTo);
  claim(`More from ${me.repo.owner}`, (n) => !!n.signals.sameOwner, 2);
  // 2. Closest by meaning, split by whether they share the stack — the difference is the interesting part.
  claim(`Same idea, not ${myLang}`, (n) => strong(n) && !!myLang && !!n.item.repo.language && n.item.repo.language !== myLang, 2, 5);
  claim(`Closest in spirit`, strong, 2, 5);
  if (!groups.length) claim(`Closest in spirit`, (n) => (n.signals.cos ?? 0) > 0.5, 2, 5);
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
