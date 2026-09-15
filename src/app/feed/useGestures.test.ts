/**
 * The gesture hook's state machine, driven without a DOM: React's hook is a function of (state, handlers),
 * so we call it through a tiny harness that replays useState/useRef and feed it synthetic pointer events.
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { useGestures, type GestureHandlers } from "./useGestures";

// Minimal hook runner: enough of React's dispatcher for useState/useRef in one synchronous render loop.
function runHook<T>(fn: () => T): { get: () => T } {
  const states: unknown[] = []; const refs: { current: unknown }[] = []; let si = 0, ri = 0; let out!: T;
  const render = () => {
    si = 0; ri = 0;
    const d = {
      useState: (init: unknown) => { const i = si++; if (states.length <= i) states.push(typeof init === "function" ? (init as () => unknown)() : init); return [states[i], (v: unknown) => { states[i] = typeof v === "function" ? (v as (p: unknown) => unknown)(states[i]) : v; render(); }]; },
      useRef: (init: unknown) => { const i = ri++; if (refs.length <= i) refs.push({ current: init }); return refs[i]; },
    };
    // @ts-expect-error internal
    const R = React.__SECRET_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ?? React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const prev = R.H; R.H = { ...(prev ?? {}), ...d };
    try { out = fn(); } finally { R.H = prev; }
  };
  render();
  return { get: () => out };
}

const ev = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id, currentTarget: { setPointerCapture: () => {} } }) as unknown as React.PointerEvent<HTMLElement>;

function harness(over: Partial<GestureHandlers> = {}) {
  const h: GestureHandlers = { canStart: () => true, onTap: vi.fn(), onDecide: vi.fn(), onPage: vi.fn(), onRelease: vi.fn(), onOverscroll: vi.fn(), can: () => ({ prev: true, next: true }), ...over };
  const hook = runHook(() => useGestures(h));
  return { h, g: () => hook.get() };
}

describe("useGestures", () => {
  it("a short press-and-release is a tap", () => {
    const { h, g } = harness();
    g().onDown(ev(100, 100)); g().onMove(ev(102, 101)); g().onUp(ev(102, 101));
    expect(h.onTap).toHaveBeenCalledTimes(1);
    expect(g().drag.active).toBe(false);
  });
  it("a long horizontal drag decides; the axis locks after AXIS_LOCK px and stays locked", () => {
    const { h, g } = harness();
    g().onDown(ev(100, 100)); g().onMove(ev(120, 100)); expect(g().drag.axis).toBe("x");
    g().onMove(ev(150, 180));                                  // more y than x now, but locked to x
    expect(g().drag.axis).toBe("x");
    g().onUp(ev(230, 180));
    expect(h.onDecide).toHaveBeenCalledWith("like", { dx: 130, dy: 80 });
  });
  it("pointercancel never classifies: a tiny cancelled drag is not a tap, a y-drag glides back, and state resets", () => {
    const { h, g } = harness();
    g().onDown(ev(100, 100)); g().onMove(ev(103, 104)); g().onCancel(ev(103, 104));
    expect(h.onTap).not.toHaveBeenCalled(); expect(h.onDecide).not.toHaveBeenCalled(); expect(h.onPage).not.toHaveBeenCalled();
    expect(g().drag.active).toBe(false);
    g().onDown(ev(100, 100)); g().onMove(ev(100, 40)); g().onCancel(ev(100, 40));   // past VTHRESH upward — onUp would have paged
    expect(h.onPage).not.toHaveBeenCalled();
    expect(h.onRelease).toHaveBeenCalledWith(-60);
  });
  it("ignores a second pointer and events from a pointer it did not start with", () => {
    const { h, g } = harness();
    g().onDown(ev(100, 100, 1)); g().onMove(ev(300, 100, 2)); g().onUp(ev(300, 100, 2));
    expect(h.onDecide).not.toHaveBeenCalled(); expect(g().drag.active).toBe(true);   // pointer 1 still down
    g().onUp(ev(100, 100, 1)); expect(h.onTap).toHaveBeenCalledTimes(1);
  });
  it("canStart() false means the touch is ignored entirely", () => {
    const { h, g } = harness({ canStart: () => false });
    g().onDown(ev(0, 0)); g().onUp(ev(0, 0));
    expect(h.onTap).not.toHaveBeenCalled(); expect(g().drag.active).toBe(false);
  });
  it("peek: a tap pages forward; a drag from the peek hands off to the card", () => {
    const { h, g } = harness();
    g().peek.onPointerDown(ev(50, 700)); g().peek.onPointerUp(ev(52, 702));
    expect(h.onPage).toHaveBeenCalledWith(1, 0);
    g().peek.onPointerDown(ev(50, 700)); g().peek.onPointerMove(ev(50, 600)); g().peek.onPointerUp(ev(50, 580));
    expect(h.onPage).toHaveBeenLastCalledWith(1, -120);
  });
});
