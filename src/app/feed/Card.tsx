"use client";

import type { CSSProperties } from "react";
import type { FeedItem } from "@/lib/user/feed";
import { hueOf, fmt, agoShort, splitWhy } from "./logic";
import { VoiceBoundary } from "./VoiceBoundary";
import { Tip } from "./Tip";

export type Decision = "like" | "skip";

/* ---------- icons (inline, no deps) ---------- */
export const I = {
  bookmark: (filled: boolean) => <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>,
  // live-voice bars — the glyph Siri / ChatGPT Voice / Gemini Live use for a real-time conversation
  voice: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 7v10" /><path d="M20 10v4" /></svg>,
  search: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  mic: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>,
  micOff: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 9v2a3 3 0 0 0 5.1 2.1" /><path d="M15 9.3V6a3 3 0 0 0-6 0" /><path d="M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8" /><path d="M12 18v3" /><path d="m3 3 18 18" /></svg>,
  // profile: person in a ring — the one glyph every phone user reads as "you", at the same stroke weight as search
  me: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="10" r="3.2" /><path d="M5.8 18.6c1.4-2.4 3.6-3.6 6.2-3.6s4.8 1.2 6.2 3.6" /></svg>,
  // "maximize": two diagonal corner arrows — reads as "open this up"
  open: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="M9 21H3v-6" /><path d="m3 21 7-7" /></svg>,
};

/* ---------- card ---------- */
export const CAT_LABEL: Record<string, string> = {
  "ai-llm": "AI · LLM", "ai-agents": "AI · Agents", "ml-infra": "ML Infra", "dev-tools": "Dev Tools", cli: "CLI",
  "web-framework": "Web Framework", frontend: "Frontend", backend: "Backend", database: "Database", "data-eng": "Data Eng",
  "devops-infra": "DevOps · Infra", security: "Security", networking: "Networking", systems: "Systems",
  "languages-compilers": "Languages", mobile: "Mobile", desktop: "Desktop", "games-graphics": "Games · Graphics",
  science: "Science", productivity: "Productivity", "learning-resource": "Learning", "awesome-list": "Curated List", other: "Other",
};
const HOOK_LABEL: Record<string, string> = {
  "major-release": "Major release", "big-org": "Backed by a major org", viral: "Going viral", "license-change": "License changed",
  "novel-approach": "Novel approach", "fills-gap": "Fills a gap", "new-project": "Brand new",
};


export function Card({
  f, style, className, debug, saved, reaction, onSave, onOpen, onVoice, voice,
}: {
  f: FeedItem; style?: CSSProperties; className?: string; debug?: boolean; saved?: boolean; reaction?: Decision;
  onSave?: () => void; onOpen?: () => void; onVoice?: () => void; voice?: { state: string; active?: boolean; level: number; muted?: boolean; toggleMute?: () => void };
}) {
  const c = f.item.card;
  const r = f.item.repo;
  const [owner, name] = f.id.split("/");
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const { fit, rest } = splitWhy(f.why);

  // Up to three reasons, in the order the ranker weighs them: your fit, then what is happening, then who noticed.
  const ageD = (Date.now() - Date.parse(r.createdAt)) / 86_400_000;
  const reasons: { t: string; k?: string }[] = [];
  if (f.explore) reasons.push({ t: "✦ exploring", k: "explore" });
  if (fit) reasons.push({ t: fit, k: "fit" });
  if (ageD < 14) reasons.push({ t: `new · ${agoShort(r.createdAt)} old${r.starsPerDay >= 5 ? ` · +${fmt(Math.round(r.starsPerDay))}/day` : ""}`, k: "hot" });
  else if (c?.hook === "viral" || r.starsPerDay >= 50) reasons.push({ t: `+${fmt(Math.round(r.starsPerDay))} stars/day`, k: "hot" });
  else if (r.latestReleaseAt && (Date.now() - Date.parse(r.latestReleaseAt)) / 86_400_000 < 14) reasons.push({ t: `released ${agoShort(r.latestReleaseAt)} ago`, k: "hot" });
  const hook = c && c.hook !== "none" && c.hook !== "big-org" && c.hook !== "viral" && c.hook !== "new-project" ? HOOK_LABEL[c.hook] : null;
  if (hook) reasons.push({ t: hook });
  const social = rest.find((w) => w.startsWith("on "));
  if (social) reasons.push({ t: social.replace("Hacker News", "HN").replace(" and ", " + "), k: "social" });

  // Four-up snapshot: popularity, momentum, age, activity. Labels short enough never to wrap.
  const rel = r.latestReleaseAt ? agoShort(r.latestReleaseAt) : "";
  const stats: { v: string; k: string }[] = [
    { v: fmt(r.stars), k: "stars" },
    { v: r.starsPerDay >= 1 ? `+${fmt(Math.round(r.starsPerDay))}` : "—", k: "per day" },
    { v: agoShort(r.createdAt), k: "old" },
    r.latestRelease
      ? { v: r.latestRelease.replace(/^v(?=\d)/, "").slice(0, 8), k: rel === "today" ? "today" : `${rel} ago` }
      : { v: agoShort(r.pushedAt), k: "last push" },
  ];

  const hue = hueOf(f);
  return (
    <article className={`fcard ${className ?? ""}`} style={{ ...style, "--hue": hue, "--hue2": (hue + 40) % 360 } as CSSProperties}>
      <header className="c-head">
        <span className="c-cat">{c ? CAT_LABEL[c.category] ?? c.category : ""}{r.language && <span className="c-lang"> · {r.language}</span>}</span>
        <span className="c-spacer" />
        {reaction && <span className={`c-reacted ${reaction}`}>{reaction === "like" ? "👍" : "👎"}</span>}
        <button className={`icon-btn bm${saved ? " on" : ""}`} onPointerDown={stop} onClick={(e) => { stop(e); onSave?.(); }} aria-label={saved ? "Remove bookmark" : "Bookmark"} title="Bookmark (b)">
          {I.bookmark(!!saved)}
        </button>
      </header>

      <h1 className="c-title">
        <span className="c-owner">{owner}</span>
        <span className="c-name">{name}</span>
      </h1>

      <p className="c-pitch">{c?.pitch ?? r.description}</p>

      {reasons.length > 0 && (
        <div className="c-why">
          {reasons.slice(0, 3).map((x) => <span key={x.t} className={`chip${x.k ? ` ${x.k}` : ""}`}>{x.t}</span>)}
        </div>
      )}

      {c?.whyCare && <p className="c-body">{c.whyCare}</p>}

      <div className="fcard-spacer" />

      <div className="c-stats">
        {stats.map((st) => (
          <div key={st.k} className="c-stat"><div className="c-stat-v">{st.v}</div><div className="c-stat-k">{st.k}</div></div>
        ))}
      </div>
      {debug && <div className="fcard-dbg">score {f.score} · fit {f.fit}</div>}

      <div className="fcard-actions" onPointerDown={stop}>
        <button className="act dive" onClick={onOpen} aria-label="Deep dive" title="Deep dive (enter, or tap the card)">{I.open}</button>
        <VoiceBoundary where="card-actions" fallback={<button className="act voice" disabled aria-label="Voice unavailable" title="Voice unavailable">{I.voice}</button>}>
        <div className={`voice-cluster${voice && (voice.active ?? voice.state !== "idle") ? " on" : ""}`}>
          <Tip label="Talk about this project" tipKey="card-voice" side="top" active={!(voice && (voice.active ?? voice.state !== "idle"))} delay={1800}>
            <button className={`act voice${voice && (voice.active ?? voice.state !== "idle") ? ` on ${voice.state}` : ""}`}
              onClick={(e) => { e.stopPropagation(); onVoice?.(); }} aria-label={voice && (voice.active ?? voice.state !== "idle") ? "End conversation" : "Talk about this"} title={voice && (voice.active ?? voice.state !== "idle") ? "End (v)" : "Talk about this (v)"}>
              {voice && (voice.active ?? voice.state !== "idle") ? <span className="stop" aria-hidden /> : I.voice}
            </button>
          </Tip>
          {voice && (voice.active ?? voice.state !== "idle") && (
            <button className={`act sub mute${voice.muted ? " off" : ""}`} onClick={(e) => { e.stopPropagation(); voice.toggleMute?.(); }} aria-label={voice.muted ? "Unmute" : "Mute"} title={voice.muted ? "Unmute" : "Mute"}>
              {voice.muted ? I.micOff : I.mic}
            </button>
          )}
        </div>
        </VoiceBoundary>
      </div>
      <div className="stamp like">YES</div>
      <div className="stamp skip">NOPE</div>
    </article>
  );
}

/* ---------- splash: page −1 on the rail ---------- */
export function Splash({ style, onStart }: { style?: CSSProperties; onStart: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <section className="fcard splash" style={style}>
      <div className="sp-top">
        <div className="sp-brand">candy</div>
        <div className="sp-line">Open source worth your time.</div>
      </div>

      {/* Middle block: what it does, then how you drive it. The grid is explanation, so it lives with the
          claims — not down with the calls to action, where it made the bottom third dense and the middle hollow. */}
      <div className="sp-mid">
        <ul className="sp-claims">
          <li><b>Discover.</b> See what’s new and rising across GitHub, Hacker News, newsletters, and the awesome lists — and swipe to shape what you see next.</li>
          <li><b>Search.</b> Describe what you’re building, in your own words, and find the repos that fit.</li>
          <li><b>Ask.</b> Pick any repo and get real answers — how it works, what changed, its limits, whether it’s ready — on screen or out loud.</li>
        </ul>
        <div className="sp-grid">
          <div><b>↑ ↓</b><span>browse</span></div>
          <div><b><i className="lk">→</i> <i className="pk">←</i></b><span>like · pass</span></div>
          <div><b>tap</b><span>deep dive</span></div>
          <div><b>talk</b><span>ask</span></div>
        </div>
      </div>

      <div className="sp-bottom">
        <a className="sp-more" href="/about" onPointerDown={stop}>How it works <span aria-hidden>→</span></a>
        <button className="sp-start" onClick={onStart}><span className="sp-arrow">↑</span>swipe up to start</button>
      </div>
    </section>
  );
}

