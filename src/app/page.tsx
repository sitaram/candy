import { loadPool } from "@/lib/pool";
import type { RawItem } from "@/lib/sources/types";

type Tab = "all" | "new" | "active" | "hn";

function inTab(it: RawItem, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "hn") return it.sources.includes("hn");
  return it.signals.github_kind === tab;
}

function fmt(n?: number): string {
  if (n == null) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k★` : `${n}★`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: t } = await searchParams;
  const tab = (["all", "new", "active", "hn"].includes(t ?? "") ? t : "all") as Tab;
  const pool = await loadPool();
  const items = pool.items.filter((it) => inTab(it, tab));
  const tabs: Tab[] = ["all", "new", "active", "hn"];

  return (
    <main>
      <h1>candy</h1>
      <div className="meta">
        {pool.count} items · generated {pool.generatedAt ? new Date(pool.generatedAt).toLocaleString() : "never — run `pnpm ingest`"}
      </div>
      <nav className="tabs">
        {tabs.map((x) => (
          <a key={x} href={`/?tab=${x}`} className={x === tab ? "on" : ""}>
            {x} ({pool.items.filter((it) => inTab(it, x)).length})
          </a>
        ))}
      </nav>
      {items.map((it) => (
        <a key={it.id} className="card" href={it.url} target="_blank" rel="noreferrer">
          <div className="row">
            <span className="title">{it.title}</span>
            <span className="stars">{fmt(it.stars)}</span>
          </div>
          {it.description && <div className="desc">{it.description}</div>}
          <div className="tags">
            {it.sources.map((s) => (
              <span key={s} className="tag src">{s}</span>
            ))}
            {it.language && <span className="tag">{it.language}</span>}
            {it.signals.hn_points != null && <span className="tag">HN {String(it.signals.hn_points)}pts</span>}
            {it.topics.slice(0, 5).map((tp) => (
              <span key={tp} className="tag">{tp}</span>
            ))}
          </div>
        </a>
      ))}
    </main>
  );
}
