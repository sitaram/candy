"use client";

import { api, report, ApiError } from "./api";
import { AskBox } from "./AskBox";
import { useEffect, useRef, useState } from "react";
import type { ItemDetail } from "@/lib/corpus/api";
import { HUE, fmt as fmtStars, agoLong as ago } from "./logic";

type Sim = { id: string; score: number; why: string[]; pitch?: string };
type RelItem = { id: string; name: string; owner: string; pitch: string; stars: number; lang: string | null; category: string };

type Data = ItemDetail;
type Related = { similar: Sim[]; labelled: boolean; pending: number; groups: { label: string; items: RelItem[] }[] };


/** In-feed detail view. Sheet on mobile, side panel on desktop. Fetches /api/items/:id lazily. */
export function Detail({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [rel, setRel] = useState<Related | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Two requests, not one: the description paints as soon as the card is back (~150 ms); related —
  // neighbour scoring over the corpus, labels, backfill bookkeeping — streams in behind it.
  useEffect(() => {
    setD(null); setRel(null); setErr(null);
    const ac = new AbortController();
    api<Data>(`/api/items/${id}`, { signal: ac.signal })
      .then((j) => setD(j))
      .catch((e: Error) => { if (e.name !== "AbortError") { report(e, "item"); setErr(e instanceof ApiError ? e.message : e.message); } });
    api<Related>(`/api/items/${id}/related`, { signal: ac.signal })
      .then((j) => {
        setRel(j);
        // Tail on demand: the server queued this repo's missing alternatives; kick the worker from here so
        // the slow part (GitHub + Claude) never sits on a request the page waits for. keepalive survives navigation.
        // No timeout and no report: this can legitimately take 30 s (GitHub + a Claude card) and nobody is waiting on it.
        if (j.pending) fetch("/api/backfill", { method: "POST", keepalive: true }).catch(() => {});
      })
      .catch(() => setRel({ similar: [], labelled: false, pending: 0, groups: [] }));
    return () => ac.abort();
  }, [id]);

  const c = d?.card;
  const r = d?.repo;

  // Focus moves into the dialog on open and back to the deck on close; Escape closes (also handled by the feed).
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { opener.current?.focus?.(); };
  }, []);

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="detail-bar">
        <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close">←</button>
        <h2 className="detail-id" id="detail-title">{id}</h2>
        <a className="icon-btn" href={`https://github.com/${id}`} target="_blank" rel="noreferrer" aria-label="Open on GitHub">↗</a>
      </div>
      <div className="detail-body">
        {!d && !err && <div className="feed-empty small">loading…</div>}
        {err && <div className="feed-empty small">couldn’t load ({err})</div>}
        {d && r && (
          <>
            <div className="meta">
              {r.stars.toLocaleString()}★ · {Math.round(r.starsPerDay)}/day · {r.language} · {r.license || "no license"} · created {ago(r.createdAt)} · pushed {ago(r.pushedAt)}
              {r.latestRelease && <> · <b>{r.latestRelease}</b> {ago(r.latestReleaseAt)}</>}
            </div>
            {c && (
              <>
                <p className="fcard-pitch">{c.pitch}</p>
                <p className="fcard-whycare">{c.whyCare}</p>
                <div className="tags">
                  <span className="tag cat">{c.category}</span>
                  {c.hook !== "none" && <span className="tag hook">{c.hook}</span>}
                  <span className="tag">{c.maturity}</span>
                  <span className="tag">{c.kind}</span>
                  {c.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                </div>
                <h3>In one breath</h3>
                <p className="voice">{c.voice}</p>
                {c.audience.length > 0 && <p className="kv"><b>For:</b> {c.audience.join(", ")}</p>}
                {c.buildsOn.length > 0 && <p className="kv"><b>Builds on:</b> {c.buildsOn.join(", ")}</p>}
                {c.alternatives.length > 0 && (
                  <p className="kv">
                    <b>Alternatives:</b>{" "}
                    {c.alternatives.map((a, i) => (
                      <span key={a}>
                        {i > 0 && ", "}
                        {/^[\w.-]+\/[\w.-]+$/.test(a) ? <button className="linkish" onClick={() => onOpen(a.toLowerCase())}>{a}</button> : a}
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}

            <AskBox id={id} />

            {!rel ? (
              <section className="rel rel-loading" aria-busy="true" aria-label="Loading related projects">
                <h3>Related</h3>
                <div className="rel-label rel-skel" />
                <div className="rel-row">{[0, 1, 2].map((i) => <div key={i} className="rel-card rel-skel" />)}</div>
              </section>
            ) : rel.groups.length > 0 || rel.pending ? (
              <section className="rel">
                <h3>Related</h3>
                {!!rel.pending && <p className="rel-pending">{rel.pending} more {rel.pending === 1 ? "alternative" : "alternatives"} being fetched — back next time you open this.</p>}
                {rel.groups.map((g) => (
                  <div key={g.label} className="rel-group">
                    <div className="rel-label">{g.label}</div>
                    <div className="rel-row">
                      {g.items.map((it) => (
                        <button key={it.id} className="rel-card" style={{ "--h": HUE[it.category] ?? 230 } as React.CSSProperties} onClick={() => onOpen(it.id)}>
                          <span className="rel-name">{it.name}</span>
                          <span className="rel-pitch">{it.pitch}</span>
                          <span className="rel-meta">★ {fmtStars(it.stars)}{it.lang ? ` · ${it.lang}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ) : rel.similar.length > 0 && (
              <>
                <h3>Similar</h3>
                {rel.similar.map((s) => (
                  <button key={s.id} className="card small linkcard" onClick={() => onOpen(s.id)}>
                    <div className="row">
                      <span className="title">{s.id}</span>
                      <span className="stars">{s.why[0]}</span>
                    </div>
                    {s.pitch && <div className="desc">{s.pitch}</div>}
                  </button>
                ))}
              </>
            )}

            {d.releases.length > 0 && (
              <>
                <h3>Releases</h3>
                {d.releases.slice(0, 5).map((rel) => (
                  <details key={rel.tag_name} className="rel">
                    <summary><b>{rel.tag_name}</b> <span className="stars">{ago(rel.published_at)}</span></summary>
                    <pre>{(rel.body ?? "").slice(0, 2500) || "(no notes)"}</pre>
                  </details>
                ))}
              </>
            )}

            {d.mentions.length > 0 && (
              <>
                <h3>Mentions</h3>
                {d.mentions.map((m, i) => (
                  <div key={i} className="kv">
                    <span className="tag src">{m.source}</span> <a href={m.url} target="_blank" rel="noreferrer">{m.title}</a>
                    {m.points != null && <span className="stars"> · {m.points} pts</span>}
                  </div>
                ))}
              </>
            )}

            <details>
              <summary>README ({d.readme.length.toLocaleString()} chars)</summary>
              <pre className="readme">{d.readme}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
