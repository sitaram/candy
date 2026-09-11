import { getItems } from "@/lib/corpus/api";
import { me } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const m = await me(await getUid());
  const saved = m.saved.length ? (await getItems({ cardsOnly: false, excludeFlags: [] }, "stars", 2000)).filter((it) => m.saved.includes(it.repo.id)) : [];
  const order = new Map(m.saved.map((id, i) => [id, i]));
  saved.sort((a, b) => (order.get(a.repo.id) ?? 0) - (order.get(b.repo.id) ?? 0));

  return (
    <main>
      <div className="meta"><a href="/">← feed</a> · <a href="/browse">browse</a></div>
      <h1>you</h1>
      <div className="meta">
        {m.reactions} reactions · {m.counts.like} liked · {m.counts.save} saved · {m.counts.dive} dives · {m.counts.skip} skipped · {m.seen} seen
      </div>

      <h3>Interests (learned)</h3>
      {m.topTerms.length === 0 ? (
        <p className="kv">Nothing yet. React in the <a href="/">feed</a>.</p>
      ) : (
        <div className="tags">
          {m.topTerms.map((t) => (
            <span key={t.term} className="tag" style={{ opacity: 0.45 + Math.min(0.55, t.w / (m.topTerms[0].w || 1)) }}>
              {t.term.replace(/^(cat|lang):/, "")} <span className="n">{t.w.toFixed(1)}</span>
            </span>
          ))}
        </div>
      )}
      {m.avoidTerms.length > 0 && (
        <>
          <h3>Less of</h3>
          <div className="tags">
            {m.avoidTerms.map((t) => <span key={t.term} className="tag flag">{t.term.replace(/^(cat|lang):/, "")}</span>)}
          </div>
        </>
      )}

      <h3>Saved ({saved.length})</h3>
      {saved.map((it) => (
        <a key={it.repo.id} className="card small" href={`/r/${it.repo.id}`}>
          <div className="row">
            <span className="title">{it.repo.id}</span>
            <span className="stars">{it.repo.latestRelease && `${it.repo.latestRelease}`}</span>
          </div>
          <div className="desc">{it.card?.pitch ?? it.repo.description}</div>
        </a>
      ))}
    </main>
  );
}
