import type { Discovery } from "../store/types";
import { getJson, repoFromUrl } from "./util";

interface HnHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
}

/** HN stories linking to GitHub, last 72h, >3 points. Weight scales with points. */
export async function discoverHn(): Promise<Discovery[]> {
  const since = Math.floor((Date.now() - 3 * 86_400_000) / 1000);
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", "github.com");
  url.searchParams.set("tags", "story");
  url.searchParams.set("restrictSearchableAttributes", "url");
  url.searchParams.set("numericFilters", `created_at_i>${since},points>3`);
  url.searchParams.set("hitsPerPage", "200");
  const body = await getJson<{ hits: HnHit[] }>(url.toString());
  const out: Discovery[] = [];
  for (const h of body.hits) {
    const repo = repoFromUrl(h.url);
    if (!repo) continue;
    out.push({
      repo,
      source: "hn",
      // Social weight is capped; repo size is unknown at discovery time and is
      // folded in by the crawler once fetched.
      weight: Math.min(6, 1 + Math.log2(1 + h.points)),
      evidence: {
        source: "hn",
        title: h.title,
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        ts: h.created_at,
        points: h.points,
        comments: h.num_comments,
      },
    });
  }
  return out;
}

interface LobStory {
  short_id: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  created_at: string;
  comments_url: string;
  tags: string[];
}

/** Lobsters hottest + newest. Small, heavily curated community. */
export async function discoverLobsters(): Promise<Discovery[]> {
  const [hot, fresh] = await Promise.all([
    getJson<LobStory[]>("https://lobste.rs/hottest.json"),
    getJson<LobStory[]>("https://lobste.rs/newest.json"),
  ]);
  const seen = new Set<string>();
  const out: Discovery[] = [];
  for (const s of [...hot, ...fresh]) {
    if (seen.has(s.short_id)) continue;
    seen.add(s.short_id);
    const repo = repoFromUrl(s.url);
    if (!repo) continue;
    out.push({
      repo,
      source: "lobsters",
      weight: Math.min(6, 2 + Math.log2(1 + s.score)),
      evidence: {
        source: "lobsters",
        title: s.title,
        url: s.comments_url,
        ts: s.created_at,
        points: s.score,
        comments: s.comment_count,
      },
    });
  }
  return out;
}
