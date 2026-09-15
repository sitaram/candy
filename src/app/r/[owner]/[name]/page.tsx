import { getItemDetail, getItems } from "@/lib/corpus/api";
import { similar } from "@/lib/corpus/related";
import { ensureItem } from "@/lib/corpus/ensure";
import { collectionsOf } from "@/lib/store/collections";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function ago(iso: string): string {
  if (!iso) return "";
  const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return d < 1 ? "today" : d === 1 ? "1 day ago" : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
}

/** Deep-dive page: everything we know about one repo. The `ask` box comes later. */
export default async function RepoPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const id = `${owner}/${name}`;
  // Tier 3: fetch + enrich on demand if we have never seen this repo.
  const ens = await ensureItem(id);
  if (!ens.exists) notFound();
  const [d, sim, cols] = await Promise.all([getItemDetail(ens.id), similar(ens.id, 8), collectionsOf(ens.id)]);
  if (!d) notFound();
  const { repo: r, card: c } = d;
  const alts = d.edges.alt.length ? await getItems({ exclude: [], cardsOnly: false }, "stars", 500).then((all) => all.filter((x) => d.edges.alt.includes(x.repo.id))) : [];

  return (
    <main>
      <div className="meta"><a href="/">← candy</a> · <a href="/browse">browse</a></div>
      <h1>
        {c && <span className={`score s${c.interest}`}>{c.interest}</span>}
        <a href={r.url} target="_blank" rel="noreferrer">{r.id}</a>
      </h1>
      <div className="meta">
        {r.stars.toLocaleString()}★ · {Math.round(r.starsPerDay)}/day · {r.language} · {r.license || "no license"} · created {ago(r.createdAt)} · pushed {ago(r.pushedAt)}
        {r.latestRelease && <> · latest <b>{r.latestRelease}</b> {ago(r.latestReleaseAt)}</>}
        {cols.length > 0 && <> · in {cols.map((c) => <a key={c} href={`/?collection=${c}`}>{c}</a>)}</>}
        {ens.fetched && <> · <span className="tag hook">fetched just now</span></>}
      </div>

      {c && (
        <section>
          <p className="pitch">{c.pitch}</p>
          <p className="why">{c.whyCare}</p>
          <div className="tags">
            <span className="tag cat">{c.category}</span>
            {c.hook !== "none" && <span className="tag hook">{c.hook}</span>}
            <span className="tag">{c.maturity}</span>
            <span className="tag">{c.kind}</span>
            {c.flags.map((f) => <span key={f} className="tag flag">⚑ {f}</span>)}
            {c.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
          <h3>Voice script</h3>
          <p className="voice">{c.voice}</p>
          {c.audience.length > 0 && <p className="kv"><b>For:</b> {c.audience.join(", ")}</p>}
          {c.ecosystem.length > 0 && <p className="kv"><b>Ecosystem:</b> {c.ecosystem.join(", ")}</p>}
          {c.buildsOn.length > 0 && <p className="kv"><b>Builds on:</b> {c.buildsOn.join(", ")}</p>}
          {c.alternatives.length > 0 && (
            <p className="kv">
              <b>Alternatives:</b>{" "}
              {c.alternatives.map((a, i) => {
                const inCorpus = alts.find((x) => x.repo.id === a.toLowerCase());
                return (
                  <span key={a}>
                    {i > 0 && ", "}
                    {inCorpus ? <a href={`/r/${inCorpus.repo.id}`}>{a}</a> : a}
                  </span>
                );
              })}
            </p>
          )}
        </section>
      )}

      {sim.length > 0 && (
        <section>
          <h3>Similar in corpus</h3>
          {sim.map((s) => (
            <a key={s.item.repo.id} className="card small" href={`/r/${s.item.repo.id}`}>
              <div className="row">
                <span className="title">{s.item.repo.id}</span>
                <span className="stars">{s.why.join(" · ")}</span>
              </div>
              <div className="desc">{s.item.card?.pitch}</div>
            </a>
          ))}
        </section>
      )}

      {d.releases.length > 0 && (
        <section>
          <h3>Releases</h3>
          {d.releases.slice(0, 5).map((rel) => (
            <details key={rel.tag_name} className="rel">
              <summary><b>{rel.tag_name}</b> {rel.name && rel.name !== rel.tag_name ? `— ${rel.name}` : ""} <span className="stars">{ago(rel.published_at)}</span></summary>
              <pre>{(rel.body ?? "").slice(0, 3000)}</pre>
            </details>
          ))}
        </section>
      )}

      {d.mentions.length > 0 && (
        <section>
          <h3>Mentions</h3>
          {d.mentions.map((m, i) => (
            <div key={i} className="kv">
              <span className="tag src">{m.source}</span> <a href={m.url} target="_blank" rel="noreferrer">{m.title}</a>
              {m.points != null && <span className="stars"> · {m.points} pts, {m.comments ?? 0} comments</span>}
            </div>
          ))}
        </section>
      )}

      {(d.edges.links.length > 0 || d.edges.awesomeSiblings.length > 0) && (
        <section>
          <h3>Graph</h3>
          {d.edges.links.length > 0 && <p className="kv"><b>Links to ({d.edges.links.length}):</b> {d.edges.links.slice(0, 20).join(", ")}</p>}
          {d.awesome.length > 0 && <p className="kv"><b>In awesome lists:</b> {d.awesome.join(", ")}</p>}
          {d.edges.awesomeSiblings.length > 0 && <p className="kv"><b>Siblings in corpus ({d.edges.awesomeSiblings.length}):</b> {d.edges.awesomeSiblings.slice(0, 20).map((s, i) => <span key={s}>{i > 0 && ", "}<a href={`/r/${s}`}>{s}</a></span>)}</p>}
        </section>
      )}

      <details>
        <summary>README ({d.readme.length.toLocaleString()} chars)</summary>
        <pre className="readme">{d.readme}</pre>
      </details>
    </main>
  );
}
