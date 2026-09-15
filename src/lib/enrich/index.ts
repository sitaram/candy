import { safeJson } from "../util/json";
import { corpusIds, getMentions, getRepos } from "../store/corpus";
import { K, normId } from "../store/keys";
import { getRaw } from "../store/raw";
import { redis } from "../store/redis";
import type { Repo } from "../store/types";
import type { Card } from "./card";
import { enrichOne } from "./llm";

/**
 * card:{id}       HASH  Card fields (arrays JSON) + readmeHash + model + enrichedAt
 * by:category:{c} SET   repo ids
 * by:tag:{t}      SET   repo ids  (Card.tags + ecosystem) — cheap similarity until embeddings
 * edges:{id}:alt  SET   alternatives that look like owner/repo
 */
export const CK = {
  card: (id: string) => `card:${id}`,
  byCategory: (c: string) => `by:category:${c}`,
  byTag: (t: string) => `by:tag:${t}`,
  alt: (id: string) => `edges:${id}:alt`,
  builds: (id: string) => `edges:${id}:builds-on`,
};

export interface StoredCard extends Card {
  readmeHash: string;
  model: string;
  enrichedAt: string;
  inputTokens: number;
  outputTokens: number;
}

export function parseCard(h: Record<string, string>): StoredCard | null {
  if (!h.pitch) return null;
  const j = <T>(s: string | undefined, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  return {
    pitch: h.pitch,
    whyCare: h.whyCare ?? "",
    voice: h.voice ?? "",
    category: (h.category ?? "other") as Card["category"],
    tags: j(h.tags, []),
    audience: j(h.audience, []),
    ecosystem: j(h.ecosystem, []),
    maturity: (h.maturity ?? "usable") as Card["maturity"],
    kind: (h.kind ?? "other") as Card["kind"],
    alternatives: j(h.alternatives, []),
    buildsOn: j(h.buildsOn, []),
    hook: (h.hook ?? "none") as Card["hook"],
    interest: Number(h.interest ?? 0) || 0,
    flags: j(h.flags, []),
    lang: h.lang ?? "en",
    readmeHash: h.readmeHash ?? "",
    model: h.model ?? "",
    enrichedAt: h.enrichedAt ?? "",
    inputTokens: Number(h.inputTokens ?? 0) || 0,
    outputTokens: Number(h.outputTokens ?? 0) || 0,
  };
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export async function saveCard(id: string, card: Card, meta: Omit<StoredCard, keyof Card>): Promise<void> {
  const r = redis();
  const p = r.pipeline();
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...card, ...meta })) h[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
  p.hset(CK.card(id), h);
  p.sadd(CK.byCategory(card.category), id);
  for (const t of new Set([...card.tags, ...card.ecosystem].map((s) => s.toLowerCase()))) p.sadd(CK.byTag(t), id);
  const alts = card.alternatives.filter((a) => REPO_RE.test(a)).map(normId);
  if (alts.length) p.sadd(CK.alt(id), ...alts);
  const builds = card.buildsOn.filter((a) => REPO_RE.test(a)).map(normId);
  if (builds.length) p.sadd(CK.builds(id), ...builds);
  await p.exec();
  // Alternatives and builds-on are discovery too — but only a nudge for ids some *other* source already found.
  // A card is derived from an untrusted README; minting new frontier entries from it made the enrich pass a
  // paid crawl oracle (name repos in your README → we fetch and card them). zincrby XX-style: only if present.
  const named = [...new Set([...alts, ...builds])];
  if (named.length) {
    const present = await r.zmscore(K.frontier, ...named);
    const q = r.pipeline();
    named.forEach((a, i) => { if (present[i] != null) q.zincrby(K.frontier, 1, a); });
    await q.exec();
  }
}

export async function getCard(id: string): Promise<StoredCard | null> {
  return parseCard(await redis().hgetall(CK.card(normId(id))));
}

export async function getCards(ids: string[]): Promise<Map<string, StoredCard>> {
  const out = new Map<string, StoredCard>();
  if (!ids.length) return out;
  const res = await redis().pipeline(ids.map((id) => ["hgetall", CK.card(normId(id))])).exec();
  ids.forEach((id, i) => {
    const c = parseCard(((res?.[i]?.[1] as Record<string, string>) ?? {}));
    if (c) out.set(normId(id), c);
  });
  return out;
}

/** Repos in corpus whose card is missing or stale (README changed), highest frontier priority first. */
export async function needsEnrich(limit: number, onlyIds?: Set<string>): Promise<Repo[]> {
  const r = redis();
  let ids = await corpusIds();
  if (onlyIds) ids = ids.filter((id) => onlyIds.has(id));
  if (!ids.length) return [];
  const [repos, cards, prio] = await Promise.all([getRepos(ids), getCards(ids), r.zmscore(K.frontier, ...ids)]);
  const pr = new Map(ids.map((id, i) => [id, Number(prio[i] ?? 0)]));
  const cand = repos.filter((x) => { const c = cards.get(x.id); return !c || (x.readmeHash && c.readmeHash !== x.readmeHash); });
  // Skip repos whose current README has already failed enrichment 3×.
  const fails = cand.length ? await r.mget(...cand.map((x) => `enrichfail:${x.id}:${x.readmeHash ?? "-"}`)) : [];
  return cand
    .filter((_, i) => Number(fails[i] ?? 0) < 3)
    .sort((a, b) => (pr.get(b.id) ?? 0) - (pr.get(a.id) ?? 0))
    .slice(0, limit);
}

export interface EnrichStats {
  done: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

export async function enrich(limit: number, concurrency = 4, log = console.log, onlyIds?: Set<string>): Promise<EnrichStats> {
  const todo = await needsEnrich(limit, onlyIds);
  const st: EnrichStats = { done: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
  if (!todo.length) return st;
  const r = redis();
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const repo = todo[i++];
      try {
        const [readme, relRaw, mentions] = await Promise.all([
          getRaw(repo.id, "readme"),
          getRaw(repo.id, "releases"),
          getMentions(repo.id),
        ]);
        const releases = safeJson<Parameters<typeof enrichOne>[2]>(relRaw, [], "releases");
        const e = await enrichOne(repo, readme, releases, mentions);
        await saveCard(repo.id, e.card, {
          readmeHash: repo.readmeHash,
          model: e.model,
          enrichedAt: new Date().toISOString(),
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
        });
        st.done++;
        st.inputTokens += e.inputTokens;
        st.outputTokens += e.outputTokens;
        const fl = e.card.flags.length ? `  ⚑ ${e.card.flags.join(",")}` : "";
        log(`  ${String(e.card.interest).padStart(2)}  ${repo.id.padEnd(42)} ${e.card.category.padEnd(18)} ${e.card.hook.padEnd(14)} ${e.card.pitch.slice(0, 70)}${fl}`);
      } catch (err) {
        st.failed++;
        // Same README failing again is the same failure: count it, and after 3 stop paying to retry it until the
        // README changes. (The SDK's own retries are already spent by the time we get here.)
        const k = `enrichfail:${repo.id}:${repo.readmeHash ?? "-"}`;
        const n = await redis().incr(k).catch(() => 0); await redis().expire(k, 30 * 86_400).catch(() => {});
        log(`  ✗ ${repo.id}: ${(err as Error).message}${n >= 3 ? "  (3 failures — skipped until README changes)" : ` (${n}/3)`}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return st;
}
