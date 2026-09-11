# candy — design rationale

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages exist, but they are one more thing to read, they are the same for everyone, and they stop at the headline. The time most of us actually have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, and deep. Two modalities on one backend: a swipeable feed when you have a screen, voice exploration when you don't. Every item says *why it is here*, and any item can be opened, questioned, or compared, not just glanced at.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to** — and that layer is the product.

- **Signal fusion across sources that never meet.** GitHub search and topics; the repo itself (README, manifest, releases, license); social (Hacker News, Lobsters, points and comment counts); curated (8 newsletters, 20+ awesome lists); and the crawl's own graph (README links). Each source is a weak, biased signal; a repo seen by three of them is a strong one. Trending pages have one source. We have six, with provenance kept per item.
- **Interestingness as first-class, typed metadata.** Not a summary — a schema of *reasons*: momentum (stars/day from snapshots), event (major release, license change, first HN thread), provenance (big org, known author), novelty vs. neighbors, maturity, audience, and spam/star-farm/AI-slop flags. An LLM extracts these once per repo into a fixed schema; every downstream surface ranks and explains from the same fields. The signals a human uses to judge "worth my time" become columns.
- **A graph, not a list.** Edges from five independent mechanisms: dependencies (manifests), README links, LLM-named alternatives and builds-on, awesome-list co-membership, HN co-mention. This is what makes "alternatives to this," "what else is like this," and niche exploration answerable — and what connects a 150★ repo to the 5k★ repos that depend on it.
- **Coverage by tier.** Head exhaustively, niches on expansion, tail on demand. A niche (e.g. *voice*) is seeded from topics and awesome lists, expanded through the graph, and kept as a collection. Anything anyone asks about is fetched, extracted, and carded in ~5 s and stays forever. Depth follows attention.
- **Crawl once, serve everyone; explain everything.** One corpus, many interfaces (feed, voice, newsletter). Ranking is `interest × fit × recency × social` over stored fields, so every item carries a `why[]` — and that explanation *is* the voice script.

## Key decisions and tradeoffs

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; iterate on UI without waiting on crawls | Freshness is hourly, not live |
| Redis as the only store | One system for frontier, corpus, graph, user state; trivially snapshot-able | Memory-bound; raw docs gzip'd and bounded, disk/S3 next |
| Haiku for cards, tool-use schema | $0.007/repo, schema-enforced output | Over-scores famous repos; fixed with an explicit scale in the prompt |
| GitHub + HN + Lobsters + RSS + awesome lists as sources | All free, no scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie user, no auth | Personalization from the first swipe | Real accounts later |

## Learnings

- Trending pages are "famous and pushed today." Real signal is *events* (release, license change, first HN thread) plus velocity. Pushed-in-last-2-days was the weakest tab we built.
- The "new this week" pool is ~50 % noise: star farms, piracy, AI-slop skills. The card pass catches it (`idm_pro_tool` → interest 1, flagged), so noise is an input, not a blocker.
- README links are a bad expansion edge alone — everything links pytorch. Require two independent members, then a relevance check.
- Third-party trend APIs die. OSS Insight's trending endpoint has returned empty since March 2026; go to primary sources.
- Corporate proxies break Node `fetch`. Half an hour lost; documented.

## Iterations

1. JSON pool + list page — saw real data, found noise and the dead API.
2. Redis frontier + crawl loop + extractors — 18 k repos discovered in 5 s, 2 k crawled/hour.
3. LLM cards — quality jumped; tuned scale and flag thresholds after the first 27.
4. Read API, snapshot, background pipeline — product work decoupled from data.
5. Collections + on-demand + voice niche — 1,851 members, 376 carded, arcane 150★ repos surfaced.
6. Feed, ranking, user state — first personalized surface.

**Next:** embeddings for similarity and `ask`/`compare`, voice client, Tier-1 head enumeration with GH Archive as ground truth.
