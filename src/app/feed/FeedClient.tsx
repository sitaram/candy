"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import type { Feed, FeedItem } from "@/lib/user/feed";
import type { Action, Reaction } from "@/lib/user/state";
import { Detail } from "./Detail";
import "./feed.css";

type Decision = "like" | "skip";
const THRESH = 100;

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function post(id: string, kind: Action) {
  return fetch("/api/react", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind }) });
}

/* ---------- icons (inline, no deps) ---------- */
const I = {
  up: <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>,
  down: <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></svg>,
  bookmark: (filled: boolean) => <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>,
  open: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>,
};

/* ---------- card ---------- */
function Card({
  f, style, className, peek, debug, saved, onSave, onOpen, onDecide,
}: {
  f: FeedItem; style?: CSSProperties; className?: string; peek?: boolean; debug?: boolean; saved?: boolean;
  onSave?: () => void; onOpen?: () => void; onDecide?: (d: Decision) => void;
}) {
  const c = f.item.card;
  const r = f.item.repo;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <article className={`fcard${f.explore ? " explore" : ""}${peek ? " peek" : ""} ${className ?? ""}`} style={style} aria-hidden={peek}>
      <div className="fcard-top">
        <div className="fcard-why">{f.why.join(" · ")}</div>
        {!peek && (
          <button className={`icon-btn bm${saved ? " on" : ""}`} onPointerDown={stop} onClick={(e) => { stop(e); onSave?.(); }} aria-label={saved ? "Remove bookmark" : "Bookmark"} title="Bookmark (b)">
            {I.bookmark(!!saved)}
          </button>
        )}
      </div>
      <h2 className="fcard-title">
        <span className={`score s${c?.interest ?? 0}`}>{c?.interest}</span>
        <span className="fcard-id">{f.id}</span>
      </h2>
      <p className="fcard-pitch">{c?.pitch}</p>
      <p className="fcard-whycare">{c?.whyCare}</p>
      <div className="tags scroll">
        <span className="tag cat">{c?.category}</span>
        <span className="tag">{c?.maturity}</span>
        {r.language && <span className="tag">{r.language}</span>}
        <span className="tag">{fmt(r.stars)}★</span>
        {r.starsPerDay >= 5 && <span className="tag">{Math.round(r.starsPerDay)}/day</span>}
        {c?.tags.slice(0, 6).map((t) => <span key={t} className="tag">{t}</span>)}
      </div>
      <div className="fcard-spacer" />
      {debug && <div className="fcard-dbg">score {f.score} · fit {f.fit}</div>}
      {!peek && (
        <div className="fcard-actions" onPointerDown={stop}>
          <button className="act down" onClick={() => onDecide?.("skip")} aria-label="Not for me" title="Not for me (←)">{I.down}</button>
          <button className="act open" onClick={onOpen} aria-label="Read more" title="Read more (↑ / enter)">{I.open}<small>more</small></button>
          <button className="act up" onClick={() => onDecide?.("like")} aria-label="Interesting" title="Interesting (→)">{I.up}</button>
        </div>
      )}
      <div className="stamp like">YES</div>
      <div className="stamp skip">NOPE</div>
    </article>
  );
}

/* ---------- deck ---------- */
export function FeedClient() {
  const [queue, setQueue] = useState<FeedItem[]>([]);
  const [since, setSince] = useState<Feed["since"] | null>(null);
  const [profileSize, setProfileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState({ like: 0, skip: 0 });
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ item: FeedItem; kind: Decision } | null>(null);
  const [debug, setDebug] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const fetching = useRef(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDebug(new URLSearchParams(window.location.search).has("debug")), []);

  const load = useCallback(async (initial = false) => {
    if (fetching.current) return;
    fetching.current = true;
    const ex = Array.from(seenRef.current).map((id) => `exclude=${encodeURIComponent(id)}`).join("&");
    const f = (await (await fetch(`/api/feed?n=30${ex ? "&" + ex : ""}`)).json()) as Feed;
    setQueue((q) => {
      const have = new Set(q.map((x) => x.id));
      return [...q, ...f.items.filter((it) => !seenRef.current.has(it.id) && !have.has(it.id))];
    });
    setSaved((s) => {
      const n = new Set(s);
      for (const it of f.items) if (it.saved) n.add(it.id);
      return n;
    });
    if (initial) setSince(f.since);
    setProfileSize(f.profileSize);
    setLoading(false);
    fetching.current = false;
  }, []);

  useEffect(() => { void load(true); }, [load]);

  /* detail open/close mirrors history so back-swipe closes the sheet */
  const openDetail = useCallback((id: string) => {
    if (!open) history.pushState({ detail: id }, "", `#${id}`);
    else history.replaceState({ detail: id }, "", `#${id}`);
    setOpen(id);
    void post(id, "dive");
  }, [open]);
  const closeDetail = useCallback(() => {
    if (open) history.back();
  }, [open]);
  useEffect(() => {
    const onPop = () => setOpen((history.state as { detail?: string } | null)?.detail ?? null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const decide = useCallback((kind: Decision) => {
    const cur = queue[0];
    if (!cur || leaving) return;
    seenRef.current.add(cur.id);
    setCount((c) => ({ ...c, [kind]: c[kind] + 1 }));
    void post(cur.id, kind);
    setLeaving(kind);
    setTimeout(() => {
      setQueue((q) => q.slice(1));
      setLeaving(null);
      setDrag({ dx: 0, dy: 0, active: false });
    }, 280);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ item: cur, kind });
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
    if (queue.length < 8) void load();
  }, [queue, leaving, load]);

  const doUndo = useCallback(() => {
    if (!undo) return;
    const { item, kind } = undo;
    setUndo(null);
    seenRef.current.delete(item.id);
    setCount((c) => ({ ...c, [kind]: Math.max(0, c[kind] - 1) }));
    setQueue((q) => [item, ...q.filter((x) => x.id !== item.id)]);
    void post(item.id, "undo");
  }, [undo]);

  const toggleSave = useCallback((id: string) => {
    const was = saved.has(id);
    setSaved((s) => {
      const n = new Set(s);
      if (was) n.delete(id); else n.add(id);
      return n;
    });
    void post(id, was ? "unsave" : "save");
  }, [saved]);

  /* pointer drag: horizontal decides, upward opens */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (leaving || !queue[0] || open) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
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
    if (Math.abs(dx) >= THRESH && Math.abs(dx) > Math.abs(dy)) {
      setDrag({ dx, dy, active: false });
      decide(dx > 0 ? "like" : "skip");
    } else if (dy <= -THRESH && Math.abs(dy) > Math.abs(dx)) {
      setDrag({ dx: 0, dy: 0, active: false });
      if (queue[0]) openDetail(queue[0].id);
    } else setDrag({ dx: 0, dy: 0, active: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (open) {
        if (e.key === "Escape" || e.key === "ArrowDown") closeDetail();
        return;
      }
      const cur = queue[0];
      if (e.key === "ArrowLeft") decide("skip");
      else if (e.key === "ArrowRight") decide("like");
      else if ((e.key === "ArrowUp" || e.key === "Enter") && cur) openDetail(cur.id);
      else if (e.key === "b" && cur) toggleSave(cur.id);
      else if (e.key === "z" && undo) doUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, open, undo, decide, openDetail, closeDetail, toggleSave, doUndo]);

  const cur = queue[0];
  const next = queue[1];
  const px = drag.active ? drag.dx : 0;
  const pr = Math.min(1, Math.abs(px) / THRESH);
  const pendingDir: Decision | null = drag.active && Math.abs(drag.dx) > 12 && Math.abs(drag.dx) > Math.abs(drag.dy) ? (drag.dx > 0 ? "like" : "skip") : null;
  const liftHint = drag.active && drag.dy < -12 && Math.abs(drag.dy) > Math.abs(drag.dx);

  let curStyle: CSSProperties;
  if (leaving) {
    curStyle = { transform: leaving === "like" ? "translate(120vw,-6vh) rotate(14deg)" : "translate(-120vw,-6vh) rotate(-14deg)", opacity: 0, transition: "transform .28s cubic-bezier(.2,.7,.3,1), opacity .28s" };
  } else if (drag.active) {
    curStyle = { transform: `translate(${drag.dx}px, ${Math.min(0, drag.dy) * 0.6}px) rotate(${drag.dx / 20}deg)`, transition: "none" };
  } else {
    curStyle = { transform: "none", transition: "transform .22s ease-out" };
  }
  const peekScale = 0.95 + 0.05 * (leaving ? 1 : pr);

  return (
    <div className={`feed${open ? " has-detail" : ""}`}>
      <header className="feed-head">
        <a href="/" className="brand">candy</a>
        <span className="feed-since">
          {since && since.lastVisit > 0 ? (
            <>
              {since.newInCorpus} new
              {since.newInYourAreas > 0 && <>, <b>{since.newInYourAreas} in your areas</b></>}
              {since.releasesOnSaved.length > 0 && <>, {since.releasesOnSaved.length} saved released</>}
            </>
          ) : profileSize === 0 ? "swipe a few and it learns" : ""}
        </span>
        <a href="/me" className="feed-me">{count.like + count.skip > 0 ? `${count.like} 👍 · ${count.skip} 👎` : "me"}</a>
      </header>

      <div className="deck-wrap">
        <div className="deck">
          {loading && <div className="feed-empty">loading…</div>}
          {!loading && !cur && <div className="feed-empty">You’ve seen everything ranked for you today.<br /><a href="/">Browse the corpus</a> or come back tomorrow.</div>}
          {cur && (
            <div className="stack">
              {next && <Card key={`peek-${next.id}`} f={next} peek style={{ transform: `scale(${peekScale}) translateY(${(1 - peekScale) * 160}px)` }} />}
              <div className={`drag-layer${pendingDir ? ` hint-${pendingDir}` : ""}${liftHint ? " hint-open" : ""}`} style={{ "--p": pr } as CSSProperties}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                <Card key={cur.id} f={cur} style={curStyle} debug={debug} saved={saved.has(cur.id)}
                  onSave={() => toggleSave(cur.id)} onOpen={() => openDetail(cur.id)} onDecide={decide} />
              </div>
            </div>
          )}
          {undo && !leaving && (
            <div className="toast">
              {undo.kind === "like" ? "Marked interesting" : "Skipped"} <b>{undo.item.id.split("/")[1]}</b>
              <button onClick={doUndo}>undo</button>
            </div>
          )}
          <div className="keyhints">← not for me · → interesting · ↑ read · b bookmark · z undo</div>
        </div>

        {open && (
          <div className="detail-host">
            <div className="scrim" onClick={closeDetail} />
            <Detail id={open} onClose={closeDetail} onOpen={openDetail} />
          </div>
        )}
      </div>
    </div>
  );
}
