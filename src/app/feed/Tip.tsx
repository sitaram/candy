"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Discoverability tooltip for icon buttons. On a pointer device it appears on hover/focus like a native
 * title (which we keep for good measure). On touch there is no hover, so each tip introduces itself once:
 * it shows for a few seconds the first time its control is on screen, then never again on that device.
 * `key` names the tip; the once-shown state lives in localStorage under it.
 *
 *   <Tip label="Hear a summary of this page" tipKey="about-voice" side="bottom"><button …/></Tip>
 */
export function Tip({ label, tipKey, side = "bottom", align = "center", intro = true, delay = 900, children }: {
  label: ReactNode; tipKey: string; side?: "top" | "bottom"; align?: "start" | "center" | "end";
  /** Show once unprompted on touch devices. Off for tips that only make sense in a transient state (e.g. "end"). */
  intro?: boolean; delay?: number; children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!intro) return;
    const touch = matchMedia("(hover: none)").matches;
    if (!touch) return;
    const k = `candy:tip:${tipKey}`;
    try { if (localStorage.getItem(k)) return; } catch { return; }
    // Only when the control is actually visible (not a rail card behind the splash).
    const el = wrap.current; if (!el) return;
    let t1: ReturnType<typeof setTimeout> | undefined, t2: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      t1 = setTimeout(() => {
        setShown(true);
        try { localStorage.setItem(k, "1"); } catch { /* fine */ }
        t2 = setTimeout(() => setShown(false), 3200);
      }, delay);
    }, { threshold: 0.9 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(t1); clearTimeout(t2); };
  }, [tipKey, intro, delay]);

  return (
    <span ref={wrap} className={`tip-wrap${shown ? " shown" : ""}`} data-side={side} data-align={align} onPointerDown={() => setShown(false)}>
      {children}
      <span className="tip" role="tooltip">{label}</span>
    </span>
  );
}
