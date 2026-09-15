"use client";
import { useEffect, useState } from "react";
import { lastTrace, type Trace } from "@/lib/voice/trace";

/** /?voicelog=1 — the last voice session's timeline, on the device, no tools needed. Tap to dismiss. */
export function VoiceLog() {
  const [t, setT] = useState<Trace | null | undefined>(undefined);
  useEffect(() => { if (new URLSearchParams(location.search).has("voicelog")) setT(lastTrace()); }, []);
  if (t === undefined) return null;
  const fmt = (ms: number) => `+${(ms / 1000).toFixed(1).padStart(5)}s`;
  return (
    <pre onClick={() => setT(undefined)} style={{ position: "fixed", inset: "auto 0 0 0", maxHeight: "70vh", overflow: "auto", zIndex: 99, margin: 0, padding: "12px 14px calc(14px + env(safe-area-inset-bottom))", background: "#111", color: "#ddd", font: "11.5px/1.45 ui-monospace, Menlo, monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderTop: "2px solid #c4b3ff" }}>
      {!t ? "no voice session recorded on this device" : [
        `${t.mode} · ${new Date(t.startedAt).toLocaleTimeString()} · ${t.endedAt ? Math.round((t.endedAt - t.startedAt) / 1000) + "s" : "still running / died"} · ${t.reason ?? "no end reason"}`,
        `deltas: ${Object.entries(t.deltas).map(([k, n]) => `${k.replace("response.", "")}×${n}`).join("  ") || "none"}`,
        "",
        ...t.entries.map((e) => `${fmt(e.t)}  ${e.k}${e.d !== undefined ? "  " + JSON.stringify(e.d) : ""}`),
      ].join("\n")}
    </pre>
  );
}
