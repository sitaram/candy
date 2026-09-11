# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages exist, but they are one more thing to read, they are the same for everyone, and they stop at the headline. The time most of us actually have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, and deep. Two modalities on one backend: a swipeable feed when you have a screen, voice exploration when you don't. Every item says *why it is here*, and any item can be opened, questioned, or compared, not just glanced at.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to** — and that layer is the product.

- **Signal fusion.** Six sources that never meet: GitHub search and topics, the repo itself (README, manifest, releases), Hacker News and Lobsters, 8 newsletters, 20+ awesome lists, and the crawl's own link graph. Each is a weak, biased signal; a repo seen by three of them is a strong one. Trending pages have one source. Today 30 % of the corpus is multi-source and 13 % has a live human endorsement (HN, newsletter); the machine sources still outnumber the human ones 6:1, so widening means more *humans*, not more GitHub.
- **Interestingness as typed metadata.** Not a summary — a schema of *reasons*: momentum, event (release, license change, first HN thread), provenance (big org, known author), novelty, maturity, audience, spam flags. Extracted once per repo; every surface ranks and explains from the same fields. The signals a human uses to judge "worth my time" become columns.
- **A graph, not a list.** Five independent edge types: dependencies, README links, named alternatives, awesome-list co-membership, HN co-mention. Makes "alternatives to this" answerable, and connects a 150★ repo to the 5k★ repos that depend on it.
- **Coverage by tier.** Head exhaustively, niches on expansion, tail on demand. A niche like *voice* is seeded from topics and awesome lists and grown through the graph. Anything anyone asks about is carded in ~5 s and stays forever. Depth follows attention.
- **Crawl once, serve everyone, explain everything.** One corpus; feed, voice, and newsletter are thin clients. Ranking is `interest × fit × recency × social` over stored fields, so every item carries a `why[]` — which *is* the voice script.
- **Two swipe grammars on one deck.** Up/down pages through cards like TikTok — browse, go back, no judgment. Left/right decides like Tinder — like or pass, and the next card rises. Nobody combines them: TikTok has no "no", Tinder has no "back". Together, browsing is free and deciding is cheap.
- **Every swipe is a training example — into two models at once.** A *term profile* (tags, ecosystem, category, language) that is cheap and explains itself: "matches your interest in rust, cli." And a *taste vector*: each card is embedded once, the user is a running weighted mean of what they liked minus what they passed, and fit is cosine. Terms supply the reason; the embedding supplies the score. This is what lets it tell "small sharp CLI tools" from "Rust" — a distinction no tag captures.

## Key decisions and tradeoffs

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; iterate on UI without waiting on crawls | Freshness is hourly, not live |
| Redis as the only store | One system for frontier, corpus, graph, user state; trivially snapshot-able | Memory-bound; raw docs gzip'd and bounded, disk/S3 next |
| Haiku for cards, tool-use schema | $0.007/repo, schema-enforced output | Over-scores famous repos; fixed with an explicit scale in the prompt |
| GitHub + HN + Lobsters + RSS + awesome lists as sources | All free, no scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie user, no auth | Personalization from the first swipe | Real accounts later |
| Terms *and* embeddings, blended 40/60 | Terms explain, vectors discriminate; embedding a card costs $0.000002 | Two models to keep honest; the blend weight is a guess until there is data |

## Learnings

- "Trending" means famous and pushed today. Real signal is events (release, license change, first HN thread) plus velocity.
- "New this week" is ~50 % noise: star farms, piracy, AI-slop. The card pass flags it, so noise is an input, not a blocker.
- README links alone are a bad expansion edge; everything links pytorch. Require two independent members, then a relevance check.
- Third-party trend APIs die. OSS Insight has returned empty since March 2026. Use primary sources.
- Redis filled up at ~800 repos: raw READMEs and release notes were half the bytes. Gzip'd and capped them (4× smaller). `noeviction` drops pipelined writes silently; monitor `used_memory`.
- The LLM over-scores anything famous. An explicit 0–10 scale with anchors fixed it; so did requiring a second weak signal before flagging a viral repo as a star farm.
- Schema-enforced tool-use output still drifts: a string where an array was declared, an invented enum value, ~1 in 250. Normalize every field on the way in.
- Crawl priority and interest are different things. Popularity decides what to fetch first; the card decides what to show.
- Six reactions visibly re-rank the feed. Cold start is short because the card's tags are already clean.
- Reaction semantics matter more than the ranking formula. "Save" as a fourth swipe direction competed with "like"; making bookmark a non-dismissing tap fixed both the UI and the training signal.
- Show the reason, not the score. "Matches your interest in mcp, vs code" is what the user needs, and it doubles as a check that the model is learning the right thing.
