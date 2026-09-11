import { corpusIds, getRepos, stats } from "@/lib/store/corpus";
import { K } from "@/lib/store/keys";
import { redis } from "@/lib/store/redis";
import type { Repo } from "@/lib/store/types";

export const dynamic = "force-dynamic";

type Sort = "priority" | "velocity" | "released" | "stars";

function fmt(n?: number): string {
  if (!n) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k★` : `${n}★`;
}

function ago(iso: string): string {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  if (h < 24) return `${Math.round(h)}h ago`;
  if (h < 24 * 30) return `${Math.round(h / 24)}d ago`;
  return `${Math.round(h / 24 / 30)}mo ago`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort: s } = await searchParams;
  const sort = (["priority", "velocity", "released", "stars"].includes(s ?? "") ? s : "priority") as Sort;

  const ids = await corpusIds();
  const [repos, prio, st] = await Promise.all([getRepos(ids), redis().zmscore(K.frontier, ...(ids.length ? ids : ["-"])), stats()]);
  const prioById = new Map(ids.map((id, i) => [id, Number(prio[i] ?? 0)]));
  const tagsRes = await redis().pipeline(ids.map((id) => ["smembers", K.tags(id)])).exec();
  const tagsById = new Map(ids.map((id, i) => [id, ((tagsRes?.[i]?.[1] as string[]) ?? []).filter((t) => t.startsWith("src:") || t.startsWith("awesome:"))]));

  const sorted = [...repos].sort((a, b) => {
    switch (sort) {
      case "velocity":
        return b.starsPerDay - a.starsPerDay;
      case "released":
        return (b.latestReleaseAt || "").localeCompare(a.latestReleaseAt || "");
      case "stars":
        return b.stars - a.stars;
      default:
        return (prioById.get(b.id) ?? 0) - (prioById.get(a.id) ?? 0);
    }
  });

  const sorts: Sort[] = ["priority", "velocity", "released", "stars"];

  return (
    <main>
      <h1>candy</h1>
      <div className="meta">
        corpus {st.corpus} · frontier {st.frontier} · discovered {st.discovered}
        {!st.corpus && " — run `pnpm discover` then `pnpm crawl`"}
      </div>
      <nav className="tabs">
        {sorts.map((x) => (
          <a key={x} href={`/?sort=${x}`} className={x === sort ? "on" : ""}>
            {x}
          </a>
        ))}
      </nav>
      {sorted.map((it: Repo) => (
        <a key={it.id} className="card" href={it.url} target="_blank" rel="noreferrer">
          <div className="row">
            <span className="title">{it.id}</span>
            <span className="stars">
              {fmt(it.stars)}
              {it.starsPerDay >= 1 && ` · ${Math.round(it.starsPerDay)}/day`}
            </span>
          </div>
          {it.description && <div className="desc">{it.description}</div>}
          <div className="tags">
            <span className="tag src">p {(prioById.get(it.id) ?? 0).toFixed(1)}</span>
            {(tagsById.get(it.id) ?? []).map((t) => (
              <span key={t} className="tag src">{t.replace("awesome:", "★ ").replace("src:", "")}</span>
            ))}
            {it.language && <span className="tag">{it.language}</span>}
            {it.license && <span className="tag">{it.license}</span>}
            {it.latestRelease && <span className="tag">{it.latestRelease} · {ago(it.latestReleaseAt)}</span>}
            {it.pushedAt && <span className="tag">pushed {ago(it.pushedAt)}</span>}
            {it.depCount > 0 && <span className="tag">{it.depCount} deps</span>}
            {it.topics.slice(0, 4).map((tp) => (
              <span key={tp} className="tag">{tp}</span>
            ))}
          </div>
        </a>
      ))}
    </main>
  );
}
