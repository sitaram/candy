# candy — design rationale

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages exist, but they are one more thing to read, they are the same for everyone, and they stop at the headline. The time most of us actually have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, and deep. Two modalities on one backend: a swipeable feed when you have a screen, voice exploration when you don't. Every item says *why it is here*, and any item can be opened, questioned, or compared, not just glanced at.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to** — and that layer is the product.

- **Signal fusion.** Six sources that never meet: GitHub search and topics, the repo itself (README, manifest, releases), Hacker News and Lobsters, 8 newsletters, 20+ awesome lists, and the crawl's own link graph. Each is a weak, biased signal; a repo seen by three of them is a strong one. Trending pages have one source.
- **Interestingness as typed metadata.** Not a summary — a schema of *reasons*: momentum, event (release, license change, first HN thread), provenance (big org, known author), novelty, maturity, audience, spam flags. Extracted once per repo; every surface ranks and explains from the same fields. The signals a human uses to judge "worth my time" become columns.
- **A graph, not a list.** Five independent edge types: dependencies, README links, named alternatives, awesome-list co-membership, HN co-mention. Makes "alternatives to this" answerable, and connects a 150★ repo to the 5k★ repos that depend on it.
- **Coverage by tier.** Head exhaustively, niches on expansion, tail on demand. A niche like *voice* is seeded from topics and awesome lists and grown through the graph. Anything anyone asks about is carded in ~5 s and stays forever. Depth follows attention.
- **Crawl once, serve everyone, explain everything.** One corpus; feed, voice, and newsletter are thin clients. Ranking is `interest × fit × recency × social` over stored fields, so every item carries a `why[]` — which *is* the voice script.

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
