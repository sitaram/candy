/**
 * Has the corpus heard of this repo? Three answers, because they cost different things to act on:
 *   corpus   — fetched and stored; serving it is a Redis read.
 *   frontier — discovered (crawl, README link, alternative, on-demand) but not fetched; ensureItem()
 *              will spend a GitHub call and a Claude card on it.
 *   absent   — nobody has ever mentioned it. We do not fetch these from a URL; that would let any
 *              caller grow the corpus (and the bill) one path at a time.
 */
import { K } from "@/lib/store/keys";
import { redis } from "@/lib/store/redis";

export type Known = "corpus" | "frontier" | "absent";

export async function isKnown(id: string): Promise<Known> {
  const r = redis();
  const [inCorpus, prio] = await Promise.all([r.sismember(K.corpus, id), r.zscore(K.frontier, id)]);
  if (inCorpus) return "corpus";
  if (prio !== null) return "frontier";
  return "absent";
}
