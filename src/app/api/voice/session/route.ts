import { createHash } from "node:crypto";
import { feed } from "@/lib/user/feed";
import { me } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";
import { buildContext, buildSearchContext, SEARCH_TOOLS, TOOLS } from "@/lib/voice/context";

export const dynamic = "force-dynamic";

const MODEL = process.env.REALTIME_MODEL ?? "gpt-realtime-2.1";
const VOICE = process.env.REALTIME_VOICE ?? "marin";

/**
 * POST /api/voice/session { id, why? }
 * Mints an ephemeral Realtime client secret with the card's context baked into `instructions`
 * and our function tools attached. The browser uses the returned `value` to open WebRTC directly
 * with OpenAI; the standard key never leaves this server.
 */
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "voice not configured" }, { status: 503 });
  const uid = await getUid();
  const body = (await req.json().catch(() => ({}))) as { mode?: "card" | "search"; id?: string; why?: string[]; query?: string };
  const mode = body.mode ?? "card";

  let instructions: string;
  let tools: readonly unknown[];
  let transcribeInput = false;
  if (mode === "search") {
    const meInfo = await me(uid).catch(() => null);
    instructions = buildSearchContext(meInfo, body.query);
    tools = SEARCH_TOOLS;
    transcribeInput = true;   // the search box shows what the user said
  } else {
    if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
    // Re-derive the FeedItem for this card (score/why) so the model knows why it's in the feed.
    const [f, meInfo] = await Promise.all([feed(uid, 60), me(uid).catch(() => null)]);
    const cur = f.items.find((x) => x.id === body.id) ?? null;
    const { getItem } = await import("@/lib/corpus/api");
    const item = cur?.item ?? (await getItem(body.id));
    if (!item) return Response.json({ error: "unknown repo" }, { status: 404 });
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
            ...(transcribeInput ? { transcription: { model: process.env.REALTIME_TRANSCRIBE ?? "gpt-4o-mini-transcribe" } } : {}),
          },
          output: { voice: VOICE, speed: 1.05 },
        },
        max_output_tokens: 700,
      },
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("[voice] client_secrets", r.status, txt.slice(0, 300));
    return Response.json({ error: "could not start voice session" }, { status: 502 });
  }
  const data = (await r.json()) as { value: string; expires_at: number };
  return Response.json({ secret: data.value, expiresAt: data.expires_at, model: MODEL });
}
