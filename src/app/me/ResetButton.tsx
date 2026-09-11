"use client";
import { useState } from "react";

export function ResetButton({ n }: { n: number }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!n) return null;
  if (!arm) return <button className="me-btn" onClick={() => setArm(true)}>reset</button>;
  return (
    <span className="me-confirm">
      <span>Forget {n} {n === 1 ? "reaction" : "reactions"} and start over? Saved items stay.</span>
      <button className="me-btn danger" disabled={busy} onClick={async () => { setBusy(true); await fetch("/api/me/reset", { method: "POST" }); location.reload(); }}>
        {busy ? "…" : "yes, forget"}
      </button>
      <button className="me-btn" onClick={() => setArm(false)}>keep</button>
    </span>
  );
}
