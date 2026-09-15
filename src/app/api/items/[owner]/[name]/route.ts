import { HttpError, route } from "@/lib/api/guard";
import { rateLimit } from "@/lib/api/ratelimit";
import { charge, refund } from "@/lib/api/spend";
import { ItemParams, RepoId } from "@/lib/api/schemas";
import { getItemDetail } from "@/lib/corpus/api";
import { ensureItem } from "@/lib/corpus/ensure";
import { isKnown } from "@/lib/corpus/known";

export const dynamic = "force-dynamic";

/**
 * GET /api/items/:owner/:name → detail (description, releases, why). The slow half — neighbours,
 * labels, backfill — is /related, so this paints in ~150 ms.
 *
 * Fetching an unknown repo costs a GitHub call and a Claude card. We only do that for ids the corpus
 * has *heard of* — frontier, README link, named alternative — and under the tight `fetch` bucket.
 * Anything else is a plain 404, so walking /api/items/* with a wordlist cannot spend money.
 */
export const GET = route({ params: ItemParams, limit: "read" }, async ({ uid, ip, params }) => {
  const id = RepoId.parse(`${params.owner}/${params.name}`);
  // Fast path first: if the card is already here, that is one round trip and we are done. Redis is
  // ~250 ms away, so the old isKnown → ensureItem → getItemDetail chain was three of them before any data.
  const fast = await getItemDetail(id);
  if (fast?.card) return Response.json(fast);
  const known = await isKnown(id);
  if (known === "absent") throw new HttpError(404, "not found");
  // No card yet — frontier *or* a corpus repo that was never carded / needs a re-card. Either way ensureItem
  // may call GitHub and Claude, so both go through the tight bucket and the daily budget. (Previously only
  // the frontier branch was gated; /browse?flagged=1 listed the uncarded corpus ids for free.)
  const rl = await rateLimit("fetch", uid, ip);
  if (!rl.ok) throw new HttpError(429, "too many new repos; try again shortly", { "Retry-After": String(rl.retryAfter) });
  const who = { uid, ip };
  await charge("card", who);
  const ens = await ensureItem(id).catch(async (e) => { await refund("card", who); throw e; });
  if (!ens.exists) { await refund("card", who); throw new HttpError(404, "not found"); }
  const detail = await getItemDetail(ens.id);
  if (!detail) throw new HttpError(404, "not found");
  return Response.json(detail);
});
