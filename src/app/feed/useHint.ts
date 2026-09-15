"use client";

/**
 * The gesture breath: the card leans right, left, then lifts — no words. Once right after the first
 * content card lands (so the gesture is seen before it is needed), then once per idle minute.
 * Mobile only; never while a finger is down, an animation runs, the tab is hidden, or a sheet is open.
 */

import { useEffect, useState, type MutableRefObject } from "react";

const BREATH_MS = 3200;
const FIRST_AFTER_MS = 900;   // after the bounce-in settles

export function useHint(opts: {
  idx: number;
  active: boolean;                          // a card is on screen and no sheet is open
  lastTouch: MutableRefObject<number>;
  isDragging: () => boolean;
  isBusy: () => boolean;
}) {
  const { idx, active, lastTouch, isDragging, isBusy } = opts;
  const [hinting, setHinting] = useState(false);
  const [breathed, setBreathed] = useState(false);
  const desktop = () => window.matchMedia("(min-width: 900px)").matches;
  const every = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("hintfast") ? 4_000 : 60_000;

  // First content card.
  useEffect(() => {
    if (idx !== 0 || breathed || !active) return;
    setBreathed(true);
    const t = setTimeout(() => {
      if (isDragging() || document.hidden || desktop()) return;
      lastTouch.current = Date.now();
      setHinting(true);
      setTimeout(() => setHinting(false), BREATH_MS);
    }, FIRST_AFTER_MS);
    return () => clearTimeout(t);
  }, [idx, active, breathed, isDragging, lastTouch]);

  // Then once a minute of stillness.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (Date.now() - lastTouch.current < every - 500) return;
      if (isDragging() || isBusy() || document.hidden || desktop()) return;
      lastTouch.current = Date.now();            // one breath per idle minute, not one per second
      setHinting(true);
      setTimeout(() => setHinting(false), BREATH_MS);
    }, 1000);
    return () => clearInterval(t);
  }, [active, every, isDragging, isBusy, lastTouch]);

  return { hinting, stopHint: () => setHinting(false) };
}
