"use client";
import { useEffect } from "react";
import { ship } from "./feed/errship";

const KEY = "candy:lastCrash";

/**
 * Keeps the last uncaught error across the reload Next does after an "Application error", so it can
 * be read afterwards: open /?crash=1 to see it. Also ships each one to /api/err (see `pnpm errors`).
 */
export function CrashLog() {
  useEffect(() => {
    const save = (kind: string, msg: string, stack?: string) => {
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), kind, msg, stack: (stack ?? "").split("\n").slice(0, 8).join("\n"), url: location.href })); } catch { /* full */ }
    };
    const onErr = (e: ErrorEvent) => { save("error", e.message, e.error?.stack); ship({ where: "window", msg: e.message, stack: e.error?.stack }); };
    const onRej = (e: PromiseRejectionEvent) => { const m = String(e.reason?.message ?? e.reason); save("rejection", m, e.reason?.stack); ship({ where: "unhandledrejection", msg: m, stack: e.reason?.stack }); };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    if (new URLSearchParams(location.search).has("crash")) {
      const raw = localStorage.getItem(KEY);
      const el = document.createElement("pre");
      el.style.cssText = "position:fixed;inset:auto 0 0 0;max-height:60vh;overflow:auto;z-index:99;margin:0;padding:14px 16px calc(14px + env(safe-area-inset-bottom));background:#111;color:#eee;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;border-top:2px solid #f08a8a";
      el.textContent = raw ? (() => { const c = JSON.parse(raw); return `${new Date(c.at).toLocaleString()} · ${c.kind}\n${c.url}\n\n${c.msg}\n\n${c.stack}`; })() : "no crash recorded";
      el.onclick = () => el.remove();
      document.body.appendChild(el);
    }
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);
  return null;
}
