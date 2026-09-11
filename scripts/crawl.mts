/**
 * Fetch + extract the top-N frontier repos.
 * Usage: pnpm crawl [n=50] [concurrency=4]
 */
import { crawl } from "../src/lib/crawl/index.ts";
import { stats } from "../src/lib/store/corpus.ts";
import { closeRedis } from "../src/lib/store/redis.ts";

const n = Number(process.argv[2] ?? 50);
const conc = Number(process.argv[3] ?? 4);

if (!process.env.GITHUB_TOKEN) {
  console.warn("⚠ no GITHUB_TOKEN: 60 API req/h, ~30 repos. Add one to .env.local for 5000/h.\n");
}

const t0 = Date.now();
const r = await crawl(n, conc);
console.log(`\nfetched ${r.fetched}  missing ${r.missing}  failed ${r.failed}  new-in-frontier ${r.newlyDiscovered}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (r.rateLimitedUntil) {
  console.log(`rate limited; resets ${new Date(r.rateLimitedUntil).toLocaleTimeString()}`);
}
console.log(await stats());
await closeRedis();
