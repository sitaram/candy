"use client";

/**
 * Pointer → intent. Locks to an axis after a few px; x decides (like / skip), y pages (next / prev),
 * a short tap opens. Owns only the live drag offset; what an intent *does* is the caller's.
 *
 * The peek strip reuses the same handlers, with one twist: a tap there pages forward instead of opening.
 */

import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { lockAxis, classifyRelease, type Axis } from "./logic";

export interface Drag { dx: number; dy: number; axis: Axis; active: boolean }
const REST: Drag = { dx: 0, dy: 0, axis: null, active: false };

export interface GestureHandlers {
  /** Return false to ignore the touch (a sheet is open, nothing on screen…). Called first on every pointerdown. */
  canStart: () => boolean;
  onTap: () => void;
  onDecide: (kind: "like" | "skip", drag: { dx: number; dy: number }) => void;
  /** Page by +1 / −1. `dy` is where the finger left the card so the slide continues from there. */
  onPage: (dir: 1 | -1, dy: number) => void;
  /** Released short of a threshold on the y axis: glide back to rest from `dy`. */
  onRelease: (dy: number) => void;
  /** Swiped up when there was no next card (e.g. splash before the feed landed). */
  onOverscroll?: () => void;
  can: () => { prev: boolean; next: boolean };
}

type PE = RPointerEvent<HTMLElement>;

export function useGestures(h: GestureHandlers) {
  const [drag, setDrag] = useState<Drag>(REST);
  const start = useRef<{ x: number; y: number; id: number; axis: Axis } | null>(null);
  const peekDown = useRef<{ x: number; y: number } | null>(null);
  const reset = () => { start.current = null; setDrag(REST); };

  const onDown = (e: PE) => {
    if (!h.canStart()) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ dx: 0, dy: 0, axis: null, active: true });
  };
  const onMove = (e: PE) => {
    const st = start.current;
    if (!st || st.id !== e.pointerId) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.axis) st.axis = lockAxis(dx, dy);
    setDrag({ dx, dy, axis: st.axis, active: true });
  };
  const onUp = (e: PE) => {
    const st = start.current;
    if (!st || st.id !== e.pointerId) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    start.current = null;
    setDrag(REST);
    const r = classifyRelease(st.axis, dx, dy, h.can());
    switch (r.kind) {
      case "tap": h.onTap(); break;
      case "decide": h.onDecide(r.decision, { dx: r.dx, dy: r.dy }); break;
      case "page": h.onPage(r.dir, r.dy); break;
      case "release": if (r.overscroll) h.onOverscroll?.(); h.onRelease(r.dy); break;
    }
  };

  /**
   * The browser took the pointer (iOS scroll takeover, a system gesture, the tab losing focus mid-drag).
   * Nothing the finger did after that is known, so nothing is decided: glide back from wherever we were.
   * Treating this like a release once let a scroll takeover register as a tap and open the deep dive.
   */
  const onCancel = (e: PE) => {
    const st = start.current;
    if (!st || st.id !== e.pointerId) return;
    const dy = e.clientY - st.y;
    reset();
    if (st.axis === "y") h.onRelease(dy);
  };

  /** Handlers for the peek strip: a tap pages forward; a drag hands off to the card so "swipe up from the peek" still works. */
  const peek = {
    onPointerDown: (e: PE) => { peekDown.current = { x: e.clientX, y: e.clientY }; onDown(e); },
    onPointerMove: onMove,
    onPointerUp: (e: PE) => {
      const p = peekDown.current; peekDown.current = null;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) { reset(); h.onPage(1, 0); return; }
      onUp(e);
    },
    onPointerCancel: (e: PE) => { peekDown.current = null; onCancel(e); },
  };

  return { drag, onDown, onMove, onUp, onCancel, peek, isDragging: () => !!start.current };
}
