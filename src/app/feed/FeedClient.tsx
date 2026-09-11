"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { flushSync } from "react-dom";
import type { Feed, FeedItem } from "@/lib/user/feed";
import type { Action, Reaction } from "@/lib/user/state";
import { Detail } from "./Detail";
import { useVoice } from "./useVoice";
import { Search } from "./Search";
import type { SearchResult } from "@/lib/user/search";
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
  bookmark: (filled: boolean) => <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>,
  // live-voice bars — the glyph Siri / ChatGPT Voice / Gemini Live use for a real-time conversation
  voice: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 7v10" /><path d="M20 10v4" /></svg>,
  search: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  // "maximize": two diagonal corner arrows — reads as "open this up"
  open: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="M9 21H3v-6" /><path d="m3 21 7-7" /></svg>,
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
  f, style, className, debug, saved, reaction, onSave, onOpen, onVoice, onSearch, voice,
}: {
  f: FeedItem; style?: CSSProperties; className?: string; debug?: boolean; saved?: boolean; reaction?: Decision;
  onSave?: () => void; onOpen?: () => void; onVoice?: () => void; onSearch?: () => void; voice?: { state: string; level: number };
}) {
  const c = f.item.card;
  const r = f.item.repo;
  const [owner, name] = f.id.split("/");
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const { fit, rest } = splitWhy(f.why);

  // Up to three reasons, in the order the ranker weighs them: your fit, then what is happening, then who noticed.
  const ageD = (Date.now() - Date.parse(r.createdAt)) / 86_400_000;
  const reasons: { t: string; k?: string }[] = [];
  if (f.explore) reasons.push({ t: "✦ exploring", k: "explore" });
  if (fit) reasons.push({ t: fit, k: "fit" });
  if (ageD < 14) reasons.push({ t: `new · ${agoShort(r.createdAt)} old${r.starsPerDay >= 5 ? ` · +${fmt(Math.round(r.starsPerDay))}/day` : ""}`, k: "hot" });
  else if (c?.hook === "viral" || r.starsPerDay >= 50) reasons.push({ t: `+${fmt(Math.round(r.starsPerDay))} stars/day`, k: "hot" });
  else if (r.latestReleaseAt && (Date.now() - Date.parse(r.latestReleaseAt)) / 86_400_000 < 14) reasons.push({ t: `released ${agoShort(r.latestReleaseAt)} ago`, k: "hot" });
  const hook = c && c.hook !== "none" && c.hook !== "big-org" && c.hook !== "viral" && c.hook !== "new-project" ? HOOK_LABEL[c.hook] : null;
  if (hook) reasons.push({ t: hook });
  const social = rest.find((w) => w.startsWith("on "));
  if (social) reasons.push({ t: social.replace("Hacker News", "HN").replace(" and ", " + "), k: "social" });

  // Four-up snapshot: popularity, momentum, age, activity. Labels short enough never to wrap.
  const rel = r.latestReleaseAt ? agoShort(r.latestReleaseAt) : "";
  const stats: { v: string; k: string }[] = [
    { v: fmt(r.stars), k: "stars" },
    { v: r.starsPerDay >= 1 ? `+${fmt(Math.round(r.starsPerDay))}` : "—", k: "per day" },
    { v: agoShort(r.createdAt), k: "old" },
    r.latestRelease
      ? { v: r.latestRelease.replace(/^v(?=\d)/, "").slice(0, 8), k: rel === "today" ? "today" : `${rel} ago` }
      : { v: agoShort(r.pushedAt), k: "last push" },
  ];

  const hue = hueOf(f);
  return (
    <article className={`fcard ${className ?? ""}`} style={{ ...style, "--hue": hue, "--hue2": (hue + 40) % 360 } as CSSProperties}>
      <header className="c-head">
        <span className="c-cat">{c ? CAT_LABEL[c.category] ?? c.category : ""}{r.language && <span className="c-lang"> · {r.language}</span>}</span>
        <span className="c-spacer" />
        {reaction && <span className={`c-reacted ${reaction}`}>{reaction === "like" ? "👍" : "👎"}</span>}
        {onSearch && (
          <button className="icon-btn" onPointerDown={stop} onClick={(e) => { stop(e); onSearch(); }} aria-label="Search" title="Search (/)">{I.search}</button>
        )}
        <button className={`icon-btn bm${saved ? " on" : ""}`} onPointerDown={stop} onClick={(e) => { stop(e); onSave?.(); }} aria-label={saved ? "Remove bookmark" : "Bookmark"} title="Bookmark (b)">
          {I.bookmark(!!saved)}
        </button>
      </header>

      <h1 className="c-title">
        <span className="c-owner">{owner}</span>
        <span className="c-name">{name}</span>
      </h1>

      <p className="c-pitch">{c?.pitch ?? r.description}</p>

      {reasons.length > 0 && (
        <div className="c-why">
          {reasons.slice(0, 3).map((x) => <span key={x.t} className={`chip${x.k ? ` ${x.k}` : ""}`}>{x.t}</span>)}
        </div>
      )}

      {c?.whyCare && <p className="c-body">{c.whyCare}</p>}

      <div className="fcard-spacer" />

      <div className="c-stats">
        {stats.map((st) => (
          <div key={st.k} className="c-stat"><div className="c-stat-v">{st.v}</div><div className="c-stat-k">{st.k}</div></div>
        ))}
      </div>
      {debug && <div className="fcard-dbg">score {f.score} · fit {f.fit}</div>}

      <div className="fcard-actions" onPointerDown={stop}>
        <button className="act dive" onClick={onOpen} aria-label="Deep dive" title="Deep dive (enter, or tap the card)">{I.open}</button>
        <button className={`act voice${voice && voice.state !== "idle" ? ` on ${voice.state}` : ""}`} style={{ "--lvl": voice?.level ?? 0 } as CSSProperties}
          onClick={(e) => { e.stopPropagation(); onVoice?.(); }} aria-label={voice && voice.state !== "idle" ? "End conversation" : "Talk about this"} title="Talk about this (v)">
          {voice && voice.state !== "idle" ? <span className="stop" aria-hidden /> : I.voice}
        </button>
      </div>
      <div className="stamp like">YES</div>
      <div className="stamp skip">NOPE</div>
    </article>
  );
}

/* ---------- splash: page −1 on the rail ---------- */
function Splash({ style, onStart }: { style?: CSSProperties; onStart: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <section className="fcard splash" style={style}>
      <div className="sp-mid">
        <div className="sp-brand">candy</div>
        <div className="sp-line">Open source worth your time.</div>
        <p className="sp-how">
          What’s moving, launching, or quietly becoming the standard — picked for you, and each card
          says why. Ten minutes a day keeps you ahead of the field.
        </p>
        <div className="sp-grid">
          <div><b>↑ ↓</b><span>browse</span></div>
          <div><b><i className="lk">→</i> <i className="pk">←</i></b><span>like · pass</span></div>
          <div><b>tap</b><span>deep dive</span></div>
          <div><b>talk</b><span>ask about it</span></div>
        </div>
        <div className="sp-learn">It learns from every swipe. <a className="sp-more" href="/about" onPointerDown={stop}>How it works →</a></div>
      </div>
      <button className="sp-start" onClick={onStart}><span className="sp-arrow">↑</span>swipe up to start</button>
    </section>
  );
}

/* ---------- deck ---------- */
export function FeedClient() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [idx, setIdx] = useState(-1);   // −1 = splash
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
  const [hinting, setHinting] = useState(false);
  const lastTouch = useRef(Date.now());
  const peekDown = useRef<{ x: number; y: number } | null>(null);
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

  const intro = idx < 0;
  const cur = intro ? undefined : items[idx];

  // First content card: breathe once right after it lands, so the gesture is seen before it is needed.
  const breathed = useRef(false);
  useEffect(() => {
    if (idx !== 0 || breathed.current || open) return;
    breathed.current = true;
    const t = setTimeout(() => {
      if (start.current || document.hidden || window.matchMedia("(min-width: 900px)").matches) return;
      lastTouch.current = Date.now();
      setHinting(true);
      setTimeout(() => setHinting(false), 3200);
    }, 900);   // after the bounce-in settles
    return () => clearTimeout(t);
  }, [idx, open]);

  // Then once a minute of stillness: the card leans right, left, then lifts — no words.
  const HINT_EVERY = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("hintfast") ? 4_000 : 60_000;
  useEffect(() => {
    if (!cur || open) return;
    const t = setInterval(() => {
      if (Date.now() - lastTouch.current < HINT_EVERY - 500) return;
      if (start.current || busy.current || document.hidden || window.matchMedia("(min-width: 900px)").matches) return;
      lastTouch.current = Date.now();            // one breath per idle minute, not one per second
      setHinting(true);
      setTimeout(() => setHinting(false), 3200);
    }, 1000);
    return () => clearInterval(t);
  }, [cur, open]);
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
      setTimeout(() => { setAnimating(false); busy.current = false; }, 500);
    }));
  }, []);

  /** Move to another page; the new current card slides in from the side it was on. */
  const go = useCallback((to: number, fromDragDy = 0) => {
    if (to < -1 || to >= items.length || busy.current) return;
    lastTouch.current = Date.now();
    const dir = to > idx ? 1 : -1;               // +1 = advancing (next rises from below)
    setIdx(to);
    setDrag({ dx: 0, dy: 0, axis: null, active: false });
    // New card is currently at dir*vh; drag already moved it by fromDragDy. Start there, go to 0.
    settleFrom(dir * vh + fromDragDy);
  }, [items.length, animating, idx, vh, settleFrom]);

  /** Horizontal decision: fly the current card out, next rises in. */
  const decide = useCallback((kind: Decision, fromDrag?: { dx: number; dy: number }) => {
    if (!cur || busy.current) return;
    lastTouch.current = Date.now();
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

  /* ---- voice: realtime conversation about the card on screen ---- */
  const idxRef = useRef(idx); idxRef.current = idx;
  const itemsRef = useRef(items); itemsRef.current = items;
  const briefOf = useCallback(async (f: FeedItem | undefined) => {
    if (!f) return null;
    const q = new URLSearchParams({ id: f.id }); for (const w of f.why) q.append("why", w);
    const r = await fetch(`/api/voice/brief?${q}`);
    return r.ok ? ((await r.json()) as { brief: string }).brief : null;
  }, []);
  const voice = useVoice({
    onNextCard: async () => {
      const to = idxRef.current + 1;
      if (to >= itemsRef.current.length) return null;
      go(to);
      await new Promise((r) => setTimeout(r, 120));
      return briefOf(itemsRef.current[to]);
    },
    onReact: async (kind) => {
      const f = itemsRef.current[idxRef.current];
      if (!f) return "No card on screen.";
      if (kind === "save") { if (!saved.has(f.id)) toggleSave(f.id); return `Saved ${f.id.split("/")[1]}.`; }
      decide(kind);
      await new Promise((r) => setTimeout(r, 450));
      const nxt = itemsRef.current[idxRef.current];
      const b = await briefOf(nxt);
      return `${kind === "like" ? "Liked" : "Skipped"} ${f.id.split("/")[1]}.${b ? `\n${b}` : "\nNo more cards."}`;
    },
  });
  const toggleVoice = useCallback(() => {
    if (voice.active) voice.stop();
    else if (cur) void voice.start({ mode: "card", id: cur.id, why: cur.why });
  }, [voice, cur]);
  /* ---- search: results hand a card to the rail, right after the current one ---- */
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => { if (voice.active) voice.stop(); setSearchOpen(true); }, [voice]);
  const pickResult = useCallback((r: SearchResult) => {
    const f: FeedItem = { id: r.id, item: r.item, score: r.score, fit: r.fit, why: r.why, explore: false, saved: r.saved };
    setSearchOpen(false);
    setItems((q) => {
      const at = Math.max(0, idxRef.current + 1);
      const rest = q.filter((x) => x.id !== f.id);
      return [...rest.slice(0, at), f, ...rest.slice(at)];
    });
    if (r.saved) setSaved((s) => new Set(s).add(r.id));
    // Let the insert render, then page onto it with the usual bounce.
    setTimeout(() => go(idxRef.current + 1), 30);
  }, [go]);

  // Swiping while talking: tell the model what's on screen now (but not for tool-driven changes, which return the brief themselves).
  const voiceCardId = useRef<string | null>(null);
  useEffect(() => {
    if (!voice.active || !cur) { voiceCardId.current = cur?.id ?? null; return; }
    if (voiceCardId.current === null) { voiceCardId.current = cur.id; return; }   // session just started on this card
    if (voiceCardId.current === cur.id) return;
    voiceCardId.current = cur.id;
    const t = setTimeout(async () => { const b = await briefOf(cur); if (b) voice.inject(b, false); }, 300);
    return () => clearTimeout(t);
  }, [cur, voice.active, voice, briefOf]);
  useEffect(() => { if (!voice.active) voiceCardId.current = null; }, [voice.active]);

  /* ---- pointer: lock to an axis after a few px; x decides, y pages ---- */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    lastTouch.current = Date.now();
    setHinting(false);
    if ((!cur && !intro) || open || searchOpen) return;
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
    if (!st.axis && Math.hypot(dx, dy) < 8) {
      setDrag({ dx: 0, dy: 0, axis: null, active: false });
      if (cur) openDetail(cur.id);
      else if (intro && items.length) go(0);      // tap anywhere on the splash starts
      return;
    }
    if (st.axis === "x" && Math.abs(dx) >= THRESH && cur) { decide(dx > 0 ? "like" : "skip", { dx, dy }); return; }
    if (st.axis === "y") {
      if (dy <= -VTHRESH && next) { go(idx + 1, dy); return; }
      if (dy >= VTHRESH && idx >= 0) { go(idx - 1, dy); return; }
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
      if (searchOpen) return;
      if (open) { if (e.key === "Escape") closeDetail(); return; }
      if (e.key === "/" && cur) { openSearch(); e.preventDefault(); return; }
      if (e.key === "ArrowLeft") decide("skip");
      else if (e.key === "ArrowRight") decide("like");
      else if (e.key === "ArrowUp" || e.key === "j") go(idx + 1);
      else if (e.key === "ArrowDown" || e.key === "k") go(idx - 1);
      else if (e.key === "Enter" && cur) openDetail(cur.id);
      else if (e.key === "b" && cur) toggleSave(cur.id);
      else if (e.key === "v" && cur) toggleVoice();
      else if (e.key === "z" && undo) doUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, idx, open, undo, decide, go, openDetail, closeDetail, toggleSave, doUndo, toggleVoice, searchOpen, openSearch]);

  /* ---- layout: three cards on a vertical rail, current one also follows x ---- */
  const dX = drag.active && drag.axis === "x" ? drag.dx : 0;
  const dY = drag.active && drag.axis === "y" ? drag.dy : 0;
  // Vertical rail position of the current card (px). settle animates toward 0 after a page.
  const railY = dY + settle;
  const ease = animating ? "transform .5s cubic-bezier(.3,1.25,.45,1)" : "none";
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
          {!loading && !intro && !cur && <div className="feed-empty">You’ve seen everything ranked for you today.<br /><a href="/browse">Browse the corpus</a> or come back tomorrow.</div>}
          {!loading && (cur || intro) && (
            <div className="stack" ref={stackRef}>
              {idx === 0 && <Splash style={prevStyle} onStart={() => {}} />}
              {prev && <Card key={prev.id} f={prev} style={prevStyle} className="rail" saved={saved.has(prev.id)} reaction={reacted.current.get(prev.id)} />}
              {next && <Card key={next.id} f={next} style={nextStyle} className="rail" saved={saved.has(next.id)} reaction={reacted.current.get(next.id)} />}
              {next && !ghost && !intro && (
                <div className="peek-strip" style={{ opacity: peekFade, "--peekhue": hueOf(next) } as CSSProperties} role="button" aria-label={`Next: ${next.id}`}
                  onPointerDown={(e) => {
                    // A tap pages forward; a drag hands off to the card so "swipe up from the peek" still works.
                    peekDown.current = { x: e.clientX, y: e.clientY };
                    lastTouch.current = Date.now(); setHinting(false);
                    onDown(e as unknown as RPointerEvent<HTMLDivElement>);
                  }}
                  onPointerMove={(e) => onMove(e as unknown as RPointerEvent<HTMLDivElement>)}
                  onPointerUp={(e) => {
                    const p = peekDown.current; peekDown.current = null;
                    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) { start.current = null; setDrag({ dx: 0, dy: 0, axis: null, active: false }); go(idx + 1); return; }
                    onUp(e as unknown as RPointerEvent<HTMLDivElement>);
                  }}
                  onPointerCancel={(e) => { peekDown.current = null; onUp(e as unknown as RPointerEvent<HTMLDivElement>); }}>
                  <div className="peek-label">up next · {next.item.card ? CAT_LABEL[next.item.card.category] ?? next.item.card.category : ""}</div>
                  <div className="peek-title">{next.id.split("/")[1]}</div>
                  <div className="peek-pitch">{next.item.card?.pitch}</div>
                </div>
              )}
              <div className={`drag-layer${pendingDir ? ` hint-${pendingDir}` : ""}${hinting && !drag.active ? " breathing" : ""}`} style={{ "--p": pr } as CSSProperties}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                {cur ? (
                  <Card key={cur.id} f={cur} style={curStyle} debug={debug} saved={saved.has(cur.id)} reaction={reacted.current.get(cur.id)}
                    onSave={() => toggleSave(cur.id)} onOpen={() => openDetail(cur.id)}
                    onVoice={toggleVoice} onSearch={openSearch} voice={{ state: voice.state, level: voice.level }} />
                ) : (
                  <Splash style={curStyle} onStart={() => go(0)} />
                )}
              </div>
              {ghost && (
                <div className={`drag-layer ghost hint-${ghost.kind}`} style={{ "--p": 1 } as CSSProperties} aria-hidden>
                  <Card f={ghost.item} style={ghost.style} saved={saved.has(ghost.item.id)} />
                </div>
              )}
            </div>
          )}
          {voice.error && <div className="toast err">{voice.error}<button onClick={() => voice.stop()}>ok</button></div>}
          {undo && (
            <div className="toast">
              {undo.kind === "like" ? "Marked interesting" : "Skipped"} <b>{undo.item.id.split("/")[1]}</b>
              <button onClick={doUndo}>undo</button>
            </div>
          )}
          <div className="keyhints">← pass · → like · ↑ ↓ browse · enter deep dive · v voice · / search · b bookmark · z undo</div>
        </div>

        <Search open={searchOpen} onClose={() => setSearchOpen(false)} onPick={pickResult} />
        {open && (
          <div className="detail-host">
            {/* pointerdown, not click: a tap on the card opens the sheet on pointerup, and the browser's
                synthesized click then lands on this scrim (mounted under the still-lifted finger). A finger
                that is already up never produces a new pointerdown, so this cannot close what it just opened. */}
            <div className="scrim" onPointerDown={closeDetail} />
            <Detail id={open} onClose={closeDetail} onOpen={openDetail} />
          </div>
        )}
      </div>
    </div>
  );
}
