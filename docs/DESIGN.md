# candy — design notes

**The problem I'm solving.** I learn about useful open source by accident. Someone mentions a library, and I wish I'd heard of it six months ago. Newsletters exist, but I don't have the bandwidth to read them, and they're the same for everyone. The time I actually have free is when I'm walking or driving.

**What I want.** Ten minutes a day. Personalized. Something I can steer, not a list I scroll. And when something looks interesting, I want to go deep — ask questions, compare it to what I already use — not just read a headline. Two modes: a swipeable feed when I have a screen, voice when I don't. Same backend.

## What's actually novel here

GitHub knows what a repo is. Nobody has built the layer that knows why it matters, to whom, and what it's related to. That layer is the product. The UI is thin.

- **I'm fusing signals that don't normally meet.** GitHub search and topics. The repo itself — README, manifest, releases. Hacker News and Lobsters. Eight newsletters. Twenty-some awesome lists. And the link graph the crawl builds as it goes. Each of these alone is a weak, biased signal. A repo that shows up in three of them is a strong one. Trending pages have one source.
- **"Interesting" is a column, not a vibe.** For each repo an LLM extracts typed reasons: how fast it's growing, what just happened (release, license change, first HN thread), who's behind it, whether it's novel or one of many, how mature, who it's for, and whether it looks like spam or a star farm. Extracted once, stored, and every surface ranks and explains from the same fields. The things I'd mentally check before deciding a repo is worth my time are now data.
- **It's a graph.** Edges come from five independent places: dependency manifests, README links, alternatives the LLM names, shared awesome-list membership, HN co-mention. That's what lets you ask "what's like this" or "what are the alternatives," and it's how a 150★ repo shows up because three 5k★ repos depend on it.
- **Coverage is tiered.** The head exhaustively. Niches by expansion — seed *voice* from a few topics and awesome lists, grow it through the graph. The tail on demand — ask about anything and it's fetched and carded in about five seconds, and stays. Depth follows attention.
- **Crawl once, serve everyone.** Ranking is `interest × fit × recency × social` over stored fields, so every item can say why it's here. That "why" is also the voice script.

## Decisions I made and what they cost

| Decision | Why | Cost |
|---|---|---|
| Pipeline is offline; product only reads | Feed is sub-100 ms; I can iterate on UI without waiting on a crawl | Hourly freshness, not live |
| Redis for everything | One store for frontier, corpus, graph, user state; trivially snapshot-able | Memory-bound. Raw docs are gzip'd and capped; disk/S3 is next |
| Haiku with a tool-use schema for cards | $0.007 per repo, output is schema-enforced | Over-scored famous repos until I gave it an explicit scale |
| GitHub + HN + Lobsters + RSS + awesome lists | All free, no scraping, they disagree in useful ways | It's a GitHub-only universe. Hugging Face and package registries are gaps |
| Anonymous cookie user | Personalization from the first swipe | Real accounts later |

## What I learned

- "Trending" mostly means famous and pushed today. The real signal is events — a release, a license change, a first HN thread — plus velocity. The pushed-in-last-2-days tab was the weakest thing I built.
- About half of "new this week" is noise: star farms, piracy tools, AI-generated skill packs. The card pass catches most of it (`idm_pro_tool` → interest 1, flagged), so noise is an input, not a blocker.
- README links are a bad expansion edge on their own. Everything links pytorch. I now require two independent members to link something before it joins a niche, then check relevance.
- Third-party trend APIs die. OSS Insight's trending endpoint has returned empty since March. Go to primary sources.
- Corporate proxies break Node's `fetch`. Lost half an hour. It's in the README now.

## How it went

1. JSON pool and a list page. Saw real data, found the noise and the dead API.
2. Redis frontier, crawl loop, extractors. 18k repos discovered in 5 s, ~2k crawled an hour.
3. LLM cards. Quality jumped. Tuned the scale and flag thresholds after the first 27.
4. Read API, snapshots, background pipeline. Product work stopped waiting on data.
5. Collections, on-demand fetch, the voice niche. 1,851 members, 376 carded, and it surfaced 150★ repos I'd never have found.
6. Feed, ranking, user state. First personalized surface.

**Next:** embeddings for similarity and for `ask` / `compare`. The voice client. Enumerate the head properly, with GH Archive as ground truth so I know I'm not missing anything.
