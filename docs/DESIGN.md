# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages exist, but they are one more thing to read, they are the same for everyone, and they stop at the headline. The time most of us actually have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, and deep. Three verbs on one corpus: **discover** (a feed fused from GitHub, HN, newsletters, and awesome lists, ranked for you, learning from every swipe), **understand** (every card says why it is here; open one for what it does, what it competes with, what shipped), and **ask** (find repos for what you are building, or put a hard question to any repo — it has read the README). Two modalities carry all three: a swipeable feed when you have a screen, voice when you don't.

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

  **Freshness.** A GitHub Actions job runs every Monday (`pnpm pipeline --weekly`): re-pull all six sources, re-fetch every corpus repo so stars, velocity, releases, and READMEs are at most a week old, card what is new, embed it. Weekly is the honest cadence for a ten-minutes-a-day habit — the ranker's "released this week" and "+N★/day" signals are true at that resolution, and a week of new arrivals is about what one person can swipe through. The feed itself never waits on this; it reads Redis. Going daily is a one-line cron change if the corpus earns it.
- **Interestingness as typed metadata.** Not a summary — a schema of *reasons*: momentum, event (release, license change, first HN thread), provenance (big org, known author), novelty, maturity, audience, spam flags. Extracted once per repo; every surface ranks and explains from the same fields. The signals a human uses to judge "worth my time" become columns.
- **A graph, not a list.** README links are materialized (3,524 edges); named alternatives live on the card. In the deep dive the neighbours are not a ranked list but *labelled groups* — "Does the same job, in Rust", "Runs on top of it", "The bigger, older incumbent" — written per repo by the card model from the signals that connected them (alternatives, links, shared tags, embedding cosine). A flat list makes the reader do the clustering; a label tells them in four words what a group is *relative to this repo*. Deterministic fallback when unlabelled. Dependency edges, awesome-list co-membership and HN co-mention are next.
- **Coverage by tier.** Head exhaustively, niches on expansion, tail on demand. A niche like *voice* is seeded from topics and awesome lists and grown through the graph. Anything anyone asks about is carded in ~5 s and stays forever. Depth follows attention.
- **Crawl once, serve everyone, explain everything.** One corpus; feed, voice, and newsletter are thin clients. Ranking is `interest × fit × recency × social` over stored fields, so every item carries a `why[]` — which *is* the voice script.
- **Two swipe grammars on one deck.** Up/down pages through cards like TikTok — browse, go back, no judgment. Left/right decides like Tinder — like or pass, and the next card rises. Nobody combines them: TikTok has no "no", Tinder has no "back". Together, browsing is free and deciding is cheap.
- **Every swipe is a training example — into two models at once.** A *term profile* (tags, ecosystem, category, language) that is cheap and explains itself: "matches your interest in rust, cli." And a *taste vector*: each card is embedded once, the user is a running weighted mean of what they liked minus what they passed, and fit is cosine. Terms supply the reason; the embedding supplies the score. This is what lets it tell "small sharp CLI tools" from "Rust" — a distinction no tag captures.

## Voice

**The card is the context.** Tap the bars on a card and you are talking to a guide that already knows it. The server builds the whole context per card — the full brief (pitch, why-care, hooks, audience, stats, release, mentions, README excerpt), *why it is in your feed*, the six most similar repos with one-line pitches, and a compact profile — and bakes it into the session as `instructions` when it mints the ephemeral client secret. The browser opens WebRTC to OpenAI directly (`gpt-realtime-2.1`, speech-to-speech); the API key never leaves the server.

**It opens, you steer.** No "would you like a summary?" — the model gives a ≤20-second take (what it is, why it's here, the one interesting thing) and offers a choice. Then it is a conversation: questions about this repo, the alternatives it named, "what else like this", or "next" to move through the feed by voice. Swipes keep working under the conversation; a page change injects the new card's brief so the model tracks the screen.

**Tools are the corpus API.** Function tools, no LLM on the path, < 150 ms: `get_repo` (everything about any repo), `find_repos`, `next_card`, `react` (like / skip / save by voice); `search` and `open_result` in search mode. Same read API the feed uses — voice is a thin client, as designed.

**The tool result is the voice UI.** Whatever a tool handler returns, the model says. A stale `null` from a superseded fetch became a confident "no matches" spoken over twenty results on screen. So handlers return only what is true *right now*, and the screen and the spoken summary come from the same response.

**Nothing is transcribed to the screen.** While a session runs the only visual change is the button: an accent disc with a stop glyph and a ring that breathes with whoever is louder. The card stays the visual, the voice stays the audio. A running transcript would turn it into a chat, and the point is that you are not reading.

**Cost is bounded.** Sessions end after 3 min with neither side speaking (20 s in search). Idle time is cheap — the meter runs on audio tokens, not wall clock — so a long timeout costs little and a short one ends conversations mid-thought. Audio is $32 / $64 per M tokens in / out, so a 3-minute conversation is ~$0.20; the 3k-token context is cached at $0.40 / M on reconnect. `gpt-realtime-2.1-mini` is a drop-in if quality allows.
- **The screen follows the voice.** When the model shifts to talking about another repo — an alternative, a related project, a search result — it calls `show_repo`, which puts that card on the rail right after the current one and pages to it. What you hear and what you see stay the same thing; swipe down to return.
- **Two models, two jobs.** The realtime model is fast and holds a 3k-token brief; it cannot read a 60k-character README. So hard questions ("does it support X", "what broke in the last release", "is it production-ready") go to `ask_repo`: a text model gets the *full* README, manifest, ten releases with notes, mentions, and graph edges as a cached system prompt, and answers in 3–6 s. The voice model says "let me read" and relays it. The same endpoint powers the typed **Ask this repo** box in the deep dive, threaded. This is the difference between a feed that shows you a repo and one that lets you get to the bottom of it.

## Search

**The feed with a query.** Three retrievers over one corpus — name (prefix on `owner/name`), keyword (tags, category, pitch, why-care), and semantic (embed the query with the same model as the cards, cosine against every card) — merged and then scored with the same personal ranker the feed uses. So "voice agent framework" ranks Python-first for one user and TypeScript-first for another, and every row says why: *exact match*, *close to what you described*, *matches your interest in rust*. One `/api/search` returns the same `FeedItem` shape as `/api/feed`.

**Results open into the rail.** Tapping a result inserts that card right after the one you were on and pages to it with the usual bounce; swipe down and you are back where you were. Feed, search, and voice all land on the same card surface — there is no separate results page to navigate out of.

**Voice search is the same session, different instructions.** The bars in the search box open the same Realtime transport as the card conversation, in *search mode*: it waits for you to speak, calls one tool — `search(query)` — whose argument fills the box and renders the results, then says one sentence ("Six matches — Pipecat is the strongest, a Python framework for real-time voice agents"). Refinements are a new search; "open the second one" is `open_result`. Eight seconds of silence ends it; the results stay. No separate dictation model: what you said shows as a preview line, but the box is written only by the model's `search(query)` — one writer, so one search per utterance.

**The embedding is a candidate generator, not a ranker.** Measured on 16 intent queries: hit@20 is 12/12 for every answer that exists in the corpus, but MRR is 0.58 — cosine finds the right neighbourhood and has no opinion inside it. Thirty voice-agent cards sit within 0.03 of each other because they share one LLM-written register; "rust web framework" returns webpack because `Language:` and `Ecosystem:` tokens outweigh function. So cosine order is never shown. Relevance is *semantic finds, lexical confirms* (0.7 · cosine + 0.3 · keyword hits on tags, language, pitch), then `relevance² × quality^0.35 × (1 + 0.5 · fit)` — relevance dominates, the card's interest score breaks ties, the user's profile reorders near-equals. Pipecat goes from #37 raw to #6 fused. The remaining ceiling is coverage: 4 of the 16 queries had no correct answer in the corpus at all.

## Key decisions and tradeoffs

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; iterate on UI without waiting on crawls | Freshness is weekly, not live |
| Redis as the only store | One system for frontier, corpus, graph, user state; trivially snapshot-able | Memory-bound; raw docs gzip'd and bounded, disk/S3 next |
| Haiku for cards, tool-use schema | $0.007/repo, schema-enforced output | Over-scores famous repos; fixed with an explicit scale in the prompt |
| GitHub + HN + Lobsters + RSS + awesome lists as sources | All free, no scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie user, no auth | Personalization from the first swipe | Real accounts later |
| Terms *and* embeddings, blended 40/60 | Terms explain, vectors discriminate; embedding the whole corpus costs about $0.002 | Two models to keep honest; the 40/60 blend is a guess until there is data. Calibrated on the corpus: random pair cos ≈ .35, true neighbour ≈ .70 |

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
- A small general embedder clusters by vocabulary, not by function or quality. Fine for taste (a user who likes "Rust CLIs" is a vocabulary cluster); wrong for search order. Fuse it with keywords and the interest score, and consider a second, search-facing embedding text without the language and ecosystem lines.
- Two writers to one input box is a bug waiting to happen. Voice transcript and tool argument both wanted the search field; the debounce on one superseded the fetch of the other. Give every piece of UI state exactly one writer.
- The realtime handshake fails late. `client_secrets` mints happily with zero credits; only `/calls` refuses, with the reason in the body. Surface that body or the button spins forever.
- Prompt the voice model like a style guide, not a system prompt: labeled sections, a word budget per answer type, "never read more than three items", how to pronounce repo names. The first take came out at 60 words and used `why[]` verbatim; none of that happens with prose instructions.
- Show the reason, not the score. "Matches your interest in mcp, vs code" is what the user needs, and it doubles as a check that the model is learning the right thing.
