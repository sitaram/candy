"use client";
import { useEffect, useRef, useState } from "react";

const STARTERS = ["How does it actually work?", "What changed in the last release?", "What are its limits?", "Is it production-ready?", "How do I install it?"];

/** Typed Q&A over the full README, releases, manifest, and mentions of one repo. Threaded; history goes back with each question. */
export function AskBox({ id }: { id: string }) {
  const [q, setQ] = useState("");
  const [thread, setThread] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setThread([]); setQ(""); setErr(null); }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [thread.length, busy]);

  const ask = async (question: string) => {
    const t = question.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null); setQ("");
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, question: t, history: thread }) });
      const j = (await r.json()) as { answer?: string; error?: string };
      if (!r.ok || !j.answer) throw new Error(j.error ?? `ask ${r.status}`);
      setThread((th) => [...th, { q: t, a: j.answer! }]);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="ask">
      <h3>Ask this repo</h3>
      <p className="ask-sub">Answers come from the full README, release notes, manifest, and mentions — not a summary.</p>
      {thread.map((x, i) => (
        <div key={i} className="ask-turn">
          <div className="ask-q">{x.q}</div>
          <div className="ask-a">{x.a.split(/\n{2,}/).map((p, j) => <p key={j}>{p}</p>)}</div>
        </div>
      ))}
      {busy && <div className="ask-turn"><div className="ask-q">{q || "…"}</div><div className="ask-a ask-wait">reading the README…</div></div>}
      {err && <div className="ask-err">{err}</div>}
      {thread.length === 0 && !busy && (
        <div className="ask-starters">{STARTERS.map((s) => <button key={s} onClick={() => void ask(s)}>{s}</button>)}</div>
      )}
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={thread.length ? "Follow up…" : "Ask anything about it…"} disabled={busy} enterKeyHint="send" />
        <button type="submit" disabled={busy || !q.trim()} aria-label="Ask">↑</button>
      </form>
      <div ref={endRef} />
    </div>
  );
}
