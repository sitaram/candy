/** A discovery hit: some source saw this repo. */
export interface Discovery {
  repo: string; // owner/name
  source: string; // github:new | hn | lobsters | rss:changelog | awesome:sindresorhus/awesome | readme-link
  weight: number; // contribution to frontier priority
  evidence?: Mention;
}

/** Where a repo was talked about. Stored on mentions:{id}. */
export interface Mention {
  source: string;
  title: string;
  url: string;
  ts: string;
  points?: number;
  comments?: number;
}

/** Typed repo record. All values stored as strings in the hash; parse on read. */
export interface Repo {
  id: string;
  owner: string;
  name: string;
  url: string;
  description: string;
  homepage: string;
  language: string;
  topics: string[]; // JSON
  license: string;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  createdAt: string;
  pushedAt: string;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  sizeKb: number;
  // derived by extract
  readmeLen: number;
  readmeHash: string;
  manifestKind: string; // npm | pypi | cargo | go | none
  depCount: number;
  releaseCount: number;
  latestRelease: string; // tag
  latestReleaseAt: string;
  starsPerDay: number; // stars / age in days
  // bookkeeping
  fetchedAt: string;
  sources: string[]; // JSON, discovery sources seen
  mentionCount: number;
}

export function parseRepo(h: Record<string, string>): Repo | null {
  if (!h.id) return null;
  const j = <T>(s: string | undefined, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  const n = (s: string | undefined) => Number(s ?? 0) || 0;
  return {
    id: h.id,
    owner: h.owner ?? "",
    name: h.name ?? "",
    url: h.url ?? `https://github.com/${h.id}`,
    description: h.description ?? "",
    homepage: h.homepage ?? "",
    language: h.language ?? "",
    topics: j<string[]>(h.topics, []),
    license: h.license ?? "",
    stars: n(h.stars),
    forks: n(h.forks),
    openIssues: n(h.openIssues),
    watchers: n(h.watchers),
    createdAt: h.createdAt ?? "",
    pushedAt: h.pushedAt ?? "",
    archived: h.archived === "true",
    fork: h.fork === "true",
    defaultBranch: h.defaultBranch ?? "main",
    sizeKb: n(h.sizeKb),
    readmeLen: n(h.readmeLen),
    readmeHash: h.readmeHash ?? "",
    manifestKind: h.manifestKind ?? "none",
    depCount: n(h.depCount),
    releaseCount: n(h.releaseCount),
    latestRelease: h.latestRelease ?? "",
    latestReleaseAt: h.latestReleaseAt ?? "",
    starsPerDay: Number(h.starsPerDay ?? 0) || 0,
    fetchedAt: h.fetchedAt ?? "",
    sources: j<string[]>(h.sources, []),
    mentionCount: n(h.mentionCount),
  };
}

export function serializeRepo(r: Partial<Repo>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
  }
  return out;
}
