"use client";

/**
 * The feed: a vertical rail of cards, one current, with the splash at page −1.
 * Composition only — state lives in useRail, pointer math in useGestures, the breath in useHint,
 * voice wiring in useCardVoice, and the card itself in Card. This file decides what each intent
 * does, wires the keyboard, computes the three card transforms, and lays them out.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { SearchResult } from "@/lib/user/search";
import { Card, Splash, I, CAT_LABEL, type Decision } from "./Card";
import { Detail } from "./Detail";
import { Search } from "./Search";
import { VoiceLog } from "./VoiceLog";
import { Tip } from "./Tip";
import { hueOf, THRESH } from "./logic";
import { post } from "./api";
import { useRail } from "./useRail";
import { useGestures } from "./useGestures";
import { useHint } from "./useHint";
import { useCardVoice } from "./useCardVoice";
import "./feed.css";

export function FeedClient() {
  const rail = useRail();
  const { items, idx, cur, prev, next, intro, since, loading, loadErr, count, saved, undo, reacted, lastTouch, stackRef,
    settle, animating, ghost, vh, busy, go, decide, doUndo, toggleSave, insertAndGo, settleFrom, interrupt, retry } = rail;
  const [debug, setDebug] = useState(false);
  useEffect(() => setDebug(new URLSearchParams(window.location.search).has("debug")), []);

  /* ---- deep dive: open/close mirrors history so back-swipe closes the sheet ---- */
  const [open, setOpen] = useState<string | null>(null);
  const openDetail = useCallback((id: string) => {
    if (!open) history.pushState({ detail: id }, "", `#${id}`);
    else history.replaceState({ detail: id }, "", `#${id}`);
    setOpen(id);
    post("/api/react", { id, kind: "dive" });
  }, [open]);
  const closeDetail = useCallback(() => { if (open) history.back(); }, [open]);
  useEffect(() => {
    const onPop = () => setOpen((history.state as { detail?: string } | null)?.detail ?? null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* ---- search: results hand a card to the rail, right after the current one ---- */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVoice, setSearchVoice] = useState(false);
  /* ---- voice ---- */
  const { voice, toggle: toggleVoice, jumpTo, startOn } = useCardVoice(rail, !!open);
  /** A result picked while talking keeps the conversation: the card's voice session starts on the new card. */
  const pickResult = useCallback((r: SearchResult) => {
    // A live conversation follows the pick onto the card — whether the user said "open the second one" or tapped it.
    // First, so the session is in card mode before the sheet's unmount asks "is this still mine to end?".
    if (voice.active) startOn(r);
    setSearchOpen(false);
    insertAndGo(r);
  }, [insertAndGo, startOn, voice.active]);
  const openSearch = useCallback(() => { setSearchVoice(false); setSearchOpen(true); }, []);
  /** Header voice: straight into a listening search — one tap, no keyboard. */
  const openVoiceSearch = useCallback(() => { setSearchVoice(true); setSearchOpen(true); }, []);

  /* ---- splash: renders immediately; the feed loads behind it. A start gesture before it lands is honored on arrival. ---- */
  const wantStart = useRef(false);
  const startFeed = useCallback(() => { if (items.length) go(0); else wantStart.current = true; }, [items.length, go]);
  // Deferred: go() uses flushSync, which must not run inside an effect while React is still committing.
  useEffect(() => {
    if (!(wantStart.current && intro && items.length)) return;
    wantStart.current = false;
    const t = setTimeout(() => go(0), 0);
    return () => clearTimeout(t);
  }, [items.length, intro]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- gestures + the breath ---- */
  const hint = useHint({ idx, active: !!cur && !open, lastTouch, isDragging: () => g.isDragging(), isBusy: () => busy.current });
  const g = useGestures({
    canStart: () => {
      lastTouch.current = Date.now();
      hint.stopHint();
      if ((!cur && !intro) || open || searchOpen) return false;
      interrupt();
      return true;
    },
    onTap: () => { if (cur) openDetail(cur.id); else if (intro) startFeed(); },
    onDecide: (kind, d) => { if (cur) decide(kind, d); },
    onPage: (dir, dy) => go(idx + dir, dy),
    onRelease: (dy) => settleFrom(dy),
    onOverscroll: () => { if (intro && !items.length) wantStart.current = true; },   // swiped before the feed landed
    can: () => ({ prev: idx >= 0, next: !!next }),
  });

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (searchOpen) return;
      if (open) { if (e.key === "Escape") closeDetail(); return; }
      if (e.key === "/") { openSearch(); e.preventDefault(); return; }
      if (e.key === "ArrowLeft") decide("skip");
      else if (e.key === "ArrowRight") decide("like");
      else if (e.key === "ArrowUp" || e.key === "j") go(idx + 1);
      else if (e.key === "ArrowDown" || e.key === "k") go(idx - 1);
      else if (e.key === "Enter" && cur) openDetail(cur.id);
      else if (e.key === "b" && cur) toggleSave(cur.id);
      else if (e.key === "v" && cur) toggleVoice();
      else if (e.key === "z" && undo) doUndo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, idx, open, undo, decide, go, openDetail, closeDetail, toggleSave, doUndo, toggleVoice, searchOpen, openSearch]);

  /* ---- layout: three cards on a vertical rail, current one also follows x ---- */
  const { drag } = g;
  const dX = drag.active && drag.axis === "x" ? drag.dx : 0;
  const dY = drag.active && drag.axis === "y" ? drag.dy : 0;
  // Vertical rail position of the current card (px). settle animates toward 0 after a page.
  const railY = dY + settle;
  // Two tempos during a page: the card that just became current travels on a springy .5 s curve; the
  // cards on the rail (the one that just left, the one now peeking) follow on a slower, flatter curve.
  // Both start together, but the rail lags, so the deck reads as a stack, not one sheet.
  const ease = animating ? "transform .5s cubic-bezier(.3,1.25,.45,1)" : "none";
  const railEase = animating ? "transform .62s cubic-bezier(.25,.8,.3,1)" : "none";
  const pr = Math.min(1, Math.abs(dX) / THRESH);
  const pendingDir: Decision | null = drag.axis === "x" && Math.abs(dX) > 12 ? (dX > 0 ? "like" : "skip") : null;
  const peekFade = Math.max(0, 1 - Math.max(0, -railY) / 120);   // strip fades as the next card rises

  const curStyle: CSSProperties = {
    transform: `translate(${dX}px, ${railY}px) rotate(${dX / 20}deg)`,
    transition: drag.active ? "none" : animating ? ease : "transform .25s cubic-bezier(.22,.9,.3,1)",
  };
  const nextStyle: CSSProperties = { transform: `translateY(${vh + railY}px)`, transition: railEase };
  const prevStyle: CSSProperties = { transform: `translateY(${-vh + railY}px)`, transition: railEase };
  const hue = hueOf(cur);

  return (
    <div className={`feed${open ? " has-detail" : ""}`} style={{ "--hue": hue, "--hue2": (hue + 40) % 360 } as CSSProperties}>
      <header className="feed-head">
        <a href="/" className="brand">candy</a>
        <span className="feed-since">
          {since && since.lastVisit > 0 && (since.newInYourAreas > 0 || since.releasesOnSaved.length > 0 || since.newInCorpus > 0) ? (
            <>
              {since.newInYourAreas > 0 ? <b>{since.newInYourAreas} new in your areas</b> : <>{since.newInCorpus} new</>}
              {since.releasesOnSaved.length > 0 && <>{since.newInYourAreas > 0 || since.newInCorpus > 0 ? " · " : ""}{since.releasesOnSaved.length} saved released</>}
            </>
          ) : "discover open source"}
        </span>
        <button className="icon-btn feed-search" onClick={openSearch} aria-label="Search" title="Search (/)">{I.search}</button>
        <Tip label="Ask for a project by voice" tipKey="header-voice" delay={2600}><button className="hv" onClick={openVoiceSearch} aria-label="Ask by voice" title="Ask by voice">{I.voice}</button></Tip>
        <a href="/me" className="icon-btn feed-me" aria-label="Your profile" title="You">
          {count.like + count.skip > 0 && <span className="feed-tally"><b className="lk">{count.like}</b><b className="pk">{count.skip}</b></span>}
          {I.me}
        </a>
      </header>

      {/* Screen readers: the deck is a gesture surface, so announce each card as it lands and say how to drive it. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {cur ? `${cur.id.split("/")[1]}. ${cur.item.card?.pitch ?? cur.item.repo.description ?? ""}${cur.why[0] ? ` ${cur.why[0]}.` : ""}` : ""}
      </p>
      <p className="sr-only">Keyboard: arrow right likes, left passes, up next, down previous. Enter opens details. B saves. V talks about it. Z undoes. Slash searches.</p>
      <div className="deck-wrap">
        <div className="deck">
          {loading && !intro && <div className="feed-empty" role="status">loading…</div>}
          {loadErr && !intro && !items.length && (
            <div className="feed-empty" role="alert">
              {loadErr}<br />
              <button type="button" className="feed-retry" onClick={retry}>try again</button>
            </div>
          )}
          {!loading && !intro && !cur && <div className="feed-empty">You’ve seen everything ranked for you today.<br /><a href="/browse">Browse the corpus</a> or come back tomorrow.</div>}
          {(cur || intro) && (
            // The deck is a Tab stop. The global key handler already maps arrows/Enter/b/z; this makes them
            // discoverable (the a11y tree reads aria-keyshortcuts) and gives the deck a visible focus ring.
            <div className="stack" ref={stackRef} tabIndex={0} role="group" aria-label={cur ? `Card ${idx + 1} of ${items.length}: ${cur.id.split("/")[1]}` : "Discovery deck"}
              aria-keyshortcuts="ArrowRight ArrowLeft ArrowUp ArrowDown Enter b v z" aria-roledescription="swipe deck">
              {idx === 0 && <Splash style={prevStyle} onStart={() => {}} />}
              {prev && <Card key={prev.id} f={prev} style={prevStyle} className="rail" saved={saved.has(prev.id)} reaction={reacted.current.get(prev.id)} />}
              {next && <Card key={next.id} f={next} style={nextStyle} className="rail" saved={saved.has(next.id)} reaction={reacted.current.get(next.id)} />}
              {next && !ghost && !intro && (
                <div className="peek-strip" style={{ opacity: peekFade, "--peekhue": hueOf(next) } as CSSProperties} role="button" aria-label={`Next: ${next.id}`} {...g.peek}>
                  <div className="peek-label">up next · {next.item.card ? CAT_LABEL[next.item.card.category] ?? next.item.card.category : ""}</div>
                  <div className="peek-title">{next.id.split("/")[1]}</div>
                  <div className="peek-pitch">{next.item.card?.pitch}</div>
                </div>
              )}
              <div className={`drag-layer${pendingDir ? ` hint-${pendingDir}` : ""}${hint.hinting && !drag.active ? " breathing" : ""}`} style={{ "--p": pr } as CSSProperties}
                onPointerDown={g.onDown} onPointerMove={g.onMove} onPointerUp={g.onUp} onPointerCancel={g.onCancel}>
                {cur ? (
                  <Card key={cur.id} f={cur} style={curStyle} debug={debug} saved={saved.has(cur.id)} reaction={reacted.current.get(cur.id)}
                    onSave={() => toggleSave(cur.id)} onOpen={() => openDetail(cur.id)}
                    onVoice={toggleVoice} voice={{ state: voice.state, active: voice.active, level: voice.level, muted: voice.muted, toggleMute: voice.toggleMute }} />
                ) : (
                  <Splash style={curStyle} onStart={startFeed} />
                )}
              </div>
              {ghost && (
                <div className={`drag-layer ghost hint-${ghost.kind}`} style={{ "--p": 1 } as CSSProperties} aria-hidden>
                  <Card f={ghost.item} style={ghost.style} saved={saved.has(ghost.item.id)} />
                </div>
              )}
            </div>
          )}
          {voice.error && <div className="toast err">{voice.error}<button onClick={() => voice.stop()}>ok</button></div>}
          <VoiceLog />
          {undo && (
            <div className="toast">
              {undo.kind === "like" ? "Marked interesting" : "Skipped"} <b>{undo.item.id.split("/")[1]}</b>
              <button onClick={doUndo}>undo</button>
            </div>
          )}
          <div className="keyhints">← pass · → like · ↑ ↓ browse · enter deep dive · v voice · / search · b bookmark · z undo</div>
        </div>

        <Search open={searchOpen} autoVoice={searchVoice} voice={voice} onClose={() => setSearchOpen(false)} onPick={pickResult} />
        {open && (
          <div className="detail-host">
            {/* pointerdown, not click: a tap on the card opens the sheet on pointerup, and the browser's
                synthesized click then lands on this scrim (mounted under the still-lifted finger). A finger
                that is already up never produces a new pointerdown, so this cannot close what it just opened. */}
            <div className="scrim" onPointerDown={closeDetail} />
            <Detail id={open} onClose={closeDetail} onOpen={jumpTo} />
          </div>
        )}
      </div>
    </div>
  );
}
