import Parser from "rss-parser";
import type { Discovery } from "../store/types";
import { reposInText } from "./util";

/** Newsletters and blogs that already did the filtering for you. */
export const FEEDS: Record<string, string> = {
  changelog: "https://changelog.com/feed",
  "changelog-news": "https://changelog.com/news/feed",
  tldr: "https://tldr.tech/api/rss/tech",
  console: "https://console.dev/rss.xml",
  "github-blog": "https://github.blog/feed/",
  "devto-opensource": "https://dev.to/feed/tag/opensource",
  "hn-show": "https://hnrss.org/show?points=10",
  "hn-best": "https://hnrss.org/best",
};

const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": "candy-ingest/0.1" },
  customFields: { item: ["content:encoded", "description"] },
});

export async function discoverRss(feeds = FEEDS): Promise<Discovery[]> {
  const results = await Promise.allSettled(
    Object.entries(feeds).map(async ([name, url]) => {
      const feed = await parser.parseURL(url);
      const out: Discovery[] = [];
      for (const it of feed.items) {
        const blob = [it.link, it.title, it.contentSnippet, it.content, (it as unknown as Record<string, unknown>)["content:encoded"]]
          .filter((s): s is string => typeof s === "string")
          .join("\n");
        const repos = reposInText(blob);
        for (const repo of repos) {
          out.push({
            repo,
            source: `rss:${name}`,
            weight: 2,
            evidence: {
              source: `rss:${name}`,
              title: it.title ?? "",
              url: it.link ?? url,
              ts: it.isoDate ?? new Date().toISOString(),
            },
          });
        }
      }
      return out;
    }),
  );
  const out: Discovery[] = [];
  results.forEach((r, i) => {
    const name = Object.keys(feeds)[i];
    if (r.status === "fulfilled") out.push(...r.value);
    else console.error(`  rss:${name} failed: ${(r.reason as Error).message}`);
  });
  return out;
}
