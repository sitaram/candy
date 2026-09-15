import { HttpError } from "@/lib/api/guard";
import type { VoiceSessionBody } from "@/lib/api/schemas";
import { getItem } from "@/lib/corpus/api";
import { feed } from "@/lib/user/feed";
import { me } from "@/lib/user/state";
import { buildContext, buildDocContext, buildSearchContext, SEARCH_TOOLS, TOOLS } from "@/lib/voice/context";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

export type VoiceMode = z.infer<typeof VoiceSessionBody>;

export interface ResolvedMode {
  instructions: string;
  tools: readonly unknown[];
  /** Search shows the user's own words in the box; the others don't need input transcription. */
  transcribeInput: boolean;
  maxOutputTokens: number;
}

/**
 * What the realtime session should be for a given surface. Used to mint a session (POST /api/voice/session)
 * and to re-point a live one (GET /api/voice/context → session.update) — so moving from search to a card,
 * or card to card, keeps the same connection, mic, and conversation memory.
 */
export async function resolveMode(uid: string, body: VoiceMode): Promise<ResolvedMode> {
  if (body.mode === "doc") {
    const md = await readFile(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
    return { instructions: buildDocContext(md), tools: [], transcribeInput: false, maxOutputTokens: 1200 };
  }
  if (body.mode === "search") {
    const meInfo = await me(uid).catch(() => null);
    return { instructions: buildSearchContext(meInfo, body.query), tools: SEARCH_TOOLS, transcribeInput: true, maxOutputTokens: 700 };
  }
  const [f, meInfo] = await Promise.all([feed(uid, 60), me(uid).catch(() => null)]);
  const cur = f.items.find((x) => x.id === body.id) ?? null;
  const item = cur?.item ?? (await getItem(body.id));
  if (!item) throw new HttpError(404, "unknown repo");
  const feedItem = cur ?? { id: body.id, item, score: 0, fit: 0, why: body.why ?? [], explore: false, saved: false };
  return { instructions: (await buildContext(feedItem, meInfo)).instructions, tools: TOOLS, transcribeInput: false, maxOutputTokens: 700 };
}
