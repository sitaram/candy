# candy

Open source worth your time. A swipe feed of new and rising open-source projects, with a reason under every card and a voice you can talk to about any of them.

**Live:** https://candy-sitaram1-s-teams.vercel.app · **How it works:** [docs/DESIGN.md](docs/DESIGN.md) (also served at [/about](https://candy-sitaram1-s-teams.vercel.app/about))

<p align="center"><img src="public/icon.svg" width="72" alt=""></p>

## What it does

- **Feed.** Swipe up/down to browse, right to like, left to pass. Cards say what a project is, why you'd care, who it's for, how mature it is, and what it competes with — all precomputed, nothing generated while you wait.
- **Personal.** Every like and pass trains two models: a term profile that explains itself ("matches your interest in Rust, CLI tools") and an embedding taste vector that discriminates. One card in five ignores your profile on purpose.
- **Search.** Describe what you're building in your own words; results are ranked against your taste.
- **Deep dive.** Tap a card for releases, mentions, and related projects in labelled groups. Ask a question and get an answer grounded in the README and release notes.
- **Voice.** Hold a conversation about the card on screen. The model follows the deck as you swipe, and can flip cards, react, search, and open results for you. Made for walking or driving.

## How it's built

```
Discover ─► Frontier ─► Crawl ─► Extract ─► Enrich ─► Embed ─► Redis ─► Feed / Search / Voice
```

| Stage | What | With |
|---|---|---|
| Discover | GitHub Search + topics, Hacker News, Lobsters, RSS newsletters, Awesome lists, README links | `src/lib/discover/` |
| Crawl | Repo meta, releases, README, manifests; rate-limit aware | `src/lib/crawl/`, GitHub API |
| Enrich | Structured card: pitch, why-care, tags, alternatives, interest score | Claude Haiku 4.5, Zod |
| Embed | One vector per card, one taste vector per user | OpenAI `text-embedding-3-small` (512-d), Voyage 3 Lite fallback |
| Rank | Cosine on embeddings blended with explainable term weights | `src/lib/user/` |
| Voice | Realtime speech over WebRTC, tool calls into the app | OpenAI `gpt-realtime-2.1`, `gpt-4o-mini-transcribe` |
| Store | Frontier, raw docs (gzip), cards, graph edges, per-user state | Redis via ioredis |
| App | Mobile-first, safe-area aware, pointer-events gestures | Next.js 15, React 19, TypeScript, Vercel |

The pipeline runs offline and writes to a shared corpus; product requests only read. See [docs/DESIGN.md](docs/DESIGN.md) for the reasoning, what's novel, and what was learned.

## Run it

Requires Node 22, pnpm, and Redis (local `redis-server` is fine).

```bash
pnpm install
cp .env.example .env.local        # fill in the keys below
pnpm discover                     # ~5 s: fills the frontier (~20k repos)
pnpm crawl 200 6                  # fetch the top 200, 6 workers
pnpm enrich 50                    # card the top 50 with Claude
pnpm embed                        # vectors for every card
pnpm dev                          # http://localhost:3000
```

Or let it run itself: `pnpm pipeline` loops discover → crawl → enrich; `pnpm pipeline --weekly` is the full refresh, run by [`.github/workflows/weekly.yml`](.github/workflows/weekly.yml) (~11 min, ~$0.43).

### Environment

| Variable | Needed for | Notes |
|---|---|---|
| `GITHUB_TOKEN` | Crawling | No scopes; 5,000 req/h vs 60 without |
| `REDIS_URL` | Everything | Defaults to `redis://127.0.0.1:6379` |
| `ANTHROPIC_API_KEY` | Enrichment, deep-dive answers | `CANDY_MODEL` overrides the model |
| `OPENAI_API_KEY` | Embeddings, voice | `REALTIME_MODEL`, `REALTIME_VOICE` override defaults |
| `VOYAGE_API_KEY` | Embedding fallback | Optional |
| `SESSION_SECRET` | Anonymous session cookie | Any long random string |
| `CANDY_DAILY_USD` / `_UID` / `_IP` | Spend caps per day: global, per user, per IP | Default 25 / 3 / 8 |
| `CANDY_ADMIN_TOKEN` | Spend metrics on `/api/health` | Send as `x-candy-admin` header |
| `CANDY_ALERT_WEBHOOK` | Slack/Discord alerts on spend cap or error spikes | Optional |

Secrets stay in `.env.local` and are never logged.

### Useful scripts

```bash
pnpm stats             # corpus counts
pnpm snapshot          # dump / restore the corpus (binary-safe)
pnpm compact           # gzip raw docs, trim history
pnpm voice:trace       # read voice session traces from Redis
pnpm errors            # error fingerprints, last 24 h
pnpm test              # vitest against a throwaway Redis on :6390
```

Debug URLs: `/?voicelog=1` shows the last local voice trace; `/?crash=1` the last uncaught client error.

## Layout

```
src/app/            routes: feed (/), /about, /browse, /me, /r/[owner]/[name], /api/*
src/app/feed/       swipe rail, cards, gestures, search, voice hooks
src/lib/discover/   sources → frontier
src/lib/crawl/      GitHub fetch, rate limits
src/lib/extract/    raw → typed fields + edges (pure)
src/lib/enrich/     Claude cards
src/lib/embed/      vectors, matrix, cosine
src/lib/user/       reactions, profile, taste, ranking, search
src/lib/voice/      realtime context, tools, mode switching, tracing
src/lib/store/      Redis keys, corpus, snapshots
scripts/            pipeline and operations
docs/DESIGN.md      the essay: problem, idea, what's novel, learnings
```

## Status

Personal project, actively developed. Corpus: ~880 carded repos from ~24k discovered. Tested on iOS Safari and desktop Chrome; voice needs a microphone and a network that allows WebRTC.

## License

[MIT](LICENSE)
