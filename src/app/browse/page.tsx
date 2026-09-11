import { categories, getItems, type Item, type Sort } from "@/lib/corpus/api";
import type { Category } from "@/lib/enrich/card";
import { listCollections } from "@/lib/store/collections";
import { stats } from "@/lib/store/corpus";

export const dynamic = "force-dynamic";

const SORTS: Sort[] = ["interest", "velocity", "released", "created", "stars"];

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

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const sort = (SORTS.includes(sp.sort as Sort) ? sp.sort : "interest") as Sort;
  const cat = sp.category as Category | undefined;
  const flagged = sp.flagged === "1";
  const collection = sp.collection;

  const [items, cats, st, cols] = await Promise.all([
    getItems({ category: cat, collection, excludeFlags: flagged ? [] : undefined, cardsOnly: !flagged }, sort, 200),
    categories(),
    stats(),
    listCollections(),
  ]);
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ sort, category: cat, collection, flagged: flagged ? "1" : undefined, ...over })) if (v) p.set(k, v);
    return `/?${p}`;
  };

  return (
    <main>
      <h1>candy <small style={{ fontWeight: 400, opacity: .6 }}>/ browse</small></h1>
      <div className="meta">
        <a href="/">← feed</a>
        {" · "}
        corpus {st.corpus} · frontier {st.frontier} · showing {items.length}
        {" · "}
        <a href={q({ flagged: flagged ? undefined : "1" })}>{flagged ? "hide flagged" : "show flagged/uncarded"}</a>
        {" · "}
        <a href="/api/items?limit=5">api</a>
      </div>
      <nav className="tabs">
        {SORTS.map((x) => (
          <a key={x} href={q({ sort: x })} className={x === sort ? "on" : ""}>{x}</a>
        ))}
      </nav>
      {cols.length > 0 && (
        <nav className="tabs wrap">
          <a href={q({ collection: undefined })} className={!collection ? "on" : ""}>everything</a>
          {cols.map((c) => (
            <a key={c.name} href={q({ collection: c.name })} className={c.name === collection ? "on" : ""} title={c.description}>
              {c.name} <span className="n">{c.count}</span>
            </a>
          ))}
        </nav>
      )}
      <nav className="tabs wrap">
        <a href={q({ category: undefined })} className={!cat ? "on" : ""}>all</a>
        {cats.map((c) => (
          <a key={c.category} href={q({ category: c.category })} className={c.category === cat ? "on" : ""}>
            {c.category} <span className="n">{c.count}</span>
          </a>
        ))}
      </nav>
      {items.map((it: Item) => {
        const c = it.card;
        const r = it.repo;
        return (
          <a key={r.id} className={`card${c?.flags.length ? " flagged" : ""}`} href={`/r/${r.id}`}>
            <div className="row">
              <span className="title">
                {c && <span className={`score s${c.interest}`}>{c.interest}</span>}
                {r.id}
              </span>
              <span className="stars">
                {fmt(r.stars)}
                {r.starsPerDay >= 1 && ` · ${Math.round(r.starsPerDay)}/d`}
              </span>
            </div>
            {c ? (
              <>
                <div className="pitch">{c.pitch}</div>
                <div className="why">{c.whyCare}</div>
              </>
            ) : (
              r.description && <div className="desc">{r.description}</div>
            )}
            <div className="tags">
              {c && <span className="tag cat">{c.category}</span>}
              {c && c.hook !== "none" && <span className="tag hook">{c.hook}</span>}
              {c && <span className="tag">{c.maturity}</span>}
              {c?.flags.map((f) => <span key={f} className="tag flag">⚑ {f}</span>)}
              {it.sources.map((s) => <span key={s} className="tag src">{s}</span>)}
              {r.language && <span className="tag">{r.language}</span>}
              {r.latestRelease && <span className="tag">{r.latestRelease} · {ago(r.latestReleaseAt)}</span>}
              {c?.tags.slice(0, 5).map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          </a>
        );
      })}
    </main>
  );
}
