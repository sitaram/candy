import { getCards } from "@/lib/enrich";
import { corpusIds, getRepos, stats } from "@/lib/store/corpus";
import { K } from "@/lib/store/keys";
import { redis } from "@/lib/store/redis";
import type { Repo } from "@/lib/store/types";

export const dynamic = "force-dynamic";

type Sort = "interest" | "velocity" | "released" | "priority" | "stars";
const SORTS: Sort[] = ["interest", "velocity", "released", "priority", "stars"];

function fmt(n?: number): string {
  if (!n) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k★` : `${n}★`;
}

function ago(iso: string): string {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  if (h < 24) return `${Math.round(h)}h`;
  if (h < 24 * 30) return `${Math.round(h / 24)}d`;
  return `${Math.round(h / 24 / 30)}mo`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ sort?: string; cards?: string }> }) {
  const sp = await searchParams;
  const sort = (SORTS.includes(sp.sort as Sort) ? sp.sort : "interest") as Sort;
  const onlyCards = sp.cards !== "0";

  const ids = await corpusIds();
  const r = redis();
  const [repos, cards, prio, st] = await Promise.all([
    getRepos(ids),
    getCards(ids),
    r.zmscore(K.frontier, ...(ids.length ? ids : ["-"])),
    stats(),
  ]);
  const prioById = new Map(ids.map((id, i) => [id, Number(prio[i] ?? 0)]));
  const tagsRes = await r.pipeline(ids.map((id) => ["smembers", K.tags(id)])).exec();
  const srcById = new Map(
    ids.map((id, i) => [id, ((tagsRes?.[i]?.[1] as string[]) ?? []).filter((t) => t.startsWith("src:")).map((t) => t.slice(4))]),
  );

  const shown = onlyCards ? repos.filter((x) => cards.has(x.id)) : repos;
  const sorted = [...shown].sort((a, b) => {
    switch (sort) {
      case "interest":
        return (cards.get(b.id)?.interest ?? -1) - (cards.get(a.id)?.interest ?? -1) || b.starsPerDay - a.starsPerDay;
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

  return (
    <main>
      <h1>candy</h1>
      <div className="meta">
        corpus {st.corpus} · cards {cards.size} · frontier {st.frontier}
        {" · "}
        <a href={`/?sort=${sort}&cards=${onlyCards ? "0" : "1"}`}>{onlyCards ? "show uncarded" : "cards only"}</a>
      </div>
      <nav className="tabs">
        {SORTS.map((x) => (
          <a key={x} href={`/?sort=${x}&cards=${onlyCards ? "1" : "0"}`} className={x === sort ? "on" : ""}>
            {x}
          </a>
        ))}
      </nav>
      {sorted.map((it: Repo) => {
        const c = cards.get(it.id);
        return (
          <a key={it.id} className={`card${c?.flags.length ? " flagged" : ""}`} href={it.url} target="_blank" rel="noreferrer">
            <div className="row">
              <span className="title">
                {c && <span className={`score s${c.interest}`}>{c.interest}</span>}
                {it.id}
              </span>
              <span className="stars">
                {fmt(it.stars)}
                {it.starsPerDay >= 1 && ` · ${Math.round(it.starsPerDay)}/d`}
              </span>
            </div>
            {c ? (
              <>
                <div className="pitch">{c.pitch}</div>
                <div className="why">{c.whyCare}</div>
              </>
            ) : (
              it.description && <div className="desc">{it.description}</div>
            )}
            <div className="tags">
              {c && <span className="tag cat">{c.category}</span>}
              {c && c.hook !== "none" && <span className="tag hook">{c.hook}</span>}
              {c && <span className="tag">{c.maturity}</span>}
              {c?.flags.map((f) => (
                <span key={f} className="tag flag">⚑ {f}</span>
              ))}
              {(srcById.get(it.id) ?? []).map((s) => (
                <span key={s} className="tag src">{s}</span>
              ))}
              {it.language && <span className="tag">{it.language}</span>}
              {it.latestRelease && <span className="tag">{it.latestRelease} · {ago(it.latestReleaseAt)}</span>}
              {c?.tags.slice(0, 5).map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </div>
          </a>
        );
      })}
    </main>
  );
}
