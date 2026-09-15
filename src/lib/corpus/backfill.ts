/**
 * Tail on demand. The head of the corpus is crawled up front; the tail fills in behind the first
 * person who looks. Opening a deep dive *enqueues* (one RPUSH) the repo; the client, once it has the
 * JSON, fires a keepalive beacon at /api/backfill which pops one job and does the slow part: fetch,
 * card, embed, invalidate labels. The detail response never waits — not even for the socket to
 * close, which is what `after()` turned out to cost in dev (6–9 s). Each repo runs once a week.
 *
 * Cost: one Claude card per new repo (~$0.007); bounded by the number of distinct deep dives.
 */
import { redis } from "../store/redis";
import { getItem, allItems } from "./api";
import { ensureItem } from "./ensure";
import { ghHeaders } from "../discover/github";
import { getJson } from "../discover/util";
import { cardText, embedTexts, putEmbeddings } from "../embed";

const BF = (id: string) => `bf:${id}`;
const RESOLVE = (name: string) => `bfname:${name}`;   // name → owner/repo or "-" (unresolvable), 30 d
/** Hosted products and platforms our cards name as alternatives; never GitHub repos. */
const SKIP = /^(elevenlabs|synthesia|descript|otter\.ai|assemblyai|deepgram|google[- ]cloud.*|azure.*|aws.*|amazon.*|openai.*|chatgpt|claude.*|gemini.*|copilot|github copilot.*|lm[- ]studio|cursor|windsurf|replit|vercel|netlify|supabase|firebase|notion|slack|discord|zoom|figma|jira|linear|datadog|sentry|stripe|twilio|snowflake|databricks|hugging ?face|colab|kaggle|anthropic.*)$/i;

interface GhRepo { full_name: string; stargazers_count: number; archived: boolean; fork: boolean }

/** Bare name → owner/repo via GitHub search. Cached either way so a miss costs one call, ever. */
export async function resolveName(name: string): Promise<string | null> {
  if (name.includes("/")) return name;
  const r = redis();
  const cached = await r.get(RESOLVE(name));
  if (cached) return cached === "-" ? null : cached;
  let hit: string | null = null;
  try {
    const q = `${name.replace(/[^a-z0-9._ -]/g, " ")} in:name`;
    const body = await getJson<{ items: GhRepo[] }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=5`, ghHeaders());
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const m = body.items.find((x) => !x.fork && !x.archived && x.stargazers_count >= 50 && norm(x.full_name.split("/")[1]).includes(norm(name).slice(0, 12)));
    hit = m ? m.full_name.toLowerCase() : null;
  } catch { /* rate limit or network: leave uncached, try again next time */ return null; }
  await r.set(RESOLVE(name), hit ?? "-", "EX", 30 * 86_400);
  return hit;
}

/** Alternatives named on `id`'s card that are not carded yet, as resolved ids where possible. */
export async function missingAlternatives(id: string): Promise<{ missing: string[]; unresolved: string[] }> {
  const me = await getItem(id);
  if (!me?.card?.alternatives.length) return { missing: [], unresolved: [] };
  const all = await allItems();
  const ids = new Set(all.map((i) => i.repo.id));
  const names = new Set(all.filter((i) => i.card).map((i) => i.repo.name.toLowerCase()));
  const missing: string[] = [], unresolved: string[] = [];
  for (const a of me.card.alternatives) {
    const al = a.toLowerCase().trim().replace(/^https?:\/\/github\.com\//, "");
    if (!al || SKIP.test(al) || ids.has(al) || names.has(al.split("/").pop()!)) continue;
    if (al.includes("/")) missing.push(al); else unresolved.push(al);
  }
  return { missing, unresolved };
}

/**
 * Run after the response. Resolves names, fetches + cards + embeds up to `max` repos, then clears
 * the repo's related-groups label so `relate` redoes it with the fuller neighbour set.
 */
const QUEUE = "bf:queue";

/** O(1): remember that this repo wants backfilling. Idempotent, once a week per repo. */
export async function enqueueBackfill(id: string): Promise<boolean> {
  const r = redis();
  if (!(await r.set(BF(id), "1", "EX", 7 * 86_400, "NX"))) return false;
  await r.rpush(QUEUE, id);
  return true;
}

/** Pop one job and run it. Called from /api/backfill by a client beacon or a cron. */
export async function drainOne(): Promise<{ id: string; added: string[] } | null> {
  const id = await redis().lpop(QUEUE);
  if (!id) return null;
  return { id, ...(await backfillAlternatives(id)) };
}

export async function backfillAlternatives(id: string, max = 4): Promise<{ added: string[] }> {
  const r = redis();
  const { missing, unresolved } = await missingAlternatives(id);
  const targets = [...missing];
  for (const n of unresolved) { if (targets.length >= max) break; const rid = await resolveName(n); if (rid) targets.push(rid); }
  const added: string[] = [];
  for (const t of targets.slice(0, max)) {
    try {
      const res = await ensureItem(t, { enrich: true });
      if (res.exists) added.push(res.id);
    } catch (e) { console.warn("[backfill]", t, (e as Error).message); }
  }
  if (added.length) {
    // Embed the newcomers so they can take part in neighbours() at once.
    try {
      const items = (await Promise.all(added.map((a) => getItem(a)))).filter((x): x is NonNullable<typeof x> => !!x?.card);
      if (items.length) { const vecs = await embedTexts(items.map(cardText)); await putEmbeddings(items.map((it, i) => ({ id: it.repo.id, v: vecs[i] }))); }
    } catch (e) { console.warn("[backfill] embed", (e as Error).message); }
    await r.del(`rel:${id}`);   // labels are stale now; fallback grouping shows until relate runs
    console.log(`[backfill] ${id}: +${added.length} ${added.join(", ")}`);
  }
  return { added };
}
