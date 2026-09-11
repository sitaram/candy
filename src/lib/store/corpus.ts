import { redis } from "./redis";
import { K, normId, type EdgeType } from "./keys";
import { boundReleases, encodeRaw, MAX_README } from "./raw";
import { parseRepo, serializeRepo, type Discovery, type Mention, type Repo } from "./types";

/** Record discoveries: bump frontier priority, log mention, note source. */
export async function discover(hits: Discovery[]): Promise<number> {
  if (!hits.length) return 0;
  const r = redis();
  const p = r.pipeline();
  const now = Date.now();
  const seen = new Set<string>();
  // One priority bump per (repo, source) per run: a feed that links the same
  // repo in every item should not dominate the frontier.
  const bumped = new Set<string>();
  for (const h of hits) {
    const id = normId(h.repo);
    if (!/^[\w.-]+\/[\w.-]+$/.test(id)) continue;
    seen.add(id);
    const bk = `${id}|${h.source}`;
    if (!bumped.has(bk)) {
      bumped.add(bk);
      p.zincrby(K.frontier, h.weight, id);
    }
    p.zadd(K.discovered, "NX", now, id);
    p.sadd(K.tags(id), `src:${h.source.split(":")[0]}`);
    if (h.evidence) p.rpush(K.mentions(id), JSON.stringify(h.evidence));
  }
  await p.exec();
  return seen.size;
}

/** Pop the top-N frontier repos that have not been fetched (or are stale). */
export async function nextToCrawl(n: number, staleMs = 7 * 86_400_000): Promise<string[]> {
  const r = redis();
  const candidates = await r.zrevrange(K.frontier, 0, n * 4 - 1);
  if (!candidates.length) return [];
  const fetchedAt = await r.zmscore(K.fetched, ...candidates);
  const cutoff = Date.now() - staleMs;
  const out: string[] = [];
  candidates.forEach((id, i) => {
    const t = fetchedAt[i];
    if (t == null || Number(t) < cutoff) out.push(id);
  });
  return out.slice(0, n);
}

export async function saveRepo(
  repo: Partial<Repo> & { id: string },
  raw: { readme?: string; manifest?: string; releases?: string },
): Promise<void> {
  const r = redis();
  const p = r.pipeline();
  const id = normId(repo.id);
  const now = Date.now();
  p.hset(K.repo(id), serializeRepo({ ...repo, id, fetchedAt: new Date(now).toISOString() }));
  p.sadd(K.corpus, id);
  p.zadd(K.fetched, now, id);
  if (repo.stars != null) {
    p.zadd(K.stars(id), now, repo.stars);
    // Fold repo size into priority once known: log-scaled so a 100k★ repo
    // gets +17 and a 30★ repo +5. Tiny repos (<10★) get a penalty.
    p.zincrby(K.frontier, repo.stars < 10 ? -3 : Math.log2(1 + repo.stars), id);
  }
  if (raw.readme != null) p.set(K.raw(id, "readme"), encodeRaw(raw.readme.slice(0, MAX_README)));
  if (raw.manifest != null) p.set(K.raw(id, "manifest"), encodeRaw(raw.manifest.slice(0, 20_000)));
  if (raw.releases != null) {
    let rel = raw.releases;
    try {
      rel = JSON.stringify(boundReleases(JSON.parse(raw.releases) as { body: string | null }[]));
    } catch {
      /* store as-is */
    }
    p.set(K.raw(id, "releases"), encodeRaw(rel));
  }
  if (repo.language) p.sadd(K.tags(id), `lang:${repo.language.toLowerCase()}`);
  for (const t of repo.topics ?? []) p.sadd(K.tags(id), `topic:${t}`);
  await p.exec();
}

export async function markUnfetchable(id: string): Promise<void> {
  const r = redis();
  // Park it far in the future so it is not retried for 30 days, but keep it out of corpus.
  await r.zadd(K.fetched, Date.now() + 23 * 86_400_000, normId(id));
}

export async function addEdges(from: string, type: EdgeType, to: string[]): Promise<void> {
  const ids = to.map(normId).filter((t) => t !== normId(from));
  if (!ids.length) return;
  await redis().sadd(K.edges(normId(from), type), ...ids);
}

export async function addAwesome(list: string, repos: string[]): Promise<void> {
  const r = redis();
  const p = r.pipeline();
  const ids = repos.map(normId);
  p.sadd(K.awesome(list), ...ids);
  for (const id of ids) p.sadd(K.tags(id), `awesome:${list}`);
  await p.exec();
}

export async function getRepo(id: string): Promise<Repo | null> {
  return parseRepo(await redis().hgetall(K.repo(normId(id))));
}

export async function getRepos(ids: string[]): Promise<Repo[]> {
  if (!ids.length) return [];
  const r = redis();
  const p = r.pipeline();
  for (const id of ids) p.hgetall(K.repo(normId(id)));
  const res = await p.exec();
  const out: Repo[] = [];
  for (const [, h] of res ?? []) {
    const repo = parseRepo((h ?? {}) as Record<string, string>);
    if (repo) out.push(repo);
  }
  return out;
}

export async function getMentions(id: string): Promise<Mention[]> {
  const rows = await redis().lrange(K.mentions(normId(id)), 0, -1);
  return rows.map((s) => JSON.parse(s) as Mention);
}

export async function getTags(id: string): Promise<string[]> {
  return redis().smembers(K.tags(normId(id)));
}

export async function getEdges(id: string, type: EdgeType): Promise<string[]> {
  return redis().smembers(K.edges(normId(id), type));
}

export async function corpusIds(): Promise<string[]> {
  return redis().smembers(K.corpus);
}

export async function stats(): Promise<Record<string, number>> {
  const r = redis();
  const [frontier, corpus, discovered, fetched] = await Promise.all([
    r.zcard(K.frontier),
    r.scard(K.corpus),
    r.zcard(K.discovered),
    r.zcard(K.fetched),
  ]);
  return { frontier, corpus, discovered, fetched };
}
