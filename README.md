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
