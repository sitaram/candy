import { route } from "@/lib/api/guard";
import { drainOne } from "@/lib/corpus/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/backfill — pop one queued repo and fetch/card/embed its missing alternatives.
 * Fired as a keepalive beacon by the client after a deep dive loads; also safe to call from a cron.
 * The queue is only fed by /api/items/:id for repos already in the corpus, so this cannot be
 * pointed at arbitrary repos; the `beacon` bucket just stops one client from draining it in a loop.
 */
export const POST = route({ limit: "beacon" }, async () => Response.json((await drainOne()) ?? { idle: true }));
