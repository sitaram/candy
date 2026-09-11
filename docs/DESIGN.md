# candy — design rationale

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages exist, but they are one more thing to read, they are the same for everyone, and they stop at the headline. The time most of us actually have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, and deep. Two modalities on one backend: a swipeable feed when you have a screen, voice exploration when you don't. Every item says *why it is here*, and any item can be opened, questioned, or compared, not just glanced at.

## What is novel

- **The product is the corpus, not the UI.** A shared knowledge base of repos, crawled once and served to every user and every interface. Feed, voice, and future newsletters are thin clients over one read API.
- **Structured cards, not summaries.** An LLM reads each repo once and emits typed metadata: pitch, why-care, voice script, category, maturity, hook (major release / big org / viral / license change), alternatives, interest 0–10, spam flags. Ranking, explanation, and voice all read the same fields. Nothing is generated on the hot path.
- **Coverage by tier.** Head exhaustively, niches on expansion, tail on demand. A niche (e.g. *voice*) is seeded from topics and awesome lists, expanded two hops through links and named alternatives, and stored as a collection. Anything anyone asks about is fetched and carded in ~5 s and stays forever.
- **Explainable ranking.** `score = interest × fit × recency × social`, each term a stored field, so every card carries a human-readable `why[]` — which is also the voice script.

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
