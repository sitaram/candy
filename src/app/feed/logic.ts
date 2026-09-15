/** Pure presentation helpers for the feed. No React, no DOM — so they are unit-testable. */
import type { FeedItem } from "@/lib/user/feed";

export const HUE: Record<string, number> = {
  "ai-llm": 268, "ai-agents": 280, "ml-infra": 255, "dev-tools": 205, cli: 195, "web-framework": 330, frontend: 340,
  backend: 215, database: 30, "data-eng": 45, "devops-infra": 175, security: 0, networking: 185, systems: 20,
  "languages-compilers": 300, mobile: 320, desktop: 240, "games-graphics": 355, science: 150, productivity: 95,
  "learning-resource": 60, "awesome-list": 70, other: 230,
};

export function hueOf(f?: FeedItem): number {
  return f?.item.card ? HUE[f.item.card.category] ?? 230 : 230;
}

/** 999 → "999", 1500 → "1.5k", 12000 → "12k". */
export function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function agoShort(iso: string, now = Date.now()): string {
  if (!iso) return "";
  const d = (now - Date.parse(iso)) / 86_400_000;
  if (Number.isNaN(d)) return "";
  if (d < 1) return "today";
  if (d < 2) return "1d";
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(d < 730 ? 1 : 0)}y`;
}

/** Separate the personal-fit reason from the rest; the UI shows fit as a chip and hides the explore marker. */
export function splitWhy(why: string[]): { fit: string | null; rest: string[] } {
  const fit = why.find((w) => w.startsWith("matches your interest")) ?? null;
  return { fit: fit ? fit.replace("matches your interest in ", "") : null, rest: why.filter((w) => w !== fit && !w.startsWith("outside your usual")) };
}

/** Gesture thresholds, shared by the pointer handler and its tests. */
export const THRESH = 100;      // px to commit a horizontal decision
export const VTHRESH = 90;      // px to commit a vertical page
export const AXIS_LOCK = 10;    // px before we pick an axis

export type Axis = "x" | "y" | null;
export type Intent = "like" | "skip" | "next" | "prev" | "none";

/** Which axis a drag has committed to. null until the pointer has moved AXIS_LOCK px in any direction. Ties go to x. */
export function lockAxis(dx: number, dy: number): Axis {
  if (Math.hypot(dx, dy) <= AXIS_LOCK) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** What a released drag means. `canPrev` is false on the first card; `canNext` false when the rail has no next. */
export function resolveGesture(axis: Axis, dx: number, dy: number, can: { prev: boolean; next: boolean } = { prev: true, next: true }): Intent {
  if (axis === "x") { if (Math.abs(dx) >= THRESH) return dx > 0 ? "like" : "skip"; }
  else if (axis === "y") {
    if (dy <= -VTHRESH && can.next) return "next";
    if (dy >= VTHRESH && can.prev) return "prev";
  }
  return "none";
}

export type Release =
  | { kind: "tap" }
  | { kind: "decide"; decision: "like" | "skip"; dx: number; dy: number }
  | { kind: "page"; dir: 1 | -1; dy: number }
  | { kind: "release"; dy: number; overscroll: boolean }   // y-axis, short of a threshold (or past it with nowhere to go)
  | { kind: "none" };

/** Everything a released pointer can mean, from its total travel. Pure; the hook just dispatches. */
export function classifyRelease(axis: Axis, dx: number, dy: number, can: { prev: boolean; next: boolean }): Release {
  if (!axis && Math.hypot(dx, dy) < 8) return { kind: "tap" };
  const intent = resolveGesture(axis, dx, dy, can);
  switch (intent) {
    case "like": case "skip": return { kind: "decide", decision: intent, dx, dy };
    case "next": return { kind: "page", dir: 1, dy };
    case "prev": return { kind: "page", dir: -1, dy };
  }
  if (axis === "y") return { kind: "release", dy, overscroll: dy <= -VTHRESH && !can.next };
  return { kind: "none" };
}
