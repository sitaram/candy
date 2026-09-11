import type { RawItem, Source } from "./types";

const API = "https://api.github.com";

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
}

interface GhSearch {
  items: GhRepo[];
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "candy-ingest",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function search(q: string, sort: "stars" | "updated", perPage = 30): Promise<GhRepo[]> {
  const url = new URL(`${API}/search/repositories`);
  url.searchParams.set("q", q);
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`github search ${res.status}: ${q}`);
  }
  const body = (await res.json()) as GhSearch;
  return body.items;
}

function toItem(r: GhRepo, kind: "new" | "active", ts: string): RawItem {
  return {
    id: r.full_name,
    url: r.html_url,
    title: r.full_name,
    description: r.description ?? "",
    stars: r.stargazers_count,
    language: r.language ?? undefined,
    topics: r.topics ?? [],
    ts,
    sources: ["github"],
    signals: { github_kind: kind, stars: r.stargazers_count },
  };
}

/**
 * Two queries, kept small to fit the unauthenticated limit (10 req/min):
 *  - new: created in the last 7 days, already has traction
 *  - active: established repos pushed in the last 2 days
 */
export const github: Source = {
  name: "github",
  async fetch() {
    const [fresh, active] = await Promise.all([
      search(`created:>${daysAgo(7)} stars:>30`, "stars", 50),
      search(`pushed:>${daysAgo(2)} stars:>2000`, "updated", 50),
    ]);
    return [
      ...fresh.map((r) => toItem(r, "new", r.created_at)),
      ...active.map((r) => toItem(r, "active", r.pushed_at)),
    ];
  },
};
