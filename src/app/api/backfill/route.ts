import { drainOne } from "@/lib/corpus/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/backfill — pop one queued repo and fetch/card/embed its missing alternatives.
 * Fired as a keepalive beacon by the client after a deep dive loads; also safe to call from a cron.
 * Nothing waits on this response.
 */
export async function POST() {
  try {
    const r = await drainOne();
    return Response.json(r ?? { idle: true });
  } catch (e) {
    console.warn("[backfill]", (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
