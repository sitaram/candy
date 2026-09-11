import { getItems, type Item } from "@/lib/corpus/api";
import { me } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";
import { ResetButton } from "./ResetButton";
import "./me.css";

export const dynamic = "force-dynamic";

const ago = (t: number) => {
  if (!t) return "";
  const d = (Date.now() - t) / 864e5;
  return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? `${Math.floor(d)}d ago` : `${Math.floor(d / 30)}mo ago`;
};
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export default async function MePage() {
  const m = await me(await getUid());
  const want = new Set([...m.saved, ...m.liked.map((x) => x.id), ...m.skipped.map((x) => x.id), ...m.dived.map((x) => x.id)]);
  const all = want.size ? await getItems({ cardsOnly: false, excludeFlags: [] }, "stars", 3000) : [];
  const by = new Map(all.filter((it) => want.has(it.repo.id)).map((it) => [it.repo.id, it]));
  const pick = (xs: { id: string; at: number }[]) => xs.map((x) => ({ ...x, it: by.get(x.id) })).filter((x) => x.it) as { id: string; at: number; it: Item }[];
  const liked = pick(m.liked), skipped = pick(m.skipped), dived = pick(m.dived);
  const saved = m.saved.map((id) => by.get(id)).filter(Boolean) as Item[];
  const decided = m.liked.length + m.skipped.length;
  const likeRate = decided ? Math.round((100 * m.liked.length) / decided) : 0;
  const days = m.firstSeen ? Math.max(1, Math.ceil((Date.now() - m.firstSeen) / 864e5)) : 0;
  const clean = (t: string) => t.replace(/^(cat|lang):/, "");
  const conf = Math.min(1, m.tasteWeight / 6);

  return (
    <main className="me">
      <nav className="me-nav"><a href="/">← feed</a><span>you</span><a href="/about">how it works</a></nav>

      <section className="me-hero">
        <div className="me-big">{m.seen}<small>cards</small></div>
        <div className="me-stats">
          <div><b className="lk">{m.liked.length}</b><span>liked</span></div>
          <div><b className="pk">{m.skipped.length}</b><span>passed</span></div>
          <div><b>{saved.length}</b><span>saved</span></div>
          <div><b>{dived.length}</b><span>deep dives</span></div>
        </div>
        <p className="me-sub">
          {decided === 0
            ? "Nothing learned yet. Swipe right on what you like and left on what you don’t — the feed starts bending toward you after a handful."
            : <>You like <b>{likeRate}%</b> of what you decide on{days ? <> over <b>{days}</b> {days === 1 ? "day" : "days"}</> : null}. Taste model is <b>{Math.round(conf * 100)}%</b> confident{conf < 1 ? " — a few more swipes and it takes over from tags" : " and carrying 60% of your fit score"}.</>}
        </p>
      </section>

      <section>
        <header className="me-h"><h2>What it thinks you like</h2><ResetButton n={decided + dived.length} /></header>
        {m.topTerms.length === 0 ? <p className="me-empty">Nothing yet.</p> : (
          <div className="me-tags">
            {m.topTerms.map((t) => (
              <span key={t.term} className="me-tag" style={{ "--w": Math.max(0.35, t.w / (m.topTerms[0].w || 1)) } as React.CSSProperties}>
                {clean(t.term)}<i>{t.w.toFixed(1)}</i>
              </span>
            ))}
          </div>
        )}
        {m.avoidTerms.length > 0 && (
          <div className="me-tags avoid">
            <span className="me-tagl">less of</span>
            {m.avoidTerms.map((t) => <span key={t.term} className="me-tag neg">{clean(t.term)}</span>)}
          </div>
        )}
        <p className="me-note">Tags come from what you swipe. Resetting forgets likes, passes, and this profile; your saves stay.</p>
      </section>

      <List title="Saved" items={saved.map((it) => ({ id: it.repo.id, at: 0, it }))} empty="Tap the bookmark on any card to keep it here." kind="save" />
      <List title="Liked" items={liked} empty="Swipe right on a card." kind="like" />
      <List title="Passed" items={skipped} empty="Swipe left on a card." kind="skip" collapsed />
      {dived.length > 0 && <List title="Deep dives" items={dived} empty="" kind="dive" collapsed />}
    </main>
  );
}

function List({ title, items, empty, kind, collapsed }: { title: string; items: { id: string; at: number; it: Item }[]; empty: string; kind: string; collapsed?: boolean }) {
  const body = items.length === 0 ? <p className="me-empty">{empty}</p> : (
    <ul className="me-list">
      {items.map(({ id, at, it }) => (
        <li key={id}>
          <a href={`/r/${id}`}>
            <span className={`me-dot ${kind}`} />
            <span className="me-row">
              <span className="me-title">{it.repo.owner}<b>/{it.repo.name}</b></span>
              <span className="me-desc">{it.card?.pitch ?? it.repo.description}</span>
            </span>
            <span className="me-meta">★ {fmt(it.repo.stars)}{at ? <><br />{ago(at)}</> : null}</span>
          </a>
        </li>
      ))}
    </ul>
  );
  if (collapsed && items.length) {
    return (
      <details className="me-sec">
        <summary className="me-h"><h2>{title} <small>{items.length}</small></h2><span className="me-chev">▾</span></summary>
        {body}
      </details>
    );
  }
  return <section className="me-sec"><header className="me-h"><h2>{title} <small>{items.length}</small></h2></header>{body}</section>;
}
