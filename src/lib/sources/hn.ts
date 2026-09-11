import type { RawItem, Source } from "./types";

/**
 * Hacker News via Algolia. Stories from the last 24h that link to GitHub.
 * Items are keyed by repo so they merge with GitHub/OSS Insight rows.
 */
const API = "https://hn.algolia.com/api/v1/search_by_date";

interface Hit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
}

interface Resp {
  hits: Hit[];
}

const REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i;

export function repoFromUrl(u: string | null): string | null {
  if (!u) return null;
  const m = REPO_RE.exec(u);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, "");
  if (["topics", "orgs", "features", "marketplace", "sponsors"].includes(owner)) return null;
  return `${owner}/${repo}`;
}

export const hn: Source = {
  name: "hn",
  async fetch() {
    const since = Math.floor((Date.now() - 86_400_000) / 1000);
    const url = new URL(API);
    url.searchParams.set("query", "github.com");
    url.searchParams.set("tags", "story");
    url.searchParams.set("restrictSearchableAttributes", "url");
    url.searchParams.set("numericFilters", `created_at_i>${since},points>5`);
    url.searchParams.set("hitsPerPage", "100");
    const res = await fetch(url, { headers: { "User-Agent": "candy-ingest" } });
    if (!res.ok) throw new Error(`hn ${res.status}`);
    const body = (await res.json()) as Resp;
    const out: RawItem[] = [];
    for (const h of body.hits) {
      const repo = repoFromUrl(h.url);
      if (!repo) continue;
      out.push({
        id: repo,
        url: `https://github.com/${repo}`,
        title: repo,
        description: h.title,
        topics: [],
        ts: h.created_at,
        sources: ["hn"],
        signals: {
          hn_points: h.points,
          hn_comments: h.num_comments,
          hn_id: h.objectID,
        },
      });
    }
    return out;
  },
};
