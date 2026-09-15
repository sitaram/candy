"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { SearchResponse, SearchResult } from "@/lib/user/search";
import { useVoice } from "./useVoice";

/**
 * Search sheet: the feed with a query.
 *
 * Type, or tap the bars and say it. Either way the query hits /api/search (name + keyword +
 * embedding lanes, personal ranking) and results render as compact rows with a `why`. Voice is
 * the same Realtime transport as the card conversation, in search mode: one `search` tool whose
 * argument fills the box, one `open_result` tool. Tapping a row hands the item back to the feed,
 * which inserts it after the current card.
 */

const CAT_LABEL: Record<string, string> = {
  "ai-llm": "AI · LLM", "ai-agents": "AI · Agents", "ml-infra": "ML Infra", "dev-tools": "Dev Tools", cli: "CLI",
  "web-framework": "Web Framework", frontend: "Frontend", backend: "Backend", database: "Database", "data-eng": "Data Eng",
  "devops-infra": "DevOps · Infra", security: "Security", networking: "Networking", systems: "Systems",
  "languages-compilers": "Languages", mobile: "Mobile", desktop: "Desktop", "games-graphics": "Games · Graphics",
  science: "Science", productivity: "Productivity", "learning-resource": "Learning", "awesome-list": "Curated List", other: "Other",
};
const HUE: Record<string, number> = {
  "ai-llm": 268, "ai-agents": 280, "ml-infra": 255, "dev-tools": 205, cli: 195, "web-framework": 330, frontend: 340,
  backend: 215, database: 30, "data-eng": 45, "devops-infra": 175, security: 0, networking: 185, systems: 20,
  "languages-compilers": 300, mobile: 320, desktop: 240, "games-graphics": 355, science: 150, productivity: 95,
  "learning-resource": 60, "awesome-list": 70, other: 230,
};
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

const TRY = ["mcp server", "local llm runtime", "e2e browser testing", "rust cli for logs", "voice agent framework", "terminal file manager"];

const I = {
  search: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  voice: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 7v10" /><path d="M20 10v4" /></svg>,
  x: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>,
};

export function Search({ open, onClose, onPick, autoVoice }: { open: boolean; onClose: () => void; onPick: (r: SearchResult) => void; autoVoice?: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState("");   // what the user said, until the model's query lands
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const ranFor = useRef<string | null>(null);   // last query handed to run(); the debounce skips it
  const resRef = useRef<SearchResponse | null>(null); resRef.current = res;

  const run = useCallback(async (query: string): Promise<SearchResponse | null> => {
    const my = ++seq.current;
    ranFor.current = query;
    if (query.trim().length < 2) { setRes(null); return null; }
    setBusy(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}&n=20`);
      const j = (await r.json()) as SearchResponse;
      if (my !== seq.current) return null;
      setRes(j);
      return j;
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, []);

  // Typing: debounce 220 ms. Skipped when run() was already called for this exact q (voice tool
  // call), otherwise the debounced run would supersede the tool's own fetch and it would report
  // "no results" while the screen showed twenty.
  useEffect(() => {
    if (!open) return;
    if (ranFor.current === q) return;
    const t = setTimeout(() => void run(q), 220);
    return () => clearTimeout(t);
  }, [q, open, run]);

  // Focus on open; reset on close.
  useEffect(() => {
    if (open) {
      // Opened from the header's voice button: skip the keyboard and start listening at once.
      if (autoVoice) void voice.start({ mode: "search" });
      else setTimeout(() => inputRef.current?.focus(), 60);
    } else { setQ(""); setRes(null); setHeard(""); ranFor.current = null; }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- voice: same transport, search mode ---- */
  const voice = useVoice({
    silenceMs: 8_000,
    onUserTranscript: (t) => { if (t) setHeard(t); },
    onSearch: async (query) => {
      setHeard("");
      setQ(query);
      inputRef.current?.blur();          // keyboard down; results take the screen
      const j = await run(query);
      if (!j || !j.results.length) return `No results for "${query}".`;
      return `${j.results.length} results for "${query}" (best first):\n` +
        j.results.slice(0, 6).map((r, i) => `${i + 1}. ${r.item.repo.id} — ${r.item.card?.pitch ?? r.item.repo.description} (${fmt(r.item.repo.stars)}★; ${r.why[0]})`).join("\n");
    },
    onOpenResult: async (which) => {
      const list = resRef.current?.results ?? [];
      if (!list.length) return "Nothing on screen to open.";
      const n = parseInt(which, 10);
      const pick = !isNaN(n) && n >= 1 && n <= list.length
        ? list[n - 1]
        : list.find((r) => r.item.repo.name.toLowerCase().includes(which.toLowerCase()) || r.id.toLowerCase().includes(which.toLowerCase()));
      if (!pick) return `No result matching "${which}".`;
      onPick(pick);
      return `Opened ${pick.item.repo.name}.`;
    },
  });
  const toggleVoice = () => { if (voice.active) voice.stop(); else void voice.start({ mode: "search", query: q || undefined }); };
  useEffect(() => { if (!open && voice.active) voice.stop(); }, [open, voice]);

  if (!open) return null;
  const listening = voice.active;
  const showTry = !q && !res;

  return (
    <div className="search-host">
      <div className="scrim" onPointerDown={onClose} />
      <div className="search" role="dialog" aria-label="Search">
        <div className="s-bar">
          <span className="s-ico">{I.search}</span>
          <input ref={inputRef} className="s-input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={listening ? (voice.state === "connecting" ? "connecting…" : "listening…") : "a repo, or what you want to build"}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") { inputRef.current?.blur(); void run(q); } }} />
          {q && !listening && <button className="s-clear" onClick={() => { setQ(""); setRes(null); inputRef.current?.focus(); }} aria-label="Clear">{I.x}</button>}
          <button className={`s-voice${listening ? ` on ${voice.state}` : ""}`} style={{ "--lvl": voice.level } as CSSProperties}
            onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Search by voice"} title="Search by voice">
            {listening ? <span className="stop" aria-hidden /> : I.voice}
          </button>
          <button className="s-cancel" onClick={onClose}>cancel</button>
        </div>

        {voice.error && <div className="s-note err">{voice.error}</div>}
        {listening && heard && !voice.transcript && <div className="s-note heard">“{heard}”</div>}
        {listening && voice.transcript && <div className="s-note">{voice.transcript}</div>}

        <div className="s-body">
          {showTry && (
            <>
              <div className="s-label">try</div>
              <div className="s-try">{TRY.map((t) => <button key={t} className="chip" onClick={() => setQ(t)}>{t}</button>)}</div>
              <div className="s-hint">Type a repo name, or describe what you want to build. Tap the bars to say it.</div>
            </>
          )}
          {res && res.results.length === 0 && !busy && (
            <div className="s-empty">Nothing close to “{res.q}”.<br /><span>Try different words, or describe what it should do.</span></div>
          )}
          {res && res.results.length > 0 && (
            <>
              <div className="s-label">
                {res.results.length} result{res.results.length === 1 ? "" : "s"}
                {res.semantic ? "" : <span className="s-dim"> · by name and tags</span>}
                {busy && <span className="s-dim"> · updating…</span>}
              </div>
              <ul className="s-list">
                {res.results.map((r, i) => {
                  const c = r.item.card; const rp = r.item.repo; const hue = c ? HUE[c.category] ?? 230 : 230;
                  return (
                    <li key={r.id}>
                      <button className="s-row" style={{ "--hue": hue } as CSSProperties} onClick={() => onPick(r)}>
                        <span className="s-n">{i + 1}</span>
                        <span className="s-main">
                          <span className="s-head">
                            <span className="s-name">{rp.name}</span>
                            <span className="s-owner">{rp.owner}</span>
                            <span className="s-stars">{fmt(rp.stars)}★</span>
                          </span>
                          <span className="s-pitch">{c?.pitch ?? rp.description}</span>
                          <span className="s-why">
                            {c && <span className="s-cat">{CAT_LABEL[c.category] ?? c.category}</span>}
                            <span className={`s-match ${r.match}`}>{r.why[0]}</span>
                            {r.why[1] && <span className="s-why2">{r.why[1]}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
