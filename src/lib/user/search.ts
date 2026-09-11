/**
 * Search: the feed with a query.
 *
 * Three retrievers over the same corpus, merged, then passed through the same personal ranker
 * the feed uses, so results come back as FeedItems with `why[]`:
 *
 *   name     prefix / substring on owner/name        — "playwright", "ollama"        instant
 *   keyword  tags, category, pitch, why-care          — "mcp server", "e2e testing"  instant
 *   semantic embed(query) · emb:{id}                  — "I want to build a voice agent that…"
 *
 * Semantic is the primary lane for anything that reads like intent; name/keyword add a boost
 * so an exact repo hit always tops its own query. Degrades to name+keyword when vectors are
 * absent or the embedding call fails. No LLM on the path; one embeddings call (~60 ms).
 */
import { allItems, type Item } from "../corpus/api";
import { embedTexts, getEmbeddings, getTaste, dot } from "../embed";
import { baseScore, fitScore, tasteFit } from "./rank";
import { getProfile, isSaved } from "./state";
import type { FeedItem } from "./feed";

export interface SearchResult extends FeedItem {
  /** How this result was found; the UI shows the strongest as a chip. */
  match: "exact" | "name" | "keyword" | "semantic";
}

export interface SearchResponse {
  q: string;
  results: SearchResult[];
  /** Whether the semantic lane ran. False when vectors are absent or the embed call failed. */
  semantic: boolean;
  /** Set when q looks like owner/name or a bare name and we have exactly that repo. */
  exact: string | null;
}

const STOP = new Set("a an the i want to build build a for with that which what should use using of in on and or is it my me some something tool library framework app project thing things want need looking like best good".split(" "));

/** Keywords for the lexical lane: drop stop-words, keep 2+ char tokens, dedupe. */
function keywords(q: string): string[] {
  return Array.from(new Set(q.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t))));
}

/** Does the query read like a repo reference? owner/name, or one token with no spaces. */
function looksLikeName(q: string): boolean {
  const t = q.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(t) || (/^[\w.-]+$/.test(t) && t.length >= 3);
}

interface Hit { it: Item; lex: number; sem: number; match: SearchResult["match"] }

export async function search(uid: string, qRaw: string, limit = 20): Promise<SearchResponse> {
  const q = qRaw.trim();
  if (q.length < 2) return { q, results: [], semantic: false, exact: null };
  const ql = q.toLowerCase();
  const kws = keywords(q);
  const nameQuery = looksLikeName(q);

  const [items, profile, taste] = await Promise.all([allItems(), getProfile(uid), getTaste(uid)]);
  const carded = items.filter((it) => it.card && !it.card.flags.some((f) => f === "spam-suspect" || f === "no-substance" || f === "star-farm-suspect"));

  /* ---- lexical lane ---- */
  const hits = new Map<string, Hit>();
  let exact: string | null = null;
  for (const it of carded) {
    const id = it.repo.id.toLowerCase();
    const name = it.repo.name.toLowerCase();
    let lex = 0;
    let match: SearchResult["match"] = "keyword";
    if (id === ql || name === ql) { lex = 10; match = "exact"; exact = exact ?? it.repo.id; }
    else if (nameQuery && (name.startsWith(ql) || id.includes(ql))) { lex = 6; match = "name"; }
    else if (name.includes(ql)) { lex = 4; match = "name"; }
    if (kws.length) {
      const c = it.card!;
      const tags = c.tags.map((t) => t.toLowerCase());
      const hay = `${c.pitch} ${c.whyCare} ${c.category} ${c.ecosystem.join(" ")} ${c.audience.join(" ")}`.toLowerCase();
      let k = 0;
      for (const w of kws) {
        if (tags.some((t) => t === w)) k += 2;
        else if (tags.some((t) => t.includes(w))) k += 1.2;
        else if (hay.includes(w)) k += 0.6;
      }
      // Fraction of keywords matched matters more than raw count for multi-word intents.
      const frac = k / (2 * kws.length);
      if (frac > 0) { lex = Math.max(lex, 3 * frac); if (match === "keyword" && lex < 3) match = "keyword"; }
    }
    if (lex > 0) hits.set(it.repo.id, { it, lex, sem: 0, match });
  }

  /* ---- semantic lane ---- */
  let semantic = false;
  if (!nameQuery || q.includes(" ")) {
    try {
      const [qv] = await embedTexts([q], "query");
      const vectors = await getEmbeddings(carded.map((it) => it.repo.id));
      if (vectors.size > 0) {
        semantic = true;
        const scored: { it: Item; cos: number }[] = [];
        for (const it of carded) {
          const v = vectors.get(it.repo.id);
          if (v) scored.push({ it, cos: dot(qv, v) });
        }
        scored.sort((a, b) => b.cos - a.cos);
        // Take the top band; below the 40th result or a cosine gap of 0.12 from the best, it's noise.
        const best = scored[0]?.cos ?? 0;
        for (const s of scored.slice(0, 40)) {
          if (s.cos < best - 0.12) break;
          const h = hits.get(s.it.repo.id);
          if (h) h.sem = s.cos;
          else hits.set(s.it.repo.id, { it: s.it, lex: 0, sem: s.cos, match: "semantic" });
        }
      }
    } catch (e) {
      console.warn("[search] semantic lane skipped:", (e as Error).message);
    }
  }
  if (!hits.size) return { q, results: [], semantic, exact: null };

  /* ---- merge + personal ranking ---- */
  const ids = Array.from(hits.keys());
  const tasteVectors = taste && taste.w > 0 ? await getEmbeddings(ids) : undefined;
  const bestSem = Math.max(...Array.from(hits.values()).map((h) => h.sem), 0.0001);
  const ranked = Array.from(hits.values()).map((h) => {
    // Relevance in [0,1]: semantic relative to the best hit; lexical saturates at 1 for an exact.
    const rel = Math.max(h.sem / bestSem, Math.min(1, h.lex / 6));
    const b = baseScore(h.it);
    const f = fitScore(h.it, profile);
    const t = tasteFit(tasteVectors?.get(h.it.repo.id), taste);
    const fit = taste && taste.w > 0 ? 0.4 * f.fit + 0.6 * t : f.fit;
    // Relevance dominates; quality and fit break ties and reorder near-equals.
    const score = rel * rel * Math.pow(b.score, 0.35) * (1 + 0.5 * fit);
    // Which lane carried it: an exact/name hit, a strong keyword hit, or the embedding.
    const semLed = h.sem > 0 && h.sem / bestSem > Math.min(1, h.lex / 6);
    const match: SearchResult["match"] = h.match === "exact" || h.match === "name" ? h.match : semLed ? "semantic" : "keyword";
    const why: string[] = [];
    if (match === "exact") why.push("exact match");
    else if (match === "name") why.push("name matches");
    else if (match === "semantic") why.push("close to what you described");
    else why.push(`matches "${kws.slice(0, 2).join(" ")}"`);
    if (f.matched.length) why.push(`matches your interest in ${Array.from(new Set(f.matched)).slice(0, 2).join(", ")}`);
    else if (t > 0.35) why.push("close to things you liked");
    why.push(...b.why.filter((w) => !/^broadly/.test(w)).slice(0, 1));
    return { h, match, score, fit, why: why.slice(0, 3) };
  });
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, limit);
  const saved = await isSaved(uid, top.map((r) => r.h.it.repo.id));

  return {
    q,
    semantic,
    exact,
    results: top.map((r) => ({
      id: r.h.it.repo.id,
      score: Math.round(r.score * 100) / 100,
      fit: Math.round(r.fit * 100) / 100,
      why: r.why,
      explore: false,
      saved: saved.has(r.h.it.repo.id),
      item: r.h.it,
      match: r.match,
    })),
  };
}
