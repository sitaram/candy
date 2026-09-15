"use client";

/**
 * The deck: what is on the rail, which card is current, and how the rail moves.
 *
 * Owns data (items, idx, saved, reactions, undo) and motion (settle offset, animating, the ghost
 * card flying out) together, because a decision is one atomic event that touches both: mark seen,
 * post the reaction, fly the card out, page the next one in. Splitting them would put a flushSync
 * across a hook boundary.
 *
 * Nothing here knows about pointers or keys — see useGestures / FeedClient. Nothing here renders.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import type { Feed, FeedItem } from "@/lib/user/feed";
import type { Action } from "@/lib/user/state";
import { api, post as apiPost, report, ApiError } from "./api";
import type { Decision } from "./Card";

function post(id: string, kind: Action) { apiPost("/api/react", { id, kind }); }

export interface Ghost { item: FeedItem; kind: Decision; style: CSSProperties }
export interface Undo { item: FeedItem; kind: Decision; at: number }

export function useRail() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [idx, setIdx] = useState(-1);   // −1 = splash
  const [since, setSince] = useState<Feed["since"] | null>(null);
  const [profileSize, setProfileSize] = useState(0);
  const idxRef = useRef(idx); idxRef.current = idx;
  const itemsRef = useRef(items); itemsRef.current = items;
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [count, setCount] = useState({ like: 0, skip: 0 });
  const [settle, setSettle] = useState(0);          // vertical page offset in px, animates to 0
  const [animating, setAnimating] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [vh, setVh] = useState(800);
  const seenRef = useRef<Set<string>>(new Set());
  const sentSeen = useRef<Set<string>>(new Set());   // already reported to the server; it remembers
  const reacted = useRef<Map<string, Decision>>(new Map());
  const fetching = useRef(false);
  const busy = useRef(false);   // true while a page/decision animation runs
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    const m = () => setVh(stackRef.current?.clientHeight || window.innerHeight);
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, [loading]);

  const load = useCallback(async (initial = false) => {
    if (fetching.current) return;
    fetching.current = true;
    // Only ids the server hasn't been told about (it persists them); capped well under the schema's 200.
    const pending = Array.from(seenRef.current).filter((id) => !sentSeen.current.has(id)).slice(-150);
    const ex = pending.map((id) => `exclude=${encodeURIComponent(id)}`).join("&");
    let f: Feed;
    try { f = await api<Feed>(`/api/feed?n=30${ex ? "&" + ex : ""}`); for (const id of pending) sentSeen.current.add(id); }
    catch (e) {
      // First load failing is a wall; later loads failing just means the rail stops growing — the user still has cards.
      report(e, "feed"); fetching.current = false;
      if (initial || !itemsRef.current.length) { setLoadErr(e instanceof ApiError ? e.message : "Couldn’t load the feed."); setLoading(false); }
      return;
    }
    setLoadErr(null);
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
  const retry = useCallback(() => { setLoading(true); setLoadErr(null); void load(true); }, [load]);

  const intro = idx < 0;
  const cur = intro ? undefined : items[idx];
  const prev = idx > 0 ? items[idx - 1] : undefined;
  const next = items[idx + 1];

  // Dwelling on a card marks it seen (so it is excluded from future fetches). No reaction is sent.
  useEffect(() => {
    if (!cur) return;
    const t = setTimeout(() => { seenRef.current.add(cur.id); }, 600);
    return () => clearTimeout(t);
  }, [cur]);
  useEffect(() => { if (!loading && items.length - idx <= 8) void load(); }, [idx, items.length, loading, load]);

  /* ---- motion primitives ---- */

  /** Animate the vertical pager from a starting px offset to 0. */
  const settleFrom = useCallback((fromPx: number) => {
    busy.current = true;
    // Commit the start position synchronously, force a style flush so the browser has it as the
    // transition's "from", then commit the end position — all in this task. No rAF hop: a rAF can
    // be a frame or more away on a busy main thread, and that gap reads as a stall before the slide.
    flushSync(() => { setAnimating(false); setSettle(fromPx); });
    void stackRef.current?.getBoundingClientRect();
    flushSync(() => { setAnimating(true); setSettle(0); });
    setTimeout(() => { setAnimating(false); busy.current = false; }, 620);
  }, []);

  /** A touch during a settle animation snaps it to rest instead of being dropped; the finger takes over. */
  const interrupt = useCallback(() => {
    if (busy.current) { busy.current = false; setAnimating(false); setSettle(0); }
  }, []);

  /** Move to another page; the new current card slides in from the side it was on. */
  const go = useCallback((to: number, fromDragDy = 0) => {
    if (to < -1 || to >= items.length || busy.current) return;
    lastTouch.current = Date.now();
    const dir = to > idx ? 1 : -1;               // +1 = advancing (next rises from below)
    setIdx(to);
    // New card is currently at dir*vh; drag already moved it by fromDragDy. Start there, go to 0.
    settleFrom(dir * vh + fromDragDy);
  }, [items.length, idx, vh, settleFrom]);

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
    // Ghost = the card flying out. Next rises via the same settle; if there is no next, the ghost alone carries the gesture.
    const hasNext = idx + 1 < items.length;
    busy.current = true;
    flushSync(() => {
      setGhost({ item: cur, kind, style: { transform: startT, transition: "none" } });
      if (hasNext) { setAnimating(false); setIdx(idx + 1); setSettle(vh); }
    });
    void stackRef.current?.getBoundingClientRect();
    flushSync(() => {
      setGhost((g) => g && { ...g, style: { transform: endT, opacity: 0, transition: "transform .32s cubic-bezier(.2,.7,.3,1), opacity .32s" } });
      if (hasNext) { setAnimating(true); setSettle(0); }
    });
    setTimeout(() => { setGhost(null); setAnimating(false); busy.current = false; }, 620);
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

  /** Hand a card to the rail right after the current one and page onto it. Used by search picks and voice's show_repo. */
  const insertAndGo = useCallback((r: FeedItem) => {
    const f: FeedItem = { ...r, explore: false };
    setItems((q) => {
      const at = Math.max(0, idxRef.current + 1);
      const rest = q.filter((x) => x.id !== f.id);
      return [...rest.slice(0, at), f, ...rest.slice(at)];
    });
    if (r.saved) setSaved((s) => new Set(s).add(r.id));
    // Let the insert render, then page onto it with the usual bounce.
    setTimeout(() => go(idxRef.current + 1), 30);
  }, [go]);

  return {
    // data
    items, idx, cur, prev, next, intro, since, profileSize, loading, loadErr, count, saved, undo, reacted,
    itemsRef, idxRef, lastTouch, stackRef,
    // motion
    settle, animating, ghost, vh, busy,
    // actions
    go, decide, doUndo, toggleSave, insertAndGo, settleFrom, interrupt, retry,
  };
}

export type Rail = ReturnType<typeof useRail>;
