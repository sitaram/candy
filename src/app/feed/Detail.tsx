"use client";

import { useEffect, useState } from "react";
import type { ItemDetail } from "@/lib/corpus/api";

type Sim = { id: string; score: number; why: string[]; pitch?: string };
type Data = ItemDetail & { similar: Sim[] };

function ago(iso: string): string {
  if (!iso) return "";
  const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
}

/** In-feed detail view. Sheet on mobile, side panel on desktop. Fetches /api/items/:id lazily. */
export function Detail({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    setErr(null);
    const ac = new AbortController();
    fetch(`/api/items/${id}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j: Data) => setD(j))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setErr(e.message);
      });
    return () => ac.abort();
  }, [id]);

  const c = d?.card;
  const r = d?.repo;

  return (
    <div className="detail">
      <div className="detail-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Close">←</button>
        <span className="detail-id">{id}</span>
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

            {d.similar.length > 0 && (
              <>
                <h3>Similar</h3>
                {d.similar.map((s) => (
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
