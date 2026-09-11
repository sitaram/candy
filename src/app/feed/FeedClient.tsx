"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import type { Feed, FeedItem } from "@/lib/user/feed";
import type { Reaction } from "@/lib/user/state";

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

const THRESH = 90; // px to commit
const LABEL: Record<Reaction, string> = { like: "♥ like", skip: "✕ skip", save: "★ save", dive: "↓ dive" };

function dirOf(dx: number, dy: number): Reaction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 12 && ay < 12) return null;
  if (ax >= ay) return dx > 0 ? "like" : "skip";
  return dy < 0 ? "save" : "dive";
}

function Card({ f, style, className, ghost }: { f: FeedItem; style?: CSSProperties; className?: string; ghost?: boolean }) {
  const c = f.item.card;
  const r = f.item.repo;
  return (
    <article className={`fcard${f.explore ? " explore" : ""}${ghost ? " peek" : ""} ${className ?? ""}`} style={style} aria-hidden={ghost}>
      <div className="fcard-why">{f.why.join(" · ")}</div>
      <h2 className="fcard-title">
        <span className={`score s${c?.interest ?? 0}`}>{c?.interest}</span>
        {f.id}
      </h2>
      <p className="fcard-pitch">{c?.pitch}</p>
      <p className="fcard-whycare">{c?.whyCare}</p>
      <div className="tags">
        <span className="tag cat">{c?.category}</span>
        <span className="tag">{c?.maturity}</span>
        {r.language && <span className="tag">{r.language}</span>}
        <span className="tag">{fmt(r.stars)}★</span>
        {r.starsPerDay >= 5 && <span className="tag">{Math.round(r.starsPerDay)}/day</span>}
        {c?.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}
      </div>
      <div className="fcard-foot">
        <a href={r.url} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}>github ↗</a>
        <span className="fcard-dbg">score {f.score} · fit {f.fit}</span>
      </div>
    </article>
  );
}

export function FeedClient() {
  const [queue, setQueue] = useState<FeedItem[]>([]);
  const [since, setSince] = useState<Feed["since"] | null>(null);
  const [profileSize, setProfileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState({ like: 0, skip: 0, save: 0, dive: 0 });
  const [drag, setDrag] = useState<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false });
  const [leaving, setLeaving] = useState<{ id: string; kind: Reaction } | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const fetching = useRef(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const load = useCallback(async (initial = false) => {
    if (fetching.current) return;
    fetching.current = true;
    const ex = Array.from(seenRef.current).map((id) => `exclude=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`/api/feed?n=30${ex ? "&" + ex : ""}`);
    const f = (await res.json()) as Feed;
    setQueue((q) => {
      const have = new Set(q.map((x) => x.id));
      return [...q, ...f.items.filter((it) => !seenRef.current.has(it.id) && !have.has(it.id))];
    });
    if (initial) setSince(f.since);
    setProfileSize(f.profileSize);
    setLoading(false);
    fetching.current = false;
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const commit = useCallback(
    (kind: Reaction) => {
      const cur = queue[0];
      if (!cur || leaving) return;
      seenRef.current.add(cur.id);
      setCount((c) => ({ ...c, [kind]: c[kind] + 1 }));
      void fetch("/api/react", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cur.id, kind }) });
      if (kind === "dive") {
        // Keep the card; go read. Back button returns here with the queue intact.
        setDrag({ dx: 0, dy: 0, active: false });
        window.location.href = `/r/${cur.id}`;
        return;
      }
      setLeaving({ id: cur.id, kind });
      setTimeout(() => {
        setQueue((q) => q.slice(1));
        setLeaving(null);
        setDrag({ dx: 0, dy: 0, active: false });
      }, 260);
      if (queue.length < 8) void load();
    },
    [queue, leaving, load],
  );

  // ---- pointer drag ----
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (leaving || !queue[0]) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDrag({ dx: 0, dy: 0, active: true });
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y, active: true });
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    const d = dirOf(dx, dy);
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (d && dist >= THRESH) {
      setDrag({ dx, dy, active: false });
      commit(d);
    } else {
      setDrag({ dx: 0, dy: 0, active: false });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "j") commit("skip");
      else if (e.key === "ArrowRight" || e.key === "l") commit("like");
      else if (e.key === "ArrowUp" || e.key === "s") commit("save");
      else if (e.key === "ArrowDown" || e.key === "d" || e.key === "Enter") commit("dive");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  const cur = queue[0];
  const next = queue[1];
  const total = count.like + count.skip + count.save + count.dive;

  // Current card transform: follow finger, slight rotate on x; fly out on commit.
  const pending = drag.active ? dirOf(drag.dx, drag.dy) : null;
  const progress = Math.min(1, Math.max(Math.abs(drag.dx), Math.abs(drag.dy)) / THRESH);
  let curStyle: CSSProperties = {};
  if (leaving) {
    const fly = { like: "translate(120vw, 0) rotate(12deg)", skip: "translate(-120vw, 0) rotate(-12deg)", save: "translate(0, -120vh)", dive: "translate(0, 120vh)" }[leaving.kind];
    curStyle = { transform: fly, opacity: 0, transition: "transform .26s ease-in, opacity .26s ease-in" };
  } else if (drag.active) {
    curStyle = { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 22}deg)`, transition: "none" };
  } else {
    curStyle = { transform: "translate(0,0) rotate(0)", transition: "transform .2s ease-out" };
  }
  const peekScale = 0.94 + 0.06 * (leaving ? 1 : progress);

  return (
    <div className="feed">
      <header className="feed-head">
        <a href="/" className="brand">candy</a>
        <span className="feed-since">
          {since && since.lastVisit > 0 ? (
            <>
              {since.newInCorpus} new since last visit
              {since.newInYourAreas > 0 && <>, <b>{since.newInYourAreas} in your areas</b></>}
              {since.releasesOnSaved.length > 0 && <>, {since.releasesOnSaved.length} saved repo{since.releasesOnSaved.length > 1 ? "s" : ""} released</>}
            </>
          ) : profileSize === 0 ? (
            "new here — swipe a few and it learns"
          ) : (
            ""
          )}
        </span>
        <a href="/me" className="feed-me">{total > 0 ? `${count.like + count.save} liked · ${count.skip} skipped` : "me"}</a>
      </header>

      {loading && <div className="feed-empty">loading…</div>}
      {!loading && !cur && <div className="feed-empty">You’ve seen everything ranked for you today. Come back tomorrow, or <a href="/">browse</a>.</div>}

      {cur && (
        <div className="stack">
          {next && <Card key={`peek-${next.id}`} f={next} ghost style={{ transform: `scale(${peekScale}) translateY(${(1 - peekScale) * 120}px)` }} />}
          <div
            className="drag-layer"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ touchAction: "none" }}
          >
            <Card key={cur.id} f={cur} style={curStyle} className={pending ? `hint-${pending}` : ""} />
            {pending && (
              <div className={`swipe-hint ${pending}`} style={{ opacity: 0.35 + 0.65 * progress, transform: `scale(${0.9 + 0.2 * progress})` }}>
                {LABEL[pending]}
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="feed-actions">
        <button className="act skip" onClick={() => commit("skip")} title="Skip (←)">✕<small>skip</small></button>
        <button className="act dive" onClick={() => commit("dive")} title="Deep dive (↓)">↓<small>dive</small></button>
        <button className="act save" onClick={() => commit("save")} title="Save (↑)">★<small>save</small></button>
        <button className="act like" onClick={() => commit("like")} title="Like (→)">♥<small>like</small></button>
      </nav>
    </div>
  );
}
