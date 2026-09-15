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
    // Realtime output tokens are audio (~10/s) *plus* the same words as transcript text. The doc summary is
    // 140–170 words ≈ 60 s ≈ 600 audio + 250 text before any reasoning; 1200 truncated it.
    return { instructions: buildDocContext(md), tools: [], transcribeInput: false, maxOutputTokens: 2400 };
  }
  if (body.mode === "search") {
    const meInfo = await me(uid).catch(() => null);
    return { instructions: buildSearchContext(meInfo, body.query), tools: SEARCH_TOOLS, transcribeInput: true, maxOutputTokens: 900 };
  }
  const [f, meInfo] = await Promise.all([feed(uid, 60), me(uid).catch(() => null)]);
  const cur = f.items.find((x) => x.id === body.id) ?? null;
  const item = cur?.item ?? (await getItem(body.id));
  if (!item) throw new HttpError(404, "unknown repo");
  const feedItem = cur ?? { id: body.id, item, score: 0, fit: 0, why: body.why ?? [], explore: false, saved: false };
  // The opening take (45–60 words) + the hand-off sentence ran 25–35 s ≈ 350–500 audio + ~150 text tokens ≈ 700:
  // both traced sessions ended status=incomplete/max_output_tokens, cut off mid-sentence. 1600 leaves room.
  return { instructions: (await buildContext(feedItem, meInfo)).instructions, tools: TOOLS, transcribeInput: false, maxOutputTokens: 1600 };
}
