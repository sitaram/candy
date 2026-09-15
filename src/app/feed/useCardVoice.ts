"use client";

/**
 * Wires the realtime voice session to the deck: the model's tools (next_card, react, show_repo) act
 * on the rail and answer with the brief of whatever is now on screen; a swipe during a conversation
 * tells the model what changed. Also home to showRepo / jumpTo, which the deep dive uses to bring a
 * linked repo's card up — same path voice uses, so screen and speech stay in sync.
 */

import { useCallback, useEffect, useRef } from "react";
import type { FeedItem } from "@/lib/user/feed";
import type { SearchResponse } from "@/lib/user/search";
import { guarded } from "@/lib/voice/trace";
import { api, report } from "./api";
import { useVoice } from "./useVoice";
import type { Rail } from "./useRail";

export function useCardVoice(rail: Rail, detailOpen: boolean) {
  const { itemsRef, idxRef, cur, go, decide, saved, toggleSave, insertAndGo } = rail;

  const briefOf = useCallback(async (f: FeedItem | undefined) => {
    if (!f) return null;
    const q = new URLSearchParams({ id: f.id }); for (const w of f.why) q.append("why", w);
    try { return (await api<{ brief: string }>(`/api/voice/brief?${q}`)).brief; } catch (e) { report(e, "brief"); return null; }
  }, []);

  /**
   * Put a repo's card on screen by id or bare name: page to it if it is already on the rail, otherwise
   * resolve via search and insert it right after the current card. Returns the FeedItem now showing, or null.
   */
  const showRepo = useCallback(async (raw: string): Promise<FeedItem | null> => {
    const q = raw.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
    if (!q) return null;
    const have = itemsRef.current.findIndex((x) => x.id.toLowerCase() === q.toLowerCase());
    if (have >= 0) { go(have); return itemsRef.current[have]; }
    let res: SearchResponse;
    try { res = await api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&n=3`); } catch (e) { report(e, "show_repo"); return null; }
    const hit = (res.exact && res.results.find((x) => x.id === res.exact))
      ?? res.results.find((x) => x.id.toLowerCase() === q.toLowerCase())
      ?? res.results.find((x) => x.match === "name")
      ?? (q.includes("/") ? undefined : res.results[0]);
    if (!hit) return null;
    insertAndGo(hit);
    return hit;
  }, [go, insertAndGo, itemsRef]);

  /** From inside the deep dive: close the sheet (popping its history entry) and bring that repo's card up. */
  const jumpTo = useCallback((id: string) => {
    if (detailOpen) history.back();                    // popstate → setOpen(null); one entry, so back never re-opens it
    // Let the sheet's pop settle before the rail moves, so the page lands on a visible card.
    setTimeout(() => { void showRepo(id); }, detailOpen ? 60 : 0);
  }, [detailOpen, showRepo]);

  const voice = useVoice({
    currentId: () => itemsRef.current[idxRef.current]?.id ?? null,
    onShowRepo: guarded("show_repo", async (raw: string) => {
      const hit = await showRepo(raw);
      if (!hit) return null;
      await new Promise((r) => setTimeout(r, 160));
      return briefOf(hit);
    }),
    onNextCard: guarded("next_card", async () => {
      const to = idxRef.current + 1;
      if (to >= itemsRef.current.length) return null;
      go(to);
      await new Promise((r) => setTimeout(r, 120));
      return briefOf(itemsRef.current[to]);
    }),
    onReact: guarded("react", async (kind: "like" | "skip" | "save") => {
      const f = itemsRef.current[idxRef.current];
      if (!f) return "No card on screen.";
      if (kind === "save") { if (!saved.has(f.id)) toggleSave(f.id); return `Saved ${f.id.split("/")[1]}.`; }
      decide(kind);
      await new Promise((r) => setTimeout(r, 450));
      const nxt = itemsRef.current[idxRef.current];
      const b = await briefOf(nxt);
      return `${kind === "like" ? "Liked" : "Skipped"} ${f.id.split("/")[1]}.${b ? `\n${b}` : "\nNo more cards."}`;
    }),
  });

  const toggle = useCallback(() => {
    if (voice.active) voice.stop();
    else if (cur) void voice.start({ mode: "card", id: cur.id, why: cur.why });
  }, [voice, cur]);

  /** Start (or restart) a card session on a specific item — used when search hands a spoken conversation to the card it opened. */
  const startOn = useCallback((f: FeedItem) => {
    if (voice.active) voice.stop();
    // The search sheet's session is tearing down as it unmounts; let the mic release before we ask for it again.
    setTimeout(() => { void voice.start({ mode: "card", id: f.id, why: f.why }); }, 250);
  }, [voice]);

  // Swiping while talking: tell the model what's on screen now (but not for tool-driven changes, which return the brief themselves).
  const voiceCardId = useRef<string | null>(null);
  useEffect(() => {
    if (!voice.active || !cur) { voiceCardId.current = cur?.id ?? null; return; }
    if (voiceCardId.current === null) { voiceCardId.current = cur.id; return; }   // session just started on this card
    if (voiceCardId.current === cur.id) return;
    voiceCardId.current = cur.id;
    const t = setTimeout(async () => { const b = await briefOf(cur); if (b) voice.inject(b, false); }, 300);
    return () => clearTimeout(t);
  }, [cur, voice.active, voice, briefOf]);
  useEffect(() => { if (!voice.active) voiceCardId.current = null; }, [voice.active]);

  return { voice, toggle, showRepo, jumpTo, startOn };
}
