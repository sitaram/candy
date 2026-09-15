# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. Newsletters and trending pages are one more thing to read, the same for everyone, and stop at the headline. The time most of us have free is walking or driving. And the tools for finding software are built by engineers for engineers, so they look like engineering — lists, tables, stars, a README — while the interfaces people actually enjoy were invented somewhere else and never crossed over.

**Idea.** Treat the developer as a consumer. Borrow the patterns people already love — a deck you swipe, a guide you talk to, a reason under every recommendation — and put them on a corpus that knows why a project matters. Ten minutes a day, personalized, navigable, deep.

Three verbs on one corpus — **discover** (a feed fused from GitHub, Hacker News, newsletters and awesome lists, ranked for you, learning from every swipe), **understand** (every card says why it is here; open one for what it does, what it competes with, what shipped), **ask** (find projects for what you are building, or put a hard question to one — it has read the README). Two modalities carry all three: a swipeable feed when you have a screen, voice when you don't.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to** — or put a consumer interface on it. Both halves are the product: the form, and the corpus that makes the form honest.

**Two swipe grammars on one deck.** Up/down browses like TikTok — back, no judgment. Left/right decides like Tinder — like or pass. Nobody combines them: TikTok has no "no", Tinder has no "back". Browsing is free and deciding is cheap. The card itself teaches the gestures: on first arrival, and after a minute idle, it breathes — a small lift and a lean to each side with the colour of that decision at the edge.

**Signal fusion.** Six sources that never meet, each weak and biased; a repo seen by three is strong. Trending pages have one.

| Source | Pulled so far | Contributes |
|---|---|---|
| GitHub search + 19 topic pages | 21,935 discovered · 865 fetched · 4,761 releases | The universe: momentum, age, activity |
| Hacker News | 70 stories on corpus repos | Live peer endorsement |
| 8 newsletters | 87 issues | Editorial curation |
| 20 awesome lists + 5 niche | 275 placements | The canon, slowly |
| Lobsters | 2 | Tiny; kept for the tail |
| The crawl itself | 3,524 README→repo links | The graph; the tail finds itself |

1,225 carded repos, 30 % multi-source, 13 % human-endorsed. Machine sources outnumber human 6:1 — widening means more *humans*, not more GitHub. A weekly job re-pulls everything (11 minutes, $0.43); the feed never waits on it, and weekly is the honest cadence for a ten-minutes-a-day habit — "released this week" is true at that resolution, and a week of arrivals is about what one person can swipe through.

**Interestingness as typed metadata.** Not a summary — a schema of *reasons*: momentum, event (release, license change, first HN thread), provenance, novelty, maturity, audience, spam flags. Extracted once per repo by a small model with a strict schema; every surface ranks and explains from the same fields. Ranking multiplies interest, personal fit, recency and social proof, so every item carries a list of reasons in plain words — and that list *is* the voice script. Crawl priority and interest are kept apart: popularity decides what to fetch first, the card decides what to show.

**Every swipe trains two models.** A *term profile* (tags, ecosystem, category, language) that explains itself — "matches your interest in rust, cli" — and a *taste vector*: each card embedded once, the user a weighted sum of what they liked minus what they passed, fit is cosine. Terms supply the reason, the vector the score; blended 40/60 once there are enough reactions to trust it. This is what tells "small sharp CLI tools" from "Rust" — a distinction no tag captures. The vector is stored as a raw sum and normalized on read, which makes every nudge exactly reversible: undo subtracts what like added. A running mean could not do that; the first version left a ghost of every undone like.

**Explore slots.** One card in five is chosen *against* the profile — high interest, low fit — and says so: "outside your usual — exploring." A feed that only confirms narrows; the slots keep the taste vector from collapsing onto whatever you liked first.

**Related as labelled groups, not a list.** Neighbours come from named alternatives (either direction), README links, same owner, shared tags weighted by how rare they are, and embedding similarity as a gate rather than a score; popularity on a log scale so a 30k★ peer beats a 30★ toy. Then the card model writes two to four *relationship* labels — "Does the same job, in Rust", "Runs on top of it", "The bigger, older incumbent" — because a flat list makes the reader do the clustering and a label says it in four words. Generic labels are forbidden by the prompt; a deterministic grouping covers repos the model has not reached.

**Coverage by tier — head, niche, tail.** The head is crawled up front. Niches like *voice* are seeded from topics and awesome lists and grown through the graph. The tail fills in *behind attention*: opening a deep dive enqueues the alternatives its card names but the corpus lacks; they are fetched, carded and embedded after the page has been sent, so the page is never slower for it and the next reader sees them. No ranker can surface a peer that was never crawled — 63 % of named alternatives were missing before this — and this is how the corpus grows toward what people look at, at under a cent per repo, once.

## Voice

**The card is the context.** Tap the bars and you are talking to a guide that already knows it: the server bakes the full brief, *why it is in your feed*, six similar repos and a compact profile into the session before it hands the browser a short-lived key. The browser then speaks to the realtime model directly; the real key never leaves the server. The guide opens with a take of twenty seconds or less — mic closed, so a cough cannot cut it off — and ends by handing over the floor in the repo's own terms: "ask how it compares to Whisper, what changed in 0.4, or say next." The mic opens as that audio finishes; from then on you can interrupt at will. Swipes keep working underneath; a page change hands the model the new brief.

**The tools are the product's own read API** — no model on the path, under 150 ms — and whatever a tool returns, the guide says, so tools return only what is true *right now*. **The screen follows the voice**: when the guide shifts to another repo it slides that card onto the rail, so what you hear and what you see stay the same thing. **Nothing is transcribed to the screen** — the button breathes with whoever is louder; the card stays the visual. **Two models, two jobs**: the realtime model holds a three-thousand-token brief and cannot read a sixty-thousand-character README, so hard questions — "does it support X", "what broke last release" — go to a text model with the full README, releases and graph as a cached prompt. It answers in three to six seconds; the guide says "let me read" and relays. The same path powers the typed *Ask this repo* box. Sessions end after three minutes of mutual silence; idle is nearly free because the meter runs on audio tokens, not wall clock. About $0.20 per three-minute conversation.

## Search

**The feed with a query.** Three retrievers — name prefix, keyword, semantic — merged and scored by the same personal ranker as the feed, so "voice agent framework" ranks Python-first for one user and TypeScript-first for another, and every row says why. Results insert onto the rail after the current card; swipe down and you are back. **Voice search** is the same transport in search mode: the header bars open it already listening with a one-line invitation; it runs one search, whose query is the only thing that writes the box, then says one sentence.

**The embedding is a candidate generator, not a ranker.** On sixteen intent queries, the right answer was in the top twenty every time it existed, but its mean rank was poor — cosine finds the neighbourhood and has no opinion inside it. Thirty voice-agent cards sit within 0.03 of each other because they share one model-written register; "rust web framework" returned webpack because the language line outweighed the function. So cosine order is never shown. Semantic finds, lexical confirms, then the card's interest breaks ties and the profile reorders near-equals. Pipecat went from 37th to 6th. The remaining ceiling is coverage: four of the sixteen queries had no correct answer in the corpus at all.

## Key decisions

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; UI iterates without crawls | Freshness weekly, tail on demand |
| Redis as the only store | Frontier, corpus, graph, vectors, user state in one snapshot-able system | Memory-bound; raw docs gzip'd and capped |
| A small model with a strict schema for cards | Under a cent a repo, typed output | Over-scores the famous; fixed with an anchored 0–10 scale |
| Free primary sources only | No scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie, no auth | Personal from the first swipe | GitHub sign-in later — for the stars, not the avatar |
| Terms and embeddings, 40/60 | Terms explain, vectors discriminate; the corpus embeds for a fifth of a cent | The blend is a guess until there is data |
| Speech-to-speech, not transcribe-then-reply | Sub-second turns; the guide can be interrupted | Cannot read long documents; hence the second model |

## Learnings

- "Trending" means famous and pushed today. Signal is events plus velocity. "New this week" is half noise — star farms, piracy, slop — and the card pass flags it, so noise is an input, not a blocker.
- Third-party trend APIs die. Use primary sources.
- README links alone are a bad edge: everything links pytorch. Shared tags alone are worse: "openai", "cursor", "local-first" sit on a quarter of the corpus. Weight by rarity and keep a noise list, or a 4★ toy outranks the 30k★ peer.
- Redis filled at 800 repos; raw READMEs were half the bytes. Gzip and cap. When it is full it drops pipelined writes silently — watch memory, not errors.
- Schema-enforced output still drifts, about one field in 250. Normalize everything on the way in.
- The model over-scores anything famous. An explicit 0–10 scale with anchors fixed it; so did requiring a second weak signal before calling a viral repo a star farm.
- Reaction semantics matter more than the formula. "Save" as a fourth swipe competed with "like"; a bookmark that does not dismiss fixed the UI and the training signal. Six reactions visibly re-rank.
- A small embedder clusters by vocabulary, not function. Right for taste, wrong for search order, wrong for "related" without a gate. Fuse it; never show cosine order raw.
- Give every piece of UI state exactly one writer. Voice transcript and tool argument both wanted the search box; the debounce on one superseded the fetch of the other.
- Prompt the voice model like a style guide — labelled sections, a word budget per answer type, how to pronounce names — not a paragraph. The first take without one ran sixty words and read the ranking reasons verbatim.
- The realtime handshake fails late: the key mints with zero credits and only the call refuses, with the reason in the body. Surface it, or the button spins forever.
- Show the reason, not the score. "Matches your interest in mcp, vs code" is what the user needs, and it checks that the model is learning the right thing.
- A frame's pause before a transition reads as a stall; commit start and end in one step. Two easing tempos on one deck make it read as a stack, not a sheet.

## Next

- **What people say.** The reviews exist already — Hacker News threads, issues, forum posts. Extract what is praised and what is complained about as typed fields on the card. TripAdvisor's face, honestly sourced; no empty review box.
- **A picture.** The README's first screenshot or demo on the card. Most projects have one; nobody surfaces it.
- **Readable by machines.** The cards are typed already. An endpoint an agent can call before it picks a dependency, so the default is not whatever the vendor suggests.
- **Plain language.** A second register for the card — what this lets you do, not what it is — for the person in marketing, or the artist, who could get much further than the tools let them.
- **More humans.** Newsletters, Reddit, podcasts. The machine sources are six to one; the human ones are the signal.

## Robustness

Done after the prototype worked, in the order that made the next step safe: tests before refactoring, validation before sharing the URL, the read model before growing the corpus. Two facts drove most of it. **Redis is 75 ms away** — a `PING` costs what a feed should — so cost is round trips, not bytes, and every path was rebuilt to one hop. And **the corpus is about to grow without a ceiling** — backfill adds repos behind every novel deep dive — so anything linear in corpus size was a cliff in waiting.

**Fails safely.** One guard on every route: user or 401, a schema per query, body and path naming the offending field, 413 on oversize, 400 on bad JSON, 500 never leaks. Per-caller rate limits in Redis that fail open when Redis is down. Every setting read in one typed place; boot names the missing keys. Redis bounded (five retries, five-second connect); a corrupt row costs one item, not the cache every user shares. One client fetch: non-2xx becomes a human message with a request id, reads retry once, every failure has a visible state and a retry — no spinner forever. Server 500s and client throws ship to a ring buffer with per-day fingerprints.

**Stays fast as it grows.** The read model is one gzip'd key and the vectors one float block; a cold process loads both in 300 ms, flat in corpus size, where assembling from five thousand keys took over a second and grew. User state is one pipeline. Neighbours score a generated candidate set — hard edges, specific-tag matches, semantic top 64 over inverted indexes — not the corpus. Query embeddings are cached and start before the Redis reads. Warm: feed, neighbours and search each under 100 ms, each one hop.

**Can be changed.** 146 tests against a real scratch Redis, not a mock — ranking, search fusion, user state, embeddings, guard, rate limit, schemas, error sink, the gesture grammar. The feed component split five ways (card, rail, gestures, hint, voice wiring) so an edit to one cannot silently break another, which is how the breath animation and a flushSync bug were lost before. Accessibility as a pass, not a sprinkle: AA contrast, one focus ring, global reduced motion, the deck a live region announcing each card, the deep dive a focus-managed dialog.

**Not yet.** No device tests. Observability is a ring buffer, not a dashboard or an alert. The corpus still lacks many named peers (codex's, for one) until `alts` runs. The 40/60 term-vector blend and every threshold in `related` are calibrated by eye on one corpus.
