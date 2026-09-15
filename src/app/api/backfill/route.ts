import { route } from "@/lib/api/guard";
import { drainOne } from "@/lib/corpus/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/backfill — pop one queued repo and fetch/card/embed its missing alternatives.
 * Fired as a keepalive beacon by the client after a deep dive loads; also safe to call from a cron.
 * The queue is only fed by /api/items/:id for repos already in the corpus, so this cannot be
 * pointed at arbitrary repos. It *does* spend (GitHub + a Claude card per alternative), so it runs
 * under the tight `fetch` bucket and one card per call: a client can only hurry the queue along at
 * the same rate it could fetch new repos directly.
 */
export const POST = route({ limit: "fetch" }, async () => Response.json((await drainOne(1)) ?? { idle: true }));
