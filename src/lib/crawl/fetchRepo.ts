import { ghHeaders } from "../discover/github";
import { UA } from "../discover/util";
import type { Repo } from "../store/types";

interface GhRepo {
  full_name: string;
  owner: { login: string };
  name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  license: { spdx_id: string } | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  subscribers_count: number;
  created_at: string;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  size: number;
}

interface GhRelease {
  tag_name: string;
  name: string | null;
  published_at: string;
  prerelease: boolean;
  body: string | null;
}

export class RateLimited extends Error {
  constructor(public resetAt: number) {
    super(`github rate limited until ${new Date(resetAt).toISOString()}`);
  }
}

async function gh<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, { headers: { ...UA, ...ghHeaders() }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404 || res.status === 451) return null; // gone / DMCA
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
    if (res.headers.get("x-ratelimit-remaining") === "0") throw new RateLimited(reset || Date.now() + 60_000);
  }
  if (!res.ok) throw new Error(`github ${res.status} ${path}`);
  return (await res.json()) as T;
}

/** Raw file via raw.githubusercontent.com: no API rate limit. */
async function rawFile(id: string, branch: string, file: string): Promise<string | null> {
  const res = await fetch(`https://raw.githubusercontent.com/${id}/${branch}/${file}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.text();
}

const README_NAMES = ["README.md", "readme.md", "README.MD", "Readme.md", "README.rst", "README", "README.txt"];
const MANIFESTS: [string, string][] = [
  ["package.json", "npm"],
  ["pyproject.toml", "pypi"],
  ["Cargo.toml", "cargo"],
  ["go.mod", "go"],
  ["requirements.txt", "pypi"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["Gemfile", "rubygems"],
  ["composer.json", "composer"],
];

export interface Fetched {
  repo: Partial<Repo> & { id: string };
  readme: string;
  manifest: string;
  manifestKind: string;
  releases: GhRelease[];
}

/** Full fetch of one repo: meta (1 API call), releases (1 API call), README + manifest (raw, free). */
export async function fetchRepo(id: string): Promise<Fetched | null> {
  const meta = await gh<GhRepo>(`/repos/${id}`);
  if (!meta) return null;
  const branch = meta.default_branch;
  const canonical = meta.full_name; // handles renames/redirects

  const [releases, readme, manifest] = await Promise.all([
    gh<GhRelease[]>(`/repos/${canonical}/releases?per_page=10`).then((r) => r ?? []),
    (async () => {
      for (const n of README_NAMES) {
        const t = await rawFile(canonical, branch, n);
        if (t != null) return t;
      }
      return "";
    })(),
    (async () => {
      for (const [file, kind] of MANIFESTS) {
        const t = await rawFile(canonical, branch, file);
        if (t != null) return { text: t, kind };
      }
      return { text: "", kind: "none" };
    })(),
  ]);

  const ageDays = Math.max(1, (Date.now() - Date.parse(meta.created_at)) / 86_400_000);
  const latest = releases.find((r) => !r.prerelease) ?? releases[0];

  return {
    repo: {
      id: canonical.toLowerCase(),
      owner: meta.owner.login,
      name: meta.name,
      url: meta.html_url,
      description: meta.description ?? "",
      homepage: meta.homepage ?? "",
      language: meta.language ?? "",
      topics: meta.topics ?? [],
      license: meta.license?.spdx_id ?? "",
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      openIssues: meta.open_issues_count,
      watchers: meta.subscribers_count,
      createdAt: meta.created_at,
      pushedAt: meta.pushed_at,
      archived: meta.archived,
      fork: meta.fork,
      defaultBranch: branch,
      sizeKb: meta.size,
      releaseCount: releases.length,
      latestRelease: latest?.tag_name ?? "",
      latestReleaseAt: latest?.published_at ?? "",
      starsPerDay: Math.round((meta.stargazers_count / ageDays) * 100) / 100,
    },
    readme,
    manifest: manifest.text,
    manifestKind: manifest.kind,
    releases,
  };
}
