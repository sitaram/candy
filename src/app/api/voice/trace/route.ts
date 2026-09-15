import { redis } from "@/lib/store/redis";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

/**
 * Voice traces land here at session end (sendBeacon). Kept per user, newest first, last 20, 7 days.
 *   vt:{uid}         LIST  trace ids, newest first
 *   vt:{uid}:{id}    STRING JSON Trace
 * Read with `pnpm voice:trace [uid]` or GET /api/voice/trace (own traces).
 */
export async function POST(req: Request) {
  const uid = await getUid();
  const raw = await req.text();
  if (!raw || raw.length > 200_000) return new Response(null, { status: 204 });
  let t: { id?: string; reason?: string; mode?: string; startedAt?: number; endedAt?: number; entries?: unknown[] };
  try { t = JSON.parse(raw); } catch { return new Response(null, { status: 204 }); }
  if (!t.id) return new Response(null, { status: 204 });
  const r = redis();
  const p = r.pipeline();
  p.set(`vt:${uid}:${t.id}`, raw, "EX", 7 * 86_400);
  p.lpush(`vt:${uid}`, t.id);
  p.ltrim(`vt:${uid}`, 0, 19);
  p.expire(`vt:${uid}`, 7 * 86_400);
  await p.exec();
  console.info(`[voice/trace] ${uid.slice(0, 8)} ${t.id} ${t.mode} ${t.reason ?? "?"} ${t.entries?.length ?? 0} entries ${t.endedAt && t.startedAt ? Math.round((t.endedAt - t.startedAt) / 1000) + "s" : ""}`);
  return new Response(null, { status: 204 });
}

export async function GET() {
  const uid = await getUid();
  const r = redis();
  const ids = await r.lrange(`vt:${uid}`, 0, 19);
  if (!ids.length) return Response.json({ traces: [] });
  const raws = await r.mget(...ids.map((id) => `vt:${uid}:${id}`));
  return Response.json({ traces: raws.filter(Boolean).map((x) => JSON.parse(x as string)) });
}
