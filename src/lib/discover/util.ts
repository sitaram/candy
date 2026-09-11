const REPO_RE = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/#?)\]"'\s]|$)/g;
const NOT_OWNERS = new Set([
  "topics", "orgs", "features", "marketplace", "sponsors", "about", "pricing", "login", "join",
  "settings", "notifications", "explore", "trending", "collections", "events", "site", "security",
  "enterprise", "customer-stories", "readme", "issues", "pulls", "search", "new", "apps", "blog",
]);

/** Extract all owner/repo ids from a text blob (README, HTML, feed body). */
export function reposInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REPO_RE)) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, "");
    if (NOT_OWNERS.has(owner.toLowerCase())) continue;
    if (repo.toLowerCase() === "github.io") continue;
    out.add(`${owner}/${repo}`);
  }
  return Array.from(out);
}

export function repoFromUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const r = reposInText(u + " ");
  return r[0] ?? null;
}

export const UA = { "User-Agent": "candy-ingest/0.1 (+https://github.com/sitaram/candy)" };

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export async function getJson<T>(url: string, headers: HeadersInit = {}): Promise<T> {
  const res = await fetch(url, { headers: { ...UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

export async function getText(url: string, headers: HeadersInit = {}): Promise<string> {
  const res = await fetch(url, { headers: { ...UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
