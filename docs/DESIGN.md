# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. The tools for finding it are trending pages, newsletters and awesome lists. They are the same for everyone, they stop at the headline, and they ask for time at a desk, when the time most of us have free is walking or driving.

Meanwhile, consumer software solved these exact problems for other things:

- TikTok showed that a feed can learn what you like from nothing but swipes.
- Tinder showed that a decision can be a flick of the thumb.
- TripAdvisor showed that what other people said matters more than the listing.

None of this has been brought to software itself.

**Idea.** Bring it. Candy is a deck you swipe, a guide you talk to, and a reason under every recommendation, built on a corpus that knows why each project matters. It asks for ten minutes a day and gives back a personal, navigable, deep view of what is moving in open source.

It does three things with one corpus:

- **Discover.** See what is new and rising across GitHub, Hacker News, newsletters and the awesome lists, and swipe to shape what you see next.
- **Search.** Describe what you are building in your own words and find the repos that fit.
- **Ask.** Pick any repo and get real answers about how it works, what changed, its limits and whether it is ready, on screen or out loud.

Two modalities carry all three. You swipe when you have a screen and talk when you don't.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to**, and nobody has put a consumer interface on that layer. Both halves are the product: the form, and the corpus that makes the form honest.

**Two swipe grammars on one deck.** Up and down browse, the way TikTok does. You can go back, and nothing is judged. Left and right decide, the way Tinder does: like or pass. Nobody has combined the two. TikTok has no "no" and Tinder has no "back". Together they make browsing free and deciding cheap. The card teaches the gestures itself. On first arrival, and again after a minute idle, it breathes: a small lift, then a lean to each side with the colour of that decision showing at the edge.

**Signal fusion.** Six sources that never meet, each weak and biased on its own. A repo seen by three of them is a strong signal. Trending pages have one source.

| Source | Pulled so far | Contributes |
|---|---|---|
| GitHub search + 19 topic pages | 21,935 discovered · 865 fetched · 4,761 releases | The universe: momentum, age, activity |
| Hacker News | 70 stories on corpus repos | Live peer endorsement |
| 8 newsletters | 87 issues | Editorial curation |
| 20 awesome lists + 5 niche | 275 placements | The canon, slowly |
| Lobsters | 2 | Tiny; kept for the tail |
| The crawl itself | 3,524 README→repo links | The graph; the tail finds itself |

The corpus holds 1,225 carded repos. Thirty percent came from more than one source and thirteen percent carry a live human endorsement. Machine sources outnumber human ones six to one, so widening the corpus means adding humans, not more of GitHub. A weekly job re-pulls everything in eleven minutes for $0.43, and the feed never waits on it. Weekly is also the honest cadence for a ten-minutes-a-day habit: "released this week" is true at that resolution, and a week of arrivals is about what one person can swipe through.

**Interestingness as typed metadata.** Each card is not a summary but a schema of reasons: momentum, event (a release, a license change, a first HN thread), provenance, novelty, maturity, audience, and spam flags. A small model with a strict schema extracts these once per repo, and every surface ranks and explains from the same fields. Ranking multiplies interest, personal fit, recency and social proof, so every item carries a list of reasons in plain words, and that list is also the voice script. Crawl priority and interest are kept apart. Popularity decides what to fetch first; the card decides what to show.

**Every swipe trains two models.** The first is a term profile over tags, ecosystem, category and language. It is cheap and it explains itself: "matches your interest in rust, cli." The second is a taste vector. Each card is embedded once, the user is a weighted sum of what they liked minus what they passed, and fit is the cosine between them. Terms supply the reason and the vector supplies the score, blended 40/60 once there are enough reactions to trust it. This is what tells "small sharp CLI tools" from "Rust", a distinction no tag captures. The vector is stored as a raw sum and normalized on read, which makes every nudge exactly reversible: undo subtracts what like added. A running mean could not do that, and the first version left a ghost of every undone like.

**Explore slots.** One card in five is chosen against the profile, with high interest and low fit, and it says so: "outside your usual — exploring." A feed that only confirms narrows over time. The slots keep the taste vector from collapsing onto whatever you liked first.

**Related projects as labelled groups, not a list.** Neighbours come from named alternatives in either direction, README links, shared ownership, shared tags weighted by how rare they are, and embedding similarity used as a gate rather than a score. Popularity enters on a log scale, so a 30k★ peer beats a 30★ toy. The card model then writes two to four relationship labels, such as "Does the same job, in Rust", "Runs on top of it", or "The bigger, older incumbent". A flat list makes the reader do the clustering; a label does it in four words. Generic labels are forbidden by the prompt, and a deterministic grouping covers repos the model has not reached yet.

**Coverage by tier.** The head of the corpus is crawled up front. Niches such as voice are seeded from topics and awesome lists and then grown through the graph. The tail fills in behind attention: opening a deep dive enqueues the alternatives its card names but the corpus lacks, and they are fetched, carded and embedded after the page has been sent. The page is never slower for it, and the next reader sees them. This matters because no ranker can surface a peer that was never crawled, and 63 percent of named alternatives were missing before this. It is how the corpus grows toward what people actually look at, at under a cent per repo, once.

## Voice

**The card is the context.** Tap the bars and you are talking to a guide that already knows the project. Before it hands the browser a short-lived key, the server bakes the full brief into the session: why the repo is in your feed, six similar repos, and a compact profile of you. The browser then speaks to the realtime model directly, and the real key never leaves the server. The guide opens with a take of twenty seconds or less, with the mic closed so a cough cannot cut it off, and it ends by handing over the floor in the repo's own terms: "ask how it compares to Whisper, what changed in 0.4, or say next." The mic opens as that audio finishes, and from then on you can interrupt at will. Swipes keep working underneath, and a page change hands the model the new brief.

**The tools are the product's own read API.** No model sits on that path and each call returns in under 150 ms. Whatever a tool returns, the guide says, so tools return only what is true right now. **The screen follows the voice.** When the guide shifts to another repo, it slides that card onto the rail, so what you hear and what you see stay the same thing. **Nothing is transcribed to the screen.** The button breathes with whoever is louder, and the card stays the visual. **Two models do two jobs.** The realtime model holds a three-thousand-token brief and cannot read a sixty-thousand-character README. Hard questions such as "does it support X" or "what broke last release" go to a text model that has the full README, releases and graph as a cached prompt. It answers in three to six seconds; the guide says "let me read" and relays. The same path powers the typed *Ask this repo* box. Sessions end after three minutes of mutual silence. Idle time is nearly free because the meter runs on audio tokens, not wall clock, and a three-minute conversation costs about $0.20.

## Search

**Search is the feed with a query.** Three retrievers run together: name prefix, keyword, and semantic. Their results are merged and scored by the same personal ranker as the feed, so "voice agent framework" ranks Python-first for one user and TypeScript-first for another, and every row says why. Results insert onto the rail after the current card, and a swipe down takes you back. **Voice search** uses the same transport in search mode. The header bars open it already listening, with a one-line invitation. It runs one search, whose query is the only thing that writes the box, and then says one sentence.

**The embedding is a candidate generator, not a ranker.** On sixteen intent queries, the right answer was in the top twenty every time it existed in the corpus, but its mean rank was poor. Cosine finds the neighbourhood and has no opinion inside it. Thirty voice-agent cards sit within 0.03 of each other because they share one model-written register, and "rust web framework" returned webpack because the language line outweighed the function. So cosine order is never shown. Semantic search finds candidates, keyword matching confirms them, the card's interest breaks ties, and the profile reorders near-equals. Pipecat went from 37th to 6th. The remaining ceiling is coverage: four of the sixteen queries had no correct answer in the corpus at all.

## Key decisions

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; the UI iterates without crawls | Freshness is weekly, with the tail on demand |
| Redis as the only store | Frontier, corpus, graph, vectors and user state in one snapshot-able system | Memory-bound; raw docs are gzip'd and capped |
| A small model with a strict schema for cards | Under a cent a repo, typed output | Over-scores the famous; fixed with an anchored 0–10 scale |
| Free primary sources only | No scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie, no auth | Personal from the first swipe | GitHub sign-in later, for the stars rather than the avatar |
| Terms and embeddings, 40/60 | Terms explain, vectors discriminate; the corpus embeds for a fifth of a cent | The blend is a guess until there is data |
| Speech-to-speech, not transcribe-then-reply | Sub-second turns; the guide can be interrupted | Cannot read long documents, hence the second model |

## Learnings

- "Trending" means famous and pushed today. The real signal is events plus velocity. "New this week" is half noise (star farms, piracy, slop), but the card pass flags it, so noise is an input rather than a blocker.
- Third-party trend APIs die. Use primary sources.
- README links alone are a bad edge, because everything links pytorch. Shared tags alone are worse: "openai", "cursor" and "local-first" sit on a quarter of the corpus. Weight by rarity and keep a noise list, or a 4★ toy outranks the 30k★ peer.
- Redis filled at 800 repos, and raw READMEs were half the bytes. Gzip and cap them. When Redis is full it drops pipelined writes silently, so watch memory, not errors.
- Schema-enforced output still drifts, about one field in 250. Normalize everything on the way in.
- The model over-scores anything famous. An explicit 0–10 scale with anchors fixed it, and so did requiring a second weak signal before calling a viral repo a star farm.
- Reaction semantics matter more than the formula. "Save" as a fourth swipe competed with "like". A bookmark that does not dismiss the card fixed both the UI and the training signal. Six reactions visibly re-rank the feed.
- A small embedder clusters by vocabulary, not function. That is right for taste, wrong for search order, and wrong for related projects unless it is gated. Fuse it with other signals and never show cosine order raw.
- Give every piece of UI state exactly one writer. The voice transcript and the tool argument both wanted the search box, and the debounce on one superseded the fetch of the other.
- Prompt the voice model like a style guide, with labelled sections, a word budget per answer type, and how to pronounce names. The first take without one ran sixty words and read the ranking reasons verbatim.
- The realtime handshake fails late. The key mints with zero credits, and only the call refuses, with the reason in the body. Surface it, or the button spins forever.
- Show the reason, not the score. "Matches your interest in mcp, vs code" is what the user needs, and it doubles as a check that the model is learning the right thing.
- A frame's pause before a transition reads as a stall, so commit start and end in one step. Two easing tempos on one deck make it read as a stack rather than a sheet.

## Next

- **What people say.** The reviews already exist in Hacker News threads, issues and forum posts. Extract what is praised and what is complained about as typed fields on the card. This is TripAdvisor's face with honestly sourced content, and no empty review box.
- **A picture.** Put the README's first screenshot or demo on the card. Most projects have one and nobody surfaces it.
- **Readable by machines.** The cards are typed already. Offer an endpoint an agent can call before it picks a dependency, so the default is not whatever the vendor suggests.
- **Plain language.** Add a second register for the card that says what the project lets you do rather than what it is, for the person in marketing or the artist who could get much further than today's tools let them.
- **More humans.** Add newsletters, Reddit and podcasts. Machine sources outnumber human ones six to one, and the human ones are the signal.

## Robustness

This work was done after the prototype worked, in the order that made each next step safe: tests before refactoring, validation before sharing the URL, the read model before growing the corpus. Two facts drove most of it. Redis is 75 ms away, so a single round trip costs what a whole feed should, and every path was rebuilt to one hop. And the corpus is about to grow without a ceiling, because backfill adds repos behind every novel deep dive, so anything linear in corpus size was a cliff in waiting.

**It fails safely.** One guard sits on every route: user or 401, a schema per query, body and path that names the offending field, 413 on oversize, 400 on bad JSON, and a 500 that never leaks the message. Per-caller rate limits live in Redis and fail open when Redis is down. Every setting is read in one typed place, and boot names the missing keys. Redis is bounded to five retries and a five-second connect, and a corrupt row costs one item rather than the cache every user shares. There is one client fetch: a non-2xx becomes a human message with a request id, reads retry once, and every failure has a visible state and a retry, so there is no spinner forever. Server 500s and client throws ship to a ring buffer with per-day fingerprints.

**It stays fast as it grows.** The read model is one gzip'd key and the vectors are one float block. A cold process loads both in 300 ms, flat in corpus size, where assembling them from five thousand keys took over a second and grew with the corpus. User state is one pipeline. Neighbours score a generated candidate set (hard edges, specific-tag matches, and the semantic top 64 over inverted indexes) rather than the whole corpus. Query embeddings are cached and start before the Redis reads. Warm, the feed, neighbours and search each take under 100 ms in one hop.

**It can be changed.** There are 146 tests against a real scratch Redis rather than a mock, covering ranking, search fusion, user state, embeddings, the guard, rate limits, schemas, the error sink and the gesture grammar. The feed component is split five ways (card, rail, gestures, hint, voice wiring) so an edit to one cannot silently break another, which is how the breath animation and a render bug were lost before. Accessibility was done as a pass, not a sprinkle: AA contrast, one focus ring, global reduced motion, a deck that announces each card as a live region, and a deep dive that is a focus-managed dialog.

**Not yet.** There are no device tests. Observability is a ring buffer, not a dashboard or an alert. The corpus still lacks many named peers until the alternatives crawl runs. The 40/60 blend and every threshold in related-project scoring are calibrated by eye on one corpus.
