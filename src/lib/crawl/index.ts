import { extract } from "../extract";
import { addEdges, discover, markUnfetchable, nextToCrawl, saveRepo } from "../store/corpus";
import { fetchRepo, RateLimited } from "./fetchRepo";

export interface CrawlResult {
  fetched: number;
  missing: number;
  failed: number;
  newlyDiscovered: number;
  rateLimitedUntil?: number;
}

/**
 * Pull N repos off the frontier, fetch, extract, store, and feed linked repos
 * back into the frontier (the crawl loop). Concurrency is modest to stay polite.
 */
export async function crawl(n: number, concurrency = 4, log = console.log, staleMs?: number): Promise<CrawlResult> {
  const ids = await nextToCrawl(n, staleMs);
  const res: CrawlResult = { fetched: 0, missing: 0, failed: 0, newlyDiscovered: 0 };
  if (!ids.length) return res;

  let i = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && i < ids.length) {
      const id = ids[i++];
      try {
        const f = await fetchRepo(id);
        if (!f) {
          await markUnfetchable(id);
          res.missing++;
          continue;
        }
        const x = extract(f.repo.id, f.readme, f.manifest, f.manifestKind);
        await saveRepo(
          { ...f.repo, readmeLen: x.readmeLen, readmeHash: x.readmeHash, manifestKind: f.manifestKind, depCount: x.depCount },
          { readme: f.readme, manifest: f.manifest, releases: JSON.stringify(f.releases) },
        );
        if (f.repo.id !== id) await markUnfetchable(id); // renamed: retire the old id
        if (x.linkedRepos.length) {
          await addEdges(f.repo.id, "links", x.linkedRepos);
          // README links are weak discovery, but they are how the corpus grows beyond seeds.
          res.newlyDiscovered += await discover(x.linkedRepos.map((r) => ({ repo: r, source: "readme-link", weight: 0.25 })));
        }
        res.fetched++;
        log(`  ✓ ${f.repo.id.padEnd(50)} ${String(f.repo.stars).padStart(7)}★  readme ${String(x.readmeLen).padStart(6)}  deps ${String(x.depCount).padStart(3)}  links ${x.linkedRepos.length}`);
      } catch (e) {
        if (e instanceof RateLimited) {
          res.rateLimitedUntil = e.resetAt;
          stop = true;
          return;
        }
        res.failed++;
        log(`  ✗ ${id}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return res;
}
