# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages exist, but they are one more thing to read, they are the same for everyone, and they stop at the headline. The time most of us actually have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, and deep. Two modalities on one backend: a swipeable feed when you have a screen, voice exploration when you don't. Every item says *why it is here*, and any item can be opened, questioned, or compared, not just glanced at.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to** — and that layer is the product.

- **Signal fusion.** Six sources that never meet, each a weak, biased signal; a repo seen by three of them is a strong one. Trending pages have one source. What the crawl has actually pulled, as of this writing:

  | Source | Objects fetched | What it contributes |
  |---|---|---|
  | GitHub search (2 rolling queries) + 19 topic pages | 21,935 repos discovered, 865 fetched with README, manifest, and 4,761 releases | The universe: momentum, age, activity |
  | Hacker News (front page, Show HN, best) | 70 stories linking to repos in the corpus | Live peer endorsement; a first-thread event |
  | 8 newsletters (Changelog, TLDR, Console, GitHub blog, dev.to, …) | 87 issues mentioning corpus repos | Editorial curation, weekly cadence |
  | 20 Awesome lists + 5 niche lists | 275 corpus repos placed in a human-made taxonomy | Slow, high-precision "this is the canon" signal |
  | Lobsters | 2 | Wired, tiny; kept for the tail |
  | The crawl itself | 3,524 README→repo links between corpus repos | Related-project graph; the tail finds itself |

  Result: 842 carded repos, 30 % of them multi-source, 13 % with a live human endorsement. Machine sources outnumber human ones 6:1, so widening means more *humans* (more newsletters, Reddit via RSS), not more GitHub.
- **Interestingness as typed metadata.** Not a summary — a schema of *reasons*: momentum, event (release, license change, first HN thread), provenance (big org, known author), novelty, maturity, audience, spam flags. Extracted once per repo; every surface ranks and explains from the same fields. The signals a human uses to judge "worth my time" become columns.
- **A graph, not a list.** README links are materialized today (3,524 edges); named alternatives live on the card and are resolved at read time. Dependency edges, awesome-list co-membership, and HN co-mention are the next three, in that order. The point is to make "alternatives to this" and "what depends on this" answerable, so a 150★ repo connects to the 5k★ repos that use it.
- **Coverage by tier.** Head exhaustively, niches on expansion, tail on demand. A niche like *voice* is seeded from topics and awesome lists and grown through the graph. Anything anyone asks about is carded in ~5 s and stays forever. Depth follows attention.
- **Crawl once, serve everyone, explain everything.** One corpus; feed, voice, and newsletter are thin clients. Ranking is `interest × fit × recency × social` over stored fields, so every item carries a `why[]` — which *is* the voice script.
- **Two swipe grammars on one deck.** Up/down pages through cards like TikTok — browse, go back, no judgment. Left/right decides like Tinder — like or pass, and the next card rises. Nobody combines them: TikTok has no "no", Tinder has no "back". Together, browsing is free and deciding is cheap.
- **Every swipe is a training example — into two models at once.** A *term profile* (tags, ecosystem, category, language) that is cheap and explains itself: "matches your interest in rust, cli." And a *taste vector*: each card is embedded once, the user is a running weighted mean of what they liked minus what they passed, and fit is cosine. Terms supply the reason; the embedding supplies the score. This is what lets it tell "small sharp CLI tools" from "Rust" — a distinction no tag captures.

## Voice

**The card is the context.** Tap the bars on a card and you are talking to a guide that already knows it. The server builds the whole context per card — the full brief (pitch, why-care, hooks, audience, stats, release, mentions, README excerpt), *why it is in your feed*, the six most similar repos with one-line pitches, and a compact profile — and bakes it into the session as `instructions` when it mints the ephemeral client secret. The browser opens WebRTC to OpenAI directly (`gpt-realtime-2.1`, speech-to-speech); the API key never leaves the server.

**It opens, you steer.** No "would you like a summary?" — the model gives a ≤20-second take (what it is, why it's here, the one interesting thing) and offers a choice. Then it is a conversation: questions about this repo, the alternatives it named, "what else like this", or "next" to move through the feed by voice. Swipes keep working under the conversation; a page change injects the new card's brief so the model tracks the screen.

**Tools are the corpus API.** Four function tools, no LLM on the path, < 150 ms: `get_repo` (everything about any repo), `find_repos` (search), `next_card`, `react` (like / skip / save by voice). Same read API the feed uses — voice is a thin client, as designed.

**Cost is bounded.** Sessions end after 30 s of silence. Audio is $32 / $64 per M tokens in / out, so a 3-minute conversation is ~$0.20; the 3k-token context is cached at $0.40 / M on reconnect. `gpt-realtime-2.1-mini` is a drop-in if quality allows.

## Key decisions and tradeoffs

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; iterate on UI without waiting on crawls | Freshness is hourly, not live |
| Redis as the only store | One system for frontier, corpus, graph, user state; trivially snapshot-able | Memory-bound; raw docs gzip'd and bounded, disk/S3 next |
| Haiku for cards, tool-use schema | $0.007/repo, schema-enforced output | Over-scores famous repos; fixed with an explicit scale in the prompt |
| GitHub + HN + Lobsters + RSS + awesome lists as sources | All free, no scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie user, no auth | Personalization from the first swipe | Real accounts later |
| Terms *and* embeddings, blended 40/60 | Terms explain, vectors discriminate; embedding a card is ~120 tokens on Voyage (free to 200M) | Two models to keep honest; the blend weight is a guess until there is data |

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
