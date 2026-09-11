"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Feed, FeedItem } from "@/lib/user/feed";
import type { Reaction } from "@/lib/user/state";

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function FeedClient() {
  const [queue, setQueue] = useState<FeedItem[]>([]);
  const [since, setSince] = useState<Feed["since"] | null>(null);
  const [profileSize, setProfileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState({ like: 0, skip: 0, save: 0, dive: 0 });
  const [flash, setFlash] = useState<Reaction | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const fetching = useRef(false);

  const load = useCallback(async (initial = false) => {
    if (fetching.current) return;
    fetching.current = true;
    const ex = Array.from(seenRef.current).map((id) => `exclude=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`/api/feed?n=30${ex ? "&" + ex : ""}`);
    const f = (await res.json()) as Feed;
    setQueue((q) => [...q, ...f.items.filter((it) => !seenRef.current.has(it.id))]);
    if (initial) setSince(f.since);
    setProfileSize(f.profileSize);
    setLoading(false);
    fetching.current = false;
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const act = useCallback(
    (kind: Reaction) => {
      const cur = queue[0];
      if (!cur) return;
      seenRef.current.add(cur.id);
      setFlash(kind);
      setTimeout(() => setFlash(null), 250);
      setCount((c) => ({ ...c, [kind]: c[kind] + 1 }));
      setQueue((q) => q.slice(1));
      void fetch("/api/react", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cur.id, kind }) });
      if (kind === "dive") window.open(`/r/${cur.id}`, "_blank");
      if (queue.length < 8) void load();
    },
    [queue, load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "j") act("skip");
      else if (e.key === "ArrowRight" || e.key === "l") act("like");
      else if (e.key === "ArrowUp" || e.key === "s") act("save");
      else if (e.key === "ArrowDown" || e.key === "d" || e.key === "Enter") act("dive");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  const cur = queue[0];
  const next = queue[1];
  const total = count.like + count.skip + count.save + count.dive;

  return (
    <div className="feed">
      <header className="feed-head">
        <a href="/" className="brand">candy</a>
        <span className="feed-since">
          {since && since.lastVisit > 0 ? (
            <>
              {since.newInCorpus} new since last visit
              {since.newInYourAreas > 0 && <>, <b>{since.newInYourAreas} in your areas</b></>}
              {since.releasesOnSaved.length > 0 && <>, {since.releasesOnSaved.length} saved repo{since.releasesOnSaved.length > 1 ? "s" : ""} released</>}
            </>
          ) : profileSize === 0 ? (
            "new here — react to a few and it learns"
          ) : (
            ""
          )}
        </span>
        <a href="/me" className="feed-me">{total > 0 ? `${count.like + count.save} liked · ${count.skip} skipped` : "me"}</a>
      </header>

      {loading && <div className="feed-empty">loading…</div>}
      {!loading && !cur && <div className="feed-empty">You’ve seen everything ranked for you today. Come back tomorrow, or <a href="/">browse</a>.</div>}

      {cur && (
        <article className={`fcard${flash ? ` flash-${flash}` : ""}${cur.explore ? " explore" : ""}`} key={cur.id}>
          <div className="fcard-why">{cur.why.join(" · ")}</div>
          <h2 className="fcard-title">
            <span className={`score s${cur.item.card?.interest ?? 0}`}>{cur.item.card?.interest}</span>
            {cur.id}
          </h2>
          <p className="fcard-pitch">{cur.item.card?.pitch}</p>
          <p className="fcard-whycare">{cur.item.card?.whyCare}</p>
          <div className="tags">
            <span className="tag cat">{cur.item.card?.category}</span>
            <span className="tag">{cur.item.card?.maturity}</span>
            {cur.item.repo.language && <span className="tag">{cur.item.repo.language}</span>}
            <span className="tag">{fmt(cur.item.repo.stars)}★</span>
            {cur.item.repo.starsPerDay >= 5 && <span className="tag">{Math.round(cur.item.repo.starsPerDay)}/day</span>}
            {cur.item.card?.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
          <div className="fcard-foot">
            <a href={cur.item.repo.url} target="_blank" rel="noreferrer">github ↗</a>
            <span className="fcard-dbg">score {cur.score} · fit {cur.fit}</span>
          </div>
        </article>
      )}
      {next && <div className="fcard ghost" aria-hidden />}

      <nav className="feed-actions">
        <button className="act skip" onClick={() => act("skip")} title="Skip (←)">✕<small>skip</small></button>
        <button className="act dive" onClick={() => act("dive")} title="Deep dive (↓)">↓<small>dive</small></button>
        <button className="act save" onClick={() => act("save")} title="Save (↑)">★<small>save</small></button>
        <button className="act like" onClick={() => act("like")} title="Like (→)">♥<small>like</small></button>
      </nav>
    </div>
  );
}
