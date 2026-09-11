"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { flushSync } from "react-dom";
import type { Feed, FeedItem } from "@/lib/user/feed";
import type { Action, Reaction } from "@/lib/user/state";
import { Detail } from "./Detail";
import "./feed.css";

type Decision = "like" | "skip";
const THRESH = 100;      // px to commit a horizontal decision
const VTHRESH = 90;      // px to commit a vertical page
const AXIS_LOCK = 10;    // px before we pick an axis

/** Category -> hue for the page gradient. Adjacent categories get nearby hues. */
const HUE: Record<string, number> = {
  "ai-llm": 268, "ai-agents": 280, "ml-infra": 255, "dev-tools": 205, cli: 195, "web-framework": 330, frontend: 340,
  backend: 215, database: 30, "data-eng": 45, "devops-infra": 175, security: 0, networking: 185, systems: 20,
  "languages-compilers": 300, mobile: 320, desktop: 240, "games-graphics": 355, science: 150, productivity: 95,
  "learning-resource": 60, "awesome-list": 70, other: 230,
};
function hueOf(f?: FeedItem): number {
  return f?.item.card ? HUE[f.item.card.category] ?? 230 : 230;
}

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
const CAT_LABEL: Record<string, string> = {
  "ai-llm": "AI · LLM", "ai-agents": "AI · Agents", "ml-infra": "ML Infra", "dev-tools": "Dev Tools", cli: "CLI",
  "web-framework": "Web Framework", frontend: "Frontend", backend: "Backend", database: "Database", "data-eng": "Data Eng",
  "devops-infra": "DevOps · Infra", security: "Security", networking: "Networking", systems: "Systems",
  "languages-compilers": "Languages", mobile: "Mobile", desktop: "Desktop", "games-graphics": "Games · Graphics",
  science: "Science", productivity: "Productivity", "learning-resource": "Learning", "awesome-list": "Curated List", other: "Other",
};
const HOOK_LABEL: Record<string, string> = {
  "major-release": "Major release", "big-org": "Backed by a major org", viral: "Going viral", "license-change": "License changed",
  "novel-approach": "Novel approach", "fills-gap": "Fills a gap", "new-project": "Brand new",
};
const MATURITY_LABEL: Record<string, string> = { experiment: "experiment", early: "early", usable: "usable", mature: "mature", legacy: "legacy" };

function agoShort(iso: string): string {
  if (!iso) return "";
  const d = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (d < 1) return "today";
  if (d < 2) return "1d";
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(d < 730 ? 1 : 0)}y`;
}
function splitWhy(why: string[]): { fit: string | null; rest: string[] } {
  const fit = why.find((w) => w.startsWith("matches your interest")) ?? null;
  return { fit: fit ? fit.replace("matches your interest in ", "") : null, rest: why.filter((w) => w !== fit && !w.startsWith("outside your usual")) };
}

function Card({
  f, style, className, debug, saved, reaction, onSave, onOpen, onDecide,
}: {
  f: FeedItem; style?: CSSProperties; className?: string; debug?: boolean; saved?: boolean; reaction?: Decision;
  onSave?: () => void; onOpen?: () => void; onDecide?: (d: Decision) => void;
}) {
  const c = f.item.card;
  const r = f.item.repo;
  const [owner, name] = f.id.split("/");
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const { fit, rest } = splitWhy(f.why);

  // At most two reasons: fit first, then the single strongest other signal.
  const social = rest.find((w) => w.startsWith("on "));
  const hook = c && c.hook !== "none" && c.hook !== "big-org" ? HOOK_LABEL[c.hook] : null;
  const second = hook ?? social ?? null;

  // Four-up snapshot: popularity, momentum, age, activity. No boxes, just numbers.
  const stats: { v: string; k: string }[] = [
    { v: fmt(r.stars), k: "stars" },
    { v: r.starsPerDay >= 1 ? `+${fmt(Math.round(r.starsPerDay))}` : "—", k: "per day" },
    { v: agoShort(r.createdAt), k: "old" },
    r.latestRelease
      ? { v: r.latestRelease.replace(/^v(?=\d)/, "").slice(0, 8), k: agoShort(r.latestReleaseAt) === "today" ? "released today" : `${agoShort(r.latestReleaseAt)} ago` }
      : { v: agoShort(r.pushedAt), k: "last push" },
  ];

  return (
    <article className={`fcard ${className ?? ""}`} style={style}>
      <header className="c-head">
        <span className="c-cat">{c ? CAT_LABEL[c.category] ?? c.category : ""}</span>
        <span className="c-spacer" />
        {reaction && <span className={`c-reacted ${reaction}`}>{reaction === "like" ? "👍" : "👎"}</span>}
        {c && c.interest >= 8 && <span className="c-score" title="Broadly notable">{c.interest}</span>}
        <button className={`icon-btn bm${saved ? " on" : ""}`} onPointerDown={stop} onClick={(e) => { stop(e); onSave?.(); }} aria-label={saved ? "Remove bookmark" : "Bookmark"} title="Bookmark (b)">
          {I.bookmark(!!saved)}
        </button>
      </header>

      <h1 className="c-title">
        <span className="c-owner">{owner}</span>
        <span className="c-name">{name}</span>
      </h1>

      <p className="c-pitch">{c?.pitch ?? r.description}</p>

      {(fit || second || f.explore) && (
        <div className="c-why">
          {f.explore && <span className="chip explore">✦ exploring</span>}
          {fit && <span className="chip fit">{fit}</span>}
          {second && <span className="chip">{second}</span>}
        </div>
      )}

      {c?.whyCare && <p className="c-body">{c.whyCare}</p>}

      <div className="fcard-spacer" />

      <div className="c-stats">
        {stats.map((st) => (
          <div key={st.k} className="c-stat"><div className="c-stat-v">{st.v}</div><div className="c-stat-k">{st.k}</div></div>
        ))}
        {r.language && <div className="c-stat"><div className="c-stat-v lang">{r.language}</div><div className="c-stat-k">{c ? MATURITY_LABEL[c.maturity] : ""}</div></div>}
      </div>
      {debug && <div className="fcard-dbg">score {f.score} · fit {f.fit}</div>}

      <div className="fcard-actions" onPointerDown={stop}>
        <button className="act down" onClick={() => onDecide?.("skip")} aria-label="Not for me" title="Not for me (←)">{I.down}</button>
        <button className="act open" onClick={onOpen} aria-label="Read more" title="Read more (↑ / enter)">{I.open}</button>
        <button className="act up" onClick={() => onDecide?.("like")} aria-label="Interesting" title="Interesting (→)">{I.up}</button>
      </div>
      <div className="stamp like">YES</div>
      <div className="stamp skip">NOPE</div>
    </article>
  );
}

/* ---------- deck ---------- */
export function FeedClient() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [since, setSince] = useState<Feed["since"] | null>(null);
  const [profileSize, setProfileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState({ like: 0, skip: 0 });
  const [drag, setDrag] = useState<{ dx: number; dy: number; axis: "x" | "y" | null; active: boolean }>({ dx: 0, dy: 0, axis: null, active: false });
  const [settle, setSettle] = useState(0);          // vertical page offset in px, animates to 0
  const [animating, setAnimating] = useState(false);
  const [ghost, setGhost] = useState<{ item: FeedItem; kind: Decision; style: CSSProperties } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ item: FeedItem; kind: Decision; at: number } | null>(null);
  const [debug, setDebug] = useState(false);
  const [vh, setVh] = useState(800);
  const seenRef = useRef<Set<string>>(new Set());
  const reacted = useRef<Map<string, Decision>>(new Map());
  const fetching = useRef(false);
  const start = useRef<{ x: number; y: number; id: number; axis: "x" | "y" | null } | null>(null);
  const busy = useRef(false);   // true while a page/decision animation runs
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDebug(new URLSearchParams(window.location.search).has("debug")), []);
  useEffect(() => {
    const m = () => setVh(stackRef.current?.clientHeight || window.innerHeight);
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, [loading]);

  const load = useCallback(async (initial = false) => {
    if (fetching.current) return;
    fetching.current = true;
    const ex = Array.from(seenRef.current).map((id) => `exclude=${encodeURIComponent(id)}`).join("&");
    const f = (await (await fetch(`/api/feed?n=30${ex ? "&" + ex : ""}`)).json()) as Feed;
    setItems((q) => {
      const have = new Set(q.map((x) => x.id));
      return [...q, ...f.items.filter((it) => !have.has(it.id))];
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

  const cur = items[idx];
  const prev = idx > 0 ? items[idx - 1] : undefined;
  const next = items[idx + 1];

  // Dwelling on a card marks it seen (so it is excluded from future fetches). No reaction is sent.
  useEffect(() => {
    if (!cur) return;
    const t = setTimeout(() => { seenRef.current.add(cur.id); }, 600);
    return () => clearTimeout(t);
  }, [cur]);
  useEffect(() => { if (!loading && items.length - idx <= 8) void load(); }, [idx, items.length, loading, load]);

  /* detail open/close mirrors history so back-swipe closes the sheet */
  const openDetail = useCallback((id: string) => {
    if (!open) history.pushState({ detail: id }, "", `#${id}`);
    else history.replaceState({ detail: id }, "", `#${id}`);
    setOpen(id);
    void post(id, "dive");
  }, [open]);
  const closeDetail = useCallback(() => { if (open) history.back(); }, [open]);
  useEffect(() => {
    const onPop = () => setOpen((history.state as { detail?: string } | null)?.detail ?? null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* ---- motion primitives ---- */

  /** Animate the vertical pager from a starting px offset to 0. */
  const settleFrom = useCallback((fromPx: number) => {
    busy.current = true;
    flushSync(() => { setAnimating(false); setSettle(fromPx); });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setAnimating(true);
      setSettle(0);
      setTimeout(() => { setAnimating(false); busy.current = false; }, 380);
    }));
  }, []);

  /** Move to another page; the new current card slides in from the side it was on. */
  const go = useCallback((to: number, fromDragDy = 0) => {
    if (to < 0 || to >= items.length || busy.current) return;
    const dir = to > idx ? 1 : -1;               // +1 = advancing (next rises from below)
    setIdx(to);
    setDrag({ dx: 0, dy: 0, axis: null, active: false });
    // New card is currently at dir*vh; drag already moved it by fromDragDy. Start there, go to 0.
    settleFrom(dir * vh + fromDragDy);
  }, [items.length, animating, idx, vh, settleFrom]);

  /** Horizontal decision: fly the current card out, next rises in. */
  const decide = useCallback((kind: Decision, fromDrag?: { dx: number; dy: number }) => {
    if (!cur || busy.current) return;
    seenRef.current.add(cur.id);
    reacted.current.set(cur.id, kind);
    setCount((c) => ({ ...c, [kind]: c[kind] + 1 }));
    void post(cur.id, kind);
    const startT = fromDrag ? `translate(${fromDrag.dx}px, ${fromDrag.dy * 0.2}px) rotate(${fromDrag.dx / 20}deg)` : "translate(0,0)";
    const endT = kind === "like" ? "translate(120vw,-6vh) rotate(14deg)" : "translate(-120vw,-6vh) rotate(-14deg)";
    // Ghost = the card flying out. Next rises via go(); if there is no next, the ghost alone carries the gesture.
    const hasNext = idx + 1 < items.length;
    busy.current = true;
    flushSync(() => {
      setGhost({ item: cur, kind, style: { transform: startT, transition: "none" } });
      setDrag({ dx: 0, dy: 0, axis: null, active: false });
      if (hasNext) { setAnimating(false); setIdx(idx + 1); setSettle(vh); }
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setGhost((g) => g && { ...g, style: { transform: endT, opacity: 0, transition: "transform .32s cubic-bezier(.2,.7,.3,1), opacity .32s" } });
      if (hasNext) { setAnimating(true); setSettle(0); }
      setTimeout(() => { setGhost(null); setAnimating(false); busy.current = false; }, 380);
    }));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ item: cur, kind, at: idx });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, [cur, idx, items.length, vh]);

  const doUndo = useCallback(() => {
    if (!undo) return;
    const { item, kind, at } = undo;
    setUndo(null);
    seenRef.current.delete(item.id);
    reacted.current.delete(item.id);
    setCount((c) => ({ ...c, [kind]: Math.max(0, c[kind] - 1) }));
    void post(item.id, "undo");
    if (at !== idx) go(at);
  }, [undo, idx, go]);

  const toggleSave = useCallback((id: string) => {
    const was = saved.has(id);
    setSaved((s) => { const n = new Set(s); if (was) n.delete(id); else n.add(id); return n; });
    void post(id, was ? "unsave" : "save");
  }, [saved]);

  /* ---- pointer: lock to an axis after a few px; x decides, y pages ---- */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!cur || open) return;
    // A touch during a settle animation snaps it to rest instead of being dropped; the finger takes over.
    if (busy.current) { busy.current = false; setAnimating(false); setSettle(0); }
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ dx: 0, dy: 0, axis: null, active: true });
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const st = start.current;
    if (!st || st.id !== e.pointerId) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.axis && Math.hypot(dx, dy) > AXIS_LOCK) st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    setDrag({ dx, dy, axis: st.axis, active: true });
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const st = start.current;
    if (!st || st.id !== e.pointerId) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    start.current = null;
    if (st.axis === "x" && Math.abs(dx) >= THRESH) { decide(dx > 0 ? "like" : "skip", { dx, dy }); return; }
    if (st.axis === "y") {
      if (dy <= -VTHRESH && next) { go(idx + 1, dy); return; }
      if (dy >= VTHRESH && prev) { go(idx - 1, dy); return; }
      // not far enough: glide back to rest from where the finger left it
      setDrag({ dx: 0, dy: 0, axis: null, active: false });
      settleFrom(dy);
      return;
    }
    setDrag({ dx: 0, dy: 0, axis: null, active: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (open) { if (e.key === "Escape") closeDetail(); return; }
      if (e.key === "ArrowLeft") decide("skip");
      else if (e.key === "ArrowRight") decide("like");
      else if (e.key === "ArrowUp" || e.key === "j") go(idx + 1);
      else if (e.key === "ArrowDown" || e.key === "k") go(idx - 1);
      else if (e.key === "Enter" && cur) openDetail(cur.id);
      else if (e.key === "b" && cur) toggleSave(cur.id);
      else if (e.key === "z" && undo) doUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, idx, open, undo, decide, go, openDetail, closeDetail, toggleSave, doUndo]);

  /* ---- layout: three cards on a vertical rail, current one also follows x ---- */
  const dX = drag.active && drag.axis === "x" ? drag.dx : 0;
  const dY = drag.active && drag.axis === "y" ? drag.dy : 0;
  // Vertical rail position of the current card (px). settle animates toward 0 after a page.
  const railY = dY + settle;
  const ease = animating ? "transform .38s cubic-bezier(.22,.9,.3,1)" : "none";
  const pr = Math.min(1, Math.abs(dX) / THRESH);
  const pendingDir: Decision | null = drag.axis === "x" && Math.abs(dX) > 12 ? (dX > 0 ? "like" : "skip") : null;
  const peekFade = Math.max(0, 1 - Math.max(0, -railY) / 120);   // strip fades as the next card rises

  const curStyle: CSSProperties = {
    transform: `translate(${dX}px, ${railY}px) rotate(${dX / 20}deg)`,
    transition: drag.active ? "none" : animating ? ease : "transform .25s cubic-bezier(.22,.9,.3,1)",
  };
  const nextStyle: CSSProperties = { transform: `translateY(${vh + railY}px)`, transition: ease };
  const prevStyle: CSSProperties = { transform: `translateY(${-vh + railY}px)`, transition: ease };
  const hue = hueOf(cur);

  return (
    <div className={`feed${open ? " has-detail" : ""}`} style={{ "--hue": hue, "--hue2": (hue + 40) % 360 } as CSSProperties}>
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
            <div className="stack" ref={stackRef}>
              {prev && <Card key={prev.id} f={prev} style={prevStyle} className="rail" saved={saved.has(prev.id)} reaction={reacted.current.get(prev.id)} />}
              {next && <Card key={next.id} f={next} style={nextStyle} className="rail" saved={saved.has(next.id)} reaction={reacted.current.get(next.id)} />}
              {next && !ghost && (
                <div className="peek-strip" style={{ opacity: peekFade, "--peekhue": hueOf(next) } as CSSProperties} aria-hidden>
                  <div className="peek-label">up next · {next.item.card ? CAT_LABEL[next.item.card.category] ?? next.item.card.category : ""}</div>
                  <div className="peek-title">{next.id.split("/")[1]}</div>
                  <div className="peek-pitch">{next.item.card?.pitch}</div>
                </div>
              )}
              <div className={`drag-layer${pendingDir ? ` hint-${pendingDir}` : ""}`} style={{ "--p": pr } as CSSProperties}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                <Card key={cur.id} f={cur} style={curStyle} debug={debug} saved={saved.has(cur.id)} reaction={reacted.current.get(cur.id)}
                  onSave={() => toggleSave(cur.id)} onOpen={() => openDetail(cur.id)} onDecide={(k) => decide(k)} />
              </div>
              {ghost && (
                <div className={`drag-layer ghost hint-${ghost.kind}`} style={{ "--p": 1 } as CSSProperties} aria-hidden>
                  <Card f={ghost.item} style={ghost.style} saved={saved.has(ghost.item.id)} />
                </div>
              )}
            </div>
          )}
          {undo && (
            <div className="toast">
              {undo.kind === "like" ? "Marked interesting" : "Skipped"} <b>{undo.item.id.split("/")[1]}</b>
              <button onClick={doUndo}>undo</button>
            </div>
          )}
          <div className="keyhints">← not for me · → interesting · ↑↓ browse · enter read · b bookmark · z undo</div>
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
