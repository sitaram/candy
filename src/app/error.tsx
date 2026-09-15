"use client";
import { useEffect } from "react";
import { ship } from "./feed/errship";

/**
 * Route error boundary. Replaces Next's opaque "Application error" with the actual message and a
 * one-tap recovery, and logs the stack so a phone crash can be read from the desktop console
 * (Safari → Develop → iPhone) or pasted from the screen.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[candy] route error", error); ship({ where: "error-boundary", msg: error.message, stack: error.stack, extra: error.digest ? { digest: error.digest } : undefined }); }, [error]);
  const stack = (error.stack ?? "").split("\n").slice(0, 6).join("\n");
  return (
    <main style={{ minHeight: "100dvh", padding: "calc(24px + env(safe-area-inset-top)) 22px 40px", background: "#0b0b0f", color: "#e8e8ec", fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#8a8a90", marginBottom: 10 }}>something broke</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", margin: "0 0 14px", lineHeight: 1.2, overflowWrap: "anywhere" }}>{error.message || "Unknown error"}</h1>
      {error.digest && <div style={{ fontSize: 12, color: "#8a8a90", marginBottom: 10 }}>digest {error.digest}</div>}
      <pre style={{ fontSize: 11.5, lineHeight: 1.45, color: "#a8a8b0", background: "rgba(255,255,255,.05)", borderRadius: 12, padding: "12px 14px", overflowX: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "0 0 20px" }}>{stack}</pre>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={reset} style={{ font: "inherit", fontSize: 15, fontWeight: 600, padding: "10px 18px", borderRadius: 999, border: "none", background: "#c4b3ff", color: "#0b0b0f" }}>try again</button>
        <a href="/" style={{ font: "inherit", fontSize: 15, fontWeight: 600, padding: "10px 18px", borderRadius: 999, background: "rgba(255,255,255,.08)", color: "#e8e8ec", textDecoration: "none" }}>back to feed</a>
      </div>
    </main>
  );
}
