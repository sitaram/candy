# candy

Explore what's new and interesting in open source. Crawl once, serve many.

## Pipeline

```
Discovery ──► Frontier ──► Crawl ──► Extract ──► Corpus (Redis) ──► Enrich (soon)
```

- **Discovery** (`src/lib/discover/`): GitHub search, HN, Lobsters, RSS newsletters, awesome lists → repo ids + priority + evidence.
- **Frontier**: Redis ZSET `repo → priority`. Any source bumps priority; dedupe is free.
- **Crawl** (`src/lib/crawl/`): per repo, fetch meta + releases (2 API calls) and README + manifest (raw, free). README links feed back into the frontier.
- **Extract** (`src/lib/extract/`): pure functions raw → typed fields + edges. Re-runnable.
- **Corpus**: `repo:{id}` hashes, `raw:{id}:*`, `mentions:{id}`, `edges:{id}:{type}`, `tags:{id}`, `stars:{id}` snapshots. See `src/lib/store/keys.ts`.

## Run

```bash
pnpm install
cp .env.example .env.local   # add GITHUB_TOKEN (required for real crawls) and REDIS_URL (else local redis)
pnpm discover                # ~5s, fills frontier (~18k repos)
pnpm crawl 200 6             # fetch top-200 of frontier
pnpm stats
pnpm dev                     # http://localhost:3000
```

If your shell has a Socket Firewall / corporate proxy, Node's `fetch` will fail TLS. Run scripts with
`env -u https_proxy -u HTTPS_PROXY -u NODE_EXTRA_CA_CERTS pnpm crawl ...`.

## Iterating on product without waiting on data

- **Read API**: `src/lib/corpus/api.ts` is the only thing product code imports. `getItems(filter, sort, n)`, `getItem`, `getItemDetail`, `similar`, `search`, `categories`. HTTP mirror at `/api/items` and `/api/items/:owner/:name`.
- **Snapshot**: `pnpm snapshot` dumps Redis to `data/snapshot-*.json.gz`. `pnpm snapshot restore` loads it anywhere. `pnpm snapshot restore --fixture` loads only the top-60 for fast dev/tests.
- **Pipeline loop**: `pnpm pipeline` runs discover/crawl/enrich forever with budgets (`CRAWL_PER_CYCLE`, `ENRICH_PER_CYCLE`, `CYCLE_MIN`, `LLM_USD_PER_DAY`). Product code never calls GitHub or an LLM synchronously.
- **Pages**: `/` list, `/r/:owner/:name` deep-dive (card, voice script, similar, releases, mentions, graph, README).
