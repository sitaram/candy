"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Discoverability tooltip — for controls whose icon alone doesn't say what they do (the voice buttons).
 * Not a general tooltip system: obvious controls keep a plain `title` and nothing more.
 * Pointer devices: hover only. Touch has no hover, so the tip introduces itself once — a few seconds the first
 * time its control is on screen — then is remembered in localStorage under `tipKey`. Once. Not on focus (a
 * tapped button keeps focus, which re-showed the tip after the session it started), and not again on a later
 * mount of the same key even if the first showing was cut short by the tap.
 * `active={false}` removes the tip entirely (e.g. once a voice session is live, the button is self-evidently "stop").
 *
 *   <Tip label="Hear this page summarized, then ask about it" tipKey="about-voice"><button …/></Tip>
 */
export function Tip({ label, tipKey, side = "bottom", align = "center", active = true, delay = 900, children }: {
  label: ReactNode; tipKey: string; side?: "top" | "bottom"; align?: "start" | "center" | "end";
  active?: boolean; delay?: number; children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
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
      // Mark it seen at *schedule* time. Marking at show time meant a tap inside the 900 ms (which sets
      // active=false and unmounts this effect) left the flag unset — and the tip showed when the session ended.
      try { localStorage.setItem(k, "1"); } catch { /* fine */ }
      t1 = setTimeout(() => {
        setShown(true);
        t2 = setTimeout(() => setShown(false), 3200);
      }, delay);
    }, { threshold: 0.9 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(t1); clearTimeout(t2); };
  }, [tipKey, active, delay]);

  return (
    <span ref={wrap} className={`tip-wrap${shown ? " shown" : ""}`} data-side={side} data-align={align} onPointerDown={() => setShown(false)}>
      {children}
      {active && <span className="tip" role="tooltip">{label}</span>}
    </span>
  );
}
