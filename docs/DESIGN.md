# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages are one more thing to read, the same for everyone, and stop at the headline. The time most of us have free is walking or driving.

**Idea.** Ten minutes a day, personalized, navigable, deep. Three verbs on one corpus — **discover** (a feed fused from GitHub, HN, newsletters and awesome lists, ranked for you, learning from every swipe), **understand** (every card says why it is here; open one for what it does, what it competes with, what shipped), **ask** (find repos for what you are building, or put a hard question to one — it has read the README). Two modalities carry all three: a swipeable feed when you have a screen, voice when you don't.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to**. That layer is the product.

**Signal fusion.** Six sources that never meet, each weak and biased; a repo seen by three is strong. Trending pages have one.

| Source | Pulled so far | Contributes |
|---|---|---|
| GitHub search + 19 topic pages | 21,935 discovered · 865 fetched · 4,761 releases | The universe: momentum, age, activity |
| Hacker News | 70 stories on corpus repos | Live peer endorsement |
| 8 newsletters | 87 issues | Editorial curation |
| 20 awesome lists + 5 niche | 275 placements | The canon, slowly |
| Lobsters | 2 | Tiny; kept for the tail |
| The crawl itself | 3,524 README→repo links | The graph; the tail finds itself |

1,225 carded repos, 30 % multi-source, 13 % human-endorsed. Machine sources outnumber human 6:1 — widening means more *humans*, not more GitHub. A weekly GitHub Action re-pulls everything (11 min, $0.43); the feed never waits on it.

**Interestingness as typed metadata.** Not a summary — a schema of *reasons*: momentum, event (release, license change, first HN thread), provenance, novelty, maturity, audience, spam flags. Extracted once; every surface ranks and explains from the same fields. Ranking is `interest × fit × recency × social`, so every item carries a `why[]` — which *is* the voice script.

**Coverage by tier — head, niche, tail.** The head is crawled up front. Niches (*voice*) are seeded from topics and awesome lists and grown through the graph. The tail fills in *behind attention*: opening a deep dive enqueues the alternatives its card names but the corpus lacks; they are fetched, carded and embedded after the response is sent (`after()`), so the page is never slower for it and the next reader sees them. No ranker can surface a peer that was never crawled — 63 % of named alternatives were missing before this — and this is how the corpus grows toward what people actually look at, at ~$0.007 per repo, once.

**Related as labelled groups, not a list.** Neighbours come from named alternatives (either direction, by id or bare name), README links, same owner, IDF-weighted shared tags with a noise list, and embedding cosine as a gate; log-stars so a 30k★ peer beats a 30★ toy. Then the card model writes 2–4 *relationship* labels per repo — "Does the same job, in Rust", "Runs on top of it", "The bigger, older incumbent" — because a flat list makes the reader do the clustering and a label says it in four words. Deterministic fallback when unlabelled.

**Two swipe grammars on one deck.** Up/down browses like TikTok — back, no judgment. Left/right decides like Tinder — like or pass. Nobody combines them: TikTok has no "no", Tinder has no "back". Browsing is free and deciding is cheap.

**Every swipe trains two models.** A *term profile* (tags, ecosystem, category, language) that explains itself — "matches your interest in rust, cli" — and a *taste vector*: cards embedded once, the user a running mean of liked minus passed, fit is cosine. Terms supply the reason, the embedding the score; blended 40/60 after ~6 reactions. This tells "small sharp CLI tools" from "Rust" — a distinction no tag captures.

## Voice

**The card is the context.** Tap the bars and you are talking to a guide that already knows it: the server bakes the full brief, *why it is in your feed*, six similar repos and a compact profile into the session `instructions` when it mints the ephemeral secret. The browser speaks WebRTC to `gpt-realtime` directly; the key never leaves the server. It opens with a ≤20-second take — mic closed, so a cough cannot cut it off — that ends by handing over the floor in the repo's own terms ("I'm listening now — ask how it compares to Whisper, what changed in 0.4, or say next"); the mic opens as that audio finishes, and from then on you can interrupt at will. Swipes keep working underneath; a page change injects the new brief.

**Tools are the corpus API** — no LLM on the path, <150 ms: `get_repo`, `find_repos`, `next_card`, `react`, `show_repo`. Whatever a handler returns, the model says, so handlers return only what is true *right now*. **The screen follows the voice**: when the model shifts to another repo it calls `show_repo`, which slides that card onto the rail. **Nothing is transcribed to the screen** — the button breathes with whoever is louder; the card stays the visual. **Two models, two jobs**: hard questions ("does it support X", "what broke last release") go to `ask_repo`, a text model with the full README, releases and edges as a cached prompt, answering in 3–6 s; the voice says "let me read" and relays. Same endpoint powers the typed *Ask this repo* box. Sessions end after 3 min of mutual silence; idle is nearly free since the meter is audio tokens. ~$0.20 per 3-minute conversation.

## Search

**The feed with a query.** Three retrievers — name prefix, keyword, semantic — merged and scored by the same personal ranker as the feed, so "voice agent framework" ranks Python-first for one user and TypeScript-first for another, and every row says why. Results insert onto the rail after the current card; swipe down and you are back. **Voice search** is the same transport in search mode: the header bars open it already listening with a one-line invitation; it calls `search(query)` — the only writer to the box — then says one sentence. **The embedding is a candidate generator, not a ranker**: hit@20 was 12/12 but MRR 0.58 — cosine finds the neighbourhood and has no opinion inside it (thirty voice-agent cards within 0.03; "rust web framework" → webpack because `Language:` tokens outweigh function). So order is `(0.7·cos + 0.3·keyword)² × quality^0.35 × (1 + 0.5·fit)`. Pipecat: #37 raw → #6 fused.

## Key decisions

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; UI iterates without crawls | Freshness weekly, tail on demand |
| Redis as the only store | Frontier, corpus, graph, vectors, user state in one snapshot-able system | Memory-bound; raw docs gzip'd and capped |
| Haiku with tool-use schema for cards | $0.007/repo, typed output | Over-scores the famous; fixed with an anchored 0–10 scale |
| Free primary sources only | No scraping, complementary signals | GitHub-only universe; HF and registries are gaps |
| Anonymous cookie, no auth | Personal from the first swipe | GitHub sign-in later — for the stars, not the avatar |
| Terms and embeddings, 40/60 | Terms explain, vectors discriminate; corpus embeds for $0.002 | The blend is a guess until there is data |

## Learnings

- "Trending" means famous and pushed today. Signal is events plus velocity. "New this week" is ~50 % noise; the card pass flags it, so noise is an input, not a blocker.
- Third-party trend APIs die (OSS Insight, empty since March). Use primary sources.
- README links alone are a bad edge — everything links pytorch. Shared tags alone are worse: "openai", "cursor", "local-first" sit on a quarter of the corpus. IDF-weight them and keep a noise list, or a 4★ toy outranks the 30k★ peer.
- Redis filled at ~800 repos: raw READMEs were half the bytes. Gzip and cap. `noeviction` drops pipelined writes silently — monitor `used_memory`.
- Schema-enforced output still drifts (~1 in 250). Normalize every field on the way in.
- Reaction semantics matter more than the formula. "Save" as a fourth swipe competed with "like"; a non-dismissing bookmark fixed the UI and the training signal. Six reactions visibly re-rank.
- A small embedder clusters by vocabulary, not function. Right for taste, wrong for search order, wrong for "related" without a gate. Fuse it; never show cosine order raw.
- Give every piece of UI state exactly one writer. Voice transcript and tool argument both wanted the search box; the debounce on one superseded the fetch of the other.
- Prompt the voice model like a style guide — labelled sections, a word budget per answer type, how to pronounce names — not a paragraph. The realtime handshake fails late (`client_secrets` mints with zero credits; only `/calls` refuses): surface the body or the button spins forever.
- Show the reason, not the score. "Matches your interest in mcp, vs code" is what the user needs, and it checks that the model is learning the right thing.
- A synchronous rAF hop before a CSS transition reads as a stall; commit start and end in one task with a style flush between. Two easing tempos on one deck make it read as a stack, not a sheet.

## Code quality

Hardening pass, after the prototype worked.

- **Tests** — vitest against a real scratch Redis, 137 cases on the pure logic: ranking, search fusion, user state, embeddings, API guard, rate limit, schemas, error sink.
- **Validated front door** — one `guard()` per route: uid or 401, zod schema per query/body/params with the field named, 413 on oversize, 400 on non-JSON, 500 never leaks the message, `x-request-id` on everything.
- **Rate limits** — per-caller per-bucket token bucket in Redis, `Retry-After` on 429, fails open when Redis is down.
- **Env** — every `process.env` read in one typed object; `assertEnv()` at boot names missing keys in one message.
- **Bounded Redis** — 5-try retry, 5 s connect timeout, error log at 1/s; `safeJson()` so one corrupt row costs one item, not the shared corpus cache.
- **One client fetch** — `api()` turns non-2xx into `ApiError` with a human message and the request id; GET retries once; 12 s timeout; every failure has a visible state and a retry — no spinner forever.
- **Error sink** — server 500s and client throws (fetch, window error, boundary) ship to a Redis ring buffer with fingerprint counts per day.
- **Round trips, not bytes** — Redis is ~75 ms away, so cost is hops, not payload. The read model is one gzip'd key (`corpus:snap`, 700 KB, versioned; writers bump, readers re-check every 30 s) and the vectors one Float32 block (`emb:matrix`, 1.8 MB): a cold process loads both in ~300 ms flat in corpus size, where assembling from 5k per-repo keys took 1.1 s and grew linearly. User state is one pipeline (`loadUser`). Neighbours score a generated candidate set — hard edges ∪ specific-tag matches ∪ semantic top-64 over inverted indexes — not the corpus. Query embeddings are LRU-cached and start before the Redis reads. Warm: feed 88 ms, neighbours 90 ms, search 80 ms, each one hop.
- **Accessibility** — AA contrast on tertiary text; one `:focus-visible` ring; global reduced-motion; deck is a named live region announcing each card; rail copies hidden from AT; toggles `aria-pressed`; detail is a focus-managed `dialog`; toasts are `status`/`alert`.
- **Split `FeedClient`** — `Card` extracted; rail, gestures and keyboard next.
