import { env } from "@/lib/env";
import { createHash } from "node:crypto";
import { HttpError, route } from "@/lib/api/guard";
import { recordServer } from "@/lib/errors";
import { VoiceSessionBody } from "@/lib/api/schemas";
import { getItem } from "@/lib/corpus/api";
import { feed } from "@/lib/user/feed";
import { me } from "@/lib/user/state";
import { buildContext, buildSearchContext, SEARCH_TOOLS, TOOLS } from "@/lib/voice/context";

export const dynamic = "force-dynamic";

const MODEL = env.REALTIME_MODEL;
const VOICE = env.REALTIME_VOICE;

/**
 * POST /api/voice/session { mode: "card", id, why? } | { mode: "search", query? }
 * Mints an ephemeral Realtime client secret with the card's context baked into `instructions`
 * and our function tools attached. The browser uses the returned `value` to open WebRTC directly
 * with OpenAI; the standard key never leaves this server. `voice` bucket: 10 sessions / 10 min.
 */
export const POST = route({ body: VoiceSessionBody, limit: "voice", maxBody: 8_192 }, async ({ uid, body }) => {
  const t0 = Date.now();
  const key = env.OPENAI_API_KEY;
  if (!key) throw new HttpError(503, "voice not configured");

  let instructions: string;
  let tools: readonly unknown[];
  let transcribeInput = false;
  if (body.mode === "search") {
    const meInfo = await me(uid).catch(() => null);
    instructions = buildSearchContext(meInfo, body.query);
    tools = SEARCH_TOOLS;
    transcribeInput = true;   // the search box shows what the user said
  } else {
    // Re-derive the FeedItem for this card (score/why) so the model knows why it's in the feed.
    const [f, meInfo] = await Promise.all([feed(uid, 60), me(uid).catch(() => null)]);
    const cur = f.items.find((x) => x.id === body.id) ?? null;
    const item = cur?.item ?? (await getItem(body.id));
    if (!item) throw new HttpError(404, "unknown repo");
    const feedItem = cur ?? { id: body.id, item, score: 0, fit: 0, why: body.why ?? [], explore: false, saved: false };
    instructions = (await buildContext(feedItem, meInfo)).instructions;
    tools = TOOLS;
  }

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256").update(uid).digest("hex").slice(0, 32),
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: MODEL,
        instructions,
        tools,
        tool_choice: "auto",
        audio: {
          input: {
            turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true },
            // Best-effort: shows the user's words in the box as they speak. The search box is
            // authoritative from the model's search(query) call, so a key without a transcribe
            // model still works — you just don't see your own words until the query lands.
            ...(transcribeInput ? { transcription: { model: env.REALTIME_TRANSCRIBE ?? "gpt-4o-mini-transcribe" } } : {}),
          },
          output: { voice: VOICE, speed: 1.05 },
        },
        max_output_tokens: 700,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("[voice] client_secrets", r.status, txt.slice(0, 300));
    recordServer("voice/session:client_secrets", new Error(`${r.status} ${txt.slice(0, 200)}`), { status: r.status });
    throw new HttpError(502, "could not start voice session");
  }
  const data = (await r.json()) as { value: string; expires_at: number };
  const label = body.mode === "search" ? body.query ?? "" : body.id;
  console.info(`[voice/session] ${uid.slice(0, 8)} ${body.mode} ${label} · ${instructions.length} chars, ${tools.length} tools · ${Date.now() - t0}ms`);
  return Response.json({ secret: data.value, expiresAt: data.expires_at, model: MODEL });
});
