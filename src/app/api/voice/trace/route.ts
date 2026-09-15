import { route } from "@/lib/api/guard";
import { VoiceTrace } from "@/lib/api/schemas";
import { redis } from "@/lib/store/redis";

export const dynamic = "force-dynamic";

/**
 * Voice traces land here at session end (sendBeacon). Kept per user, newest first, last 20, 7 days.
 *   vt:{uid}         LIST  trace ids, newest first
 *   vt:{uid}:{id}    STRING JSON Trace
 * Read with `pnpm voice:trace [uid]` or GET /api/voice/trace (own traces).
 * A bad trace is a 204, not a 400: sendBeacon cannot act on the answer and we do not want a
 * console error on every page unload for a diagnostic.
 */
export const POST = route({ body: VoiceTrace, limit: "beacon", maxBody: 48_000 }, async ({ uid, body: t }) => {
  const r = redis();
  const p = r.pipeline();
  // Store what was parsed, not the raw text: a valid envelope with junk inside still can't smuggle 200 KB of anything.
  p.set(`vt:${uid}:${t.id}`, JSON.stringify(t), "EX", 7 * 86_400);
  p.lpush(`vt:${uid}`, t.id);
  p.ltrim(`vt:${uid}`, 0, 19);
  p.expire(`vt:${uid}`, 7 * 86_400);
  await p.exec();
  console.info(`[voice/trace] ${uid.slice(0, 8)} ${t.id} ${t.mode} ${t.reason ?? "?"} ${t.entries?.length ?? 0} entries ${t.endedAt && t.startedAt ? Math.round((t.endedAt - t.startedAt) / 1000) + "s" : ""}`);
  return new Response(null, { status: 204 });
});

export const GET = route({ limit: "read" }, async ({ uid }) => {
  const r = redis();
  const ids = await r.lrange(`vt:${uid}`, 0, 19);
  if (!ids.length) return Response.json({ traces: [] });
  const raws = await r.mget(...ids.map((id) => `vt:${uid}:${id}`));
  const traces: unknown[] = [];
  for (const x of raws) { if (!x) continue; try { traces.push(JSON.parse(x)); } catch { /* skip a corrupt one, keep the rest */ } }
  return Response.json({ traces });
});
