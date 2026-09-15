import { env } from "../env";
import type { Discovery } from "../store/types";
import { daysAgo, getJson } from "./util";

interface GhRepo {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  created_at: string;
  pushed_at: string;
}

export function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

async function search(q: string, sort: "stars" | "updated", perPage: number): Promise<GhRepo[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", q);
  url.searchParams.set("sort", sort);
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(perPage));
  const body = await getJson<{ items: GhRepo[] }>(url.toString(), ghHeaders());
  return body.items;
}

/** New-with-traction and recently-active. Weight new higher: it is the scarcer signal. */
export async function discoverGithub(): Promise<Discovery[]> {
  const [fresh, active] = await Promise.all([
    search(`created:>${daysAgo(7)} stars:>30`, "stars", 100),
    search(`pushed:>${daysAgo(2)} stars:>2000`, "updated", 100),
  ]);
  const out: Discovery[] = [];
  for (const r of fresh) out.push({ repo: r.full_name, source: "github:new", weight: 3 });
  for (const r of active) out.push({ repo: r.full_name, source: "github:active", weight: 1 });
  return out;
}
