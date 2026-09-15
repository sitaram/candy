"use client";

import { api, report, ApiError } from "./api";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { HUE } from "./logic";
import type { SearchResponse, SearchResult } from "@/lib/user/search";
import { useVoice } from "./useVoice";
import { guarded } from "@/lib/voice/trace";
import { VoiceBoundary } from "./VoiceBoundary";

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
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

const TRY = ["mcp server", "local llm runtime", "e2e browser testing", "rust cli for logs", "voice agent framework", "terminal file manager"];

const I = {
  back: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>,
  search: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  voice: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 7v10" /><path d="M20 10v4" /></svg>,
  x: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  mic: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>,
  micOff: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 9v2a3 3 0 0 0 5.1 2.1" /><path d="M15 9.3V6a3 3 0 0 0-6 0" /><path d="M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8" /><path d="M12 18v3" /><path d="m3 3 18 18" /></svg>,
};

export function Search({ open, onClose, onPick, autoVoice }: { open: boolean; onClose: () => void; onPick: (r: SearchResult, opts?: { voice: boolean }) => void; autoVoice?: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
      const j = await api<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}&n=20`);
      if (my !== seq.current) return null;
      setErr(null); setRes(j);
      return j;
    } catch (e) {
      if (my === seq.current) { report(e, "search"); setErr(e instanceof ApiError ? e.message : "Search failed."); }
      return null;
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
    silenceMs: 20_000,   // measured from the end of the model's *playback*; 8 s was ending sessions while people were still deciding what to say
    onUserTranscript: (t) => { try { if (t) setHeard(t); } catch { /* never let UI state throw into the event loop */ } },
    onSearch: guarded("search", async (query: string) => {
      setHeard("");
      setQ(query);
      inputRef.current?.blur();          // keyboard down; results take the screen
      const j = await run(query);
      if (!j || !j.results.length) return `No results for "${query}".`;
      return `${j.results.length} results for "${query}" (best first):\n` +
        j.results.slice(0, 6).map((r, i) => `${i + 1}. ${r.item.repo.id} — ${r.item.card?.pitch ?? r.item.repo.description} (${fmt(r.item.repo.stars)}★; ${r.why[0]})`).join("\n");
    }),
    onOpenResult: guarded("open_result", async (which: string) => {
      const list = resRef.current?.results ?? [];
      if (!list.length) return "Nothing on screen to open.";
      const n = parseInt(which, 10);
      const pick = !isNaN(n) && n >= 1 && n <= list.length
        ? list[n - 1]
        : list.find((r) => r.item.repo.name.toLowerCase().includes(which.toLowerCase()) || r.id.toLowerCase().includes(which.toLowerCase()));
      if (!pick) return `No result matching "${which}".`;
      // Hand the conversation to the card: this search session ends when the sheet unmounts, and the
      // feed starts a card-mode session on the repo we just opened. Say nothing — the new session opens.
      onPick(pick, { voice: true });
      return `Opened ${pick.item.repo.name}. The card's own guide takes over now; do not say anything further.`;
    }),
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
        <header className="s-head-bar">
          <button className="s-back" onClick={onClose} aria-label="Back to feed">{I.back}</button>
          <span className="s-title">Search</span>
          <span className="s-title-sub">{res && res.results.length > 0 ? `${res.results.length} result${res.results.length === 1 ? "" : "s"}` : "the whole corpus"}</span>
        </header>
        <div className={`s-bar${listening ? " listening" : ""}`}>
          <span className="s-ico">{I.search}</span>
          <input ref={inputRef} className="s-input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={listening ? (voice.state === "connecting" ? "connecting…" : "listening…") : "a repo, or what you want to build"}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") { inputRef.current?.blur(); void run(q); } }} />
          {q && !listening && <button className="s-clear" onClick={() => { setQ(""); setRes(null); inputRef.current?.focus(); }} aria-label="Clear">{I.x}</button>}
          <VoiceBoundary where="search-bar" fallback={null}>
          {listening && (
            <button className={`s-voice sub mute${voice.muted ? " off" : ""}`} onClick={voice.toggleMute} aria-label={voice.muted ? "Unmute" : "Mute"} title={voice.muted ? "Unmute" : "Mute"}>
              {voice.muted ? I.micOff : I.mic}
            </button>
          )}
          <button className={`s-voice${listening ? ` on ${voice.state}` : ""}`}
            onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Search by voice"} title={listening ? "Stop" : "Search by voice"}>
            {listening ? <span className="stop" aria-hidden /> : I.voice}
          </button>
          </VoiceBoundary>
        </div>

        <VoiceBoundary where="search-notes" fallback={null}>
          {voice.error && <div className="s-note err">{voice.error}</div>}
          {listening && heard && !voice.transcript && <div className="s-note heard">“{heard}”</div>}
          {listening && voice.transcript && <div className="s-note">{voice.transcript}</div>}
        </VoiceBoundary>

        <div className="s-body">
          {showTry && (
            <div className="s-intro">
              <h2>Find a project by name, or by what you need it to do.</h2>
              <p>Searches names, pitches, tags — and meaning, so “something like playwright but for mobile” works. Tap the bars to say it instead.</p>
              <div className="s-label">try</div>
              <div className="s-try">{TRY.map((t) => <button key={t} className="chip" onClick={() => setQ(t)}>{t}</button>)}</div>
            </div>
          )}
          {err && !busy && <div className="s-empty" role="alert">{err}<br /><span>Check your connection and try again.</span></div>}
          {res && res.results.length === 0 && !busy && !err && (
            <div className="s-empty">Nothing close to “{res.q}”.<br /><span>Try different words, or describe what it should do.</span></div>
          )}
          {res && res.results.length > 0 && (
            <>
              <div className="s-label">
                for “{res.q}”
                {res.semantic ? "" : <span className="s-dim"> · by name and tags</span>}
                {busy && <span className="s-dim"> · updating…</span>}
              </div>
              <ul className="s-list">
                {res.results.map((r, i) => {
                  const c = r.item.card; const rp = r.item.repo; const hue = c ? HUE[c.category] ?? 230 : 230;
                  return (
                    <li key={r.id}>
                      <button className="s-row" style={{ "--hue": hue } as CSSProperties} onClick={() => onPick(r, { voice: voice.active })}>
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
