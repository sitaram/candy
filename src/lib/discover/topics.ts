import type { Discovery } from "../store/types";
import { ghHeaders } from "./github";
import { getJson } from "./util";

interface GhRepo {
  full_name: string;
  stargazers_count: number;
}

/**
 * Tier 2 seed: every repo under a GitHub topic above a star floor. Two pages
 * per topic (200 repos) is enough for a seed; the crawl loop expands from there.
 */
export async function discoverTopics(topics: string[], minStars = 20, pages = 2): Promise<Discovery[]> {
  const out: Discovery[] = [];
  for (const topic of topics) {
    for (let page = 1; page <= pages; page++) {
      const url = new URL("https://api.github.com/search/repositories");
      url.searchParams.set("q", `topic:${topic} stars:>=${minStars}`);
      url.searchParams.set("sort", "stars");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      let items: GhRepo[] = [];
      try {
        items = (await getJson<{ items: GhRepo[] }>(url.toString(), ghHeaders())).items;
      } catch (e) {
        console.error(`  topic:${topic} p${page} failed: ${(e as Error).message}`);
        break;
      }
      for (const r of items) out.push({ repo: r.full_name, source: `topic:${topic}`, weight: 1 + Math.log10(1 + r.stargazers_count) });
      if (items.length < 100) break;
      await new Promise((res) => setTimeout(res, 2100)); // 30 search req/min authenticated
    }
  }
  return out;
}
