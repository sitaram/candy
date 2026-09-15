/**
 * Tier 3: on-demand. Make sure a repo is in the corpus with a card, fetching
 * and enriching synchronously if needed (~3-6 s cold). The only place product
 * code is allowed to trigger network + LLM, and only for a single named repo.
 */
import { safeJson } from "../util/json";
import { fetchRepo } from "../crawl/fetchRepo";
import { getCard, saveCard } from "../enrich";
import { enrichOne } from "../enrich/llm";
import { extract } from "../extract";
import { addEdges, discover, getMentions, getRepo, saveRepo } from "../store/corpus";
import { K, normId } from "../store/keys";
import { getRaw } from "../store/raw";
import { redis } from "../store/redis";
import { invalidate } from "./api";

export interface EnsureResult {
  id: string;
  fetched: boolean;
  enriched: boolean;
  exists: boolean;
}

const inflight = new Map<string, Promise<EnsureResult>>();

export function ensureItem(rawId: string, opts: { enrich?: boolean } = {}): Promise<EnsureResult> {
  const id = normId(rawId);
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = doEnsure(id, opts.enrich ?? true).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doEnsure(id: string, wantCard: boolean): Promise<EnsureResult> {
  const res: EnsureResult = { id, fetched: false, enriched: false, exists: false };
  let repo = await getRepo(id);

  if (!repo) {
    const f = await fetchRepo(id);
    if (!f) return res;
    const x = extract(f.repo.id, f.readme, f.manifest, f.manifestKind);
    await saveRepo(
      { ...f.repo, readmeLen: x.readmeLen, readmeHash: x.readmeHash, manifestKind: f.manifestKind, depCount: x.depCount },
      { readme: f.readme, manifest: f.manifest, releases: JSON.stringify(f.releases) },
    );
    if (x.linkedRepos.length) {
      await addEdges(f.repo.id, "links", x.linkedRepos);
      await discover(x.linkedRepos.map((r) => ({ repo: r, source: "readme-link", weight: 0.25 })));
    }
    await discover([{ repo: f.repo.id, source: "on-demand", weight: 2 }]);
    repo = await getRepo(f.repo.id);
    res.id = f.repo.id;
    res.fetched = true;
  }
  if (!repo) return res;
  res.exists = true;

  if (wantCard) {
    const card = await getCard(repo.id);
    if (!card || (repo.readmeHash && card.readmeHash !== repo.readmeHash)) {
      const r = redis();
      const [readme, relRaw, mentions] = await Promise.all([getRaw(repo.id, "readme"), getRaw(repo.id, "releases"), getMentions(repo.id)]);
      const e = await enrichOne(repo, readme ?? "", safeJson(relRaw, [], "releases"), mentions);
      await saveCard(repo.id, e.card, {
        readmeHash: repo.readmeHash,
        model: e.model,
        enrichedAt: new Date().toISOString(),
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
      });
      res.enriched = true;
    }
  }
  if (res.fetched || res.enriched) invalidate();
  return res;
}
