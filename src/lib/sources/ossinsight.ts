import type { RawItem, Source } from "./types";

/**
 * OSS Insight public API: trending repos derived from GH Archive events.
 * https://ossinsight.io/docs/api
 */
const URL_ = "https://api.ossinsight.io/v1/trends/repos/";

interface Row {
  repo_id: string;
  repo_name: string;
  primary_language: string | null;
  description: string | null;
  stars: string;
  forks: string;
  pull_requests: string;
  pushes: string;
  total_score: string;
  contributor_logins: string | null;
  collection_names: string | null;
}

interface Resp {
  data: { rows: Row[] };
}

export const ossinsight: Source = {
  name: "ossinsight",
  async fetch() {
    const url = new URL(URL_);
    url.searchParams.set("period", "past_24_hours");
    const res = await fetch(url, { headers: { "User-Agent": "candy-ingest" } });
    if (!res.ok) throw new Error(`ossinsight ${res.status}`);
    const body = (await res.json()) as Resp;
    const now = new Date().toISOString();
    return body.data.rows.map<RawItem>((r) => ({
      id: r.repo_name,
      url: `https://github.com/${r.repo_name}`,
      title: r.repo_name,
      description: r.description ?? "",
      stars: Number(r.stars) || undefined,
      language: r.primary_language ?? undefined,
      topics: r.collection_names ? r.collection_names.split(",").map((s) => s.trim()) : [],
      ts: now,
      sources: ["ossinsight"],
      signals: {
        trend_score: Number(r.total_score) || 0,
        pushes_24h: Number(r.pushes) || 0,
        prs_24h: Number(r.pull_requests) || 0,
      },
    }));
  },
};
