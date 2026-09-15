# Candy: Open source worth your time · [live](https://candy-sitaram1-s-teams.vercel.app)

**Problem.** Engineers learn about useful open source by accident. The tools for finding it are trending pages, newsletters and awesome lists. They are the same for everyone, they stop at the headline, and they ask for time at a desk, when the time most of us have free is walking or driving.

Meanwhile, consumer software solved these exact problems for other things:

- TikTok showed that a feed can learn what you like from nothing but swipes.
- Tinder showed that a decision can be a flick of the thumb.
- TripAdvisor showed that what other people said matters more than the listing.

None of this has been brought to software itself.

**Idea.** The opportunity is to bring those patterns to open source. Candy is a deck you swipe, a guide you talk to, and a reason under every recommendation, built on a corpus that knows why each project matters. It asks for ten minutes a day and gives back a personal, navigable, deep view of what is moving in open source.

It does three things with one corpus:

- **Discover.** See what is new and rising across GitHub, Hacker News, newsletters and the awesome lists, and swipe to shape what you see next.
- **Search.** Describe what you are building in your own words and find the repos that fit.
- **Ask.** Pick any repo and get real answers about how it works, what changed, its limits and whether it is ready, on screen or out loud.

Two modalities carry all three. You swipe when you have a screen and talk when you don't.

## What is novel

GitHub knows *what* a repo is. Nobody has built the layer that knows **why it matters, to whom, and what it relates to**, and nobody has put a consumer interface on that layer. Both halves are the product: the form, and the corpus that makes the form honest.

**Signal fusion.** A project that shows up in three unrelated places is worth your time; one that shows up in one usually is not. So Candy reads six sources that never meet, each weak and biased on its own, and treats agreement between them as the signal. Trending pages have one source.

| Source | Pulled so far | Contributes |
|---|---|---|
| GitHub search + 19 topic pages | 21,935 discovered · 865 fetched · 4,761 releases | The universe: momentum, age, activity |
| Hacker News | 70 stories on corpus repos | Live peer endorsement |
| 8 newsletters | 87 issues | Editorial curation |
| 20 awesome lists + 5 niche | 275 placements | The canon, slowly |
| Lobsters | 2 | Tiny; kept for the tail |
| The crawl itself | 3,524 README→repo links | The graph; the tail finds itself |

The corpus holds 1,225 carded repos. Thirty percent came from more than one source and thirteen percent carry a live human endorsement. Machine sources outnumber human ones six to one, so widening the corpus means adding humans, not more of GitHub. A GitHub Actions job re-pulls everything weekly, in eleven minutes for $0.43, and the feed never waits on it. Weekly is also the honest cadence for a ten-minutes-a-day habit: "released this week" is true at that resolution, and a week of arrivals is about what one person can swipe through.

**Two swipe grammars on one deck.** Looking at a card should cost nothing, and judging it should cost one flick. So up and down browse, the way TikTok does: you can go back, and nothing is judged. Left and right decide, the way Tinder does: like or pass. Nobody has combined the two. TikTok has no "no" and Tinder has no "back". The card teaches the gestures itself. On first arrival, and again after a minute idle, it breathes: a small lift, then a lean to each side with the colour of that decision showing at the edge.

**The card answers the questions an engineer actually asks.** What is this, in one sentence? Why should I care right now? Who is it for? Is it an experiment or is it mature? What does it compete with, and what does it build on? Is it real, or inflated stars? A small model reads each repo once and fills in exactly those fields, with a strict schema and an honest 0–10 interest score. Because the answers are fields rather than prose, the ranker can sort on them, every card can say in plain words why it is here, and the voice can read the same words aloud. Popularity decides what to fetch first; the card decides what to show.

**Nothing is generated while you wait.** Cards, scores, reasons and voice scripts are all computed before anyone asks. The feed fetches thirty ranked cards in one call, shows them one at a time, sends reactions in the background and refills when eight remain, so a swipe is instant and the next card is already there. The model runs once per repo, offline. The product reads.

**Every swipe trains two models, because one cannot both explain and discriminate.** The first is a term profile over tags, ecosystem, category and language. It is cheap and it explains itself: "matches your interest in rust, cli." It learns on the same fields the card model extracted for ranking, so ranking and learning share one vocabulary, and "rust" on one card means the same as "rust" on another. The second is a taste vector. Each card is embedded once, the user is a weighted sum of what they liked minus what they passed, and fit is the cosine between them. Terms supply the reason and the vector supplies the score, blended 40/60 once there are enough reactions to trust it. This is what tells "small sharp CLI tools" from "Rust", a distinction no tag captures.

Browsing is not a "no". Swiping past a card marks it seen and teaches nothing; only like, pass, bookmark and deep dive move the profile, each with its own weight. Interests decay two percent a day, so what you liked in March fades unless you like it again. Six reactions visibly re-rank the feed, because the tags were already clean; nobody fills out a form. The taste vector is stored as a raw sum and normalized on read, which makes every nudge exactly reversible: undo subtracts what like added. A running mean could not do that, and the first version left a ghost of every undone like.

**One card in five ignores your profile on purpose.** It is chosen for high interest and low fit, and it says so: "outside your usual — exploring." A feed that only confirms narrows over time. The slots keep the taste vector from collapsing onto whatever you liked first.

**Related projects come in labelled groups, because a label does the clustering the reader would otherwise have to do.** "Does the same job, in Rust", "Runs on top of it", "The bigger, older incumbent": two to four of these per repo, written by the card model from the signals that connected them. Those signals are named alternatives in either direction, README links, shared ownership, shared tags weighted by how rare they are, and embedding similarity used as a gate rather than a score. Popularity enters on a log scale, so a 30k★ peer beats a 30★ toy. Generic labels are forbidden by the prompt, and a deterministic grouping covers repos the model has not reached yet.

**The corpus grows toward what people look at.** The head is crawled up front. Niches such as voice are seeded from topics and awesome lists and then grown through the graph. The tail fills in behind attention: opening a deep dive enqueues the alternatives its card names but the corpus lacks, and they are fetched, carded and embedded after the page has been sent. The page is never slower for it, and the next reader sees them. This matters because no ranker can surface a peer that was never crawled, and 63 percent of named alternatives were missing before this. It costs under a cent per repo, once.

## Voice

Voice is a live, two-way conversation with the corpus. You talk, it talks back, and you can interrupt it, the way you would a person. There is no dictation step and no transcript to read. This is what makes Candy usable on the go, which is when most of us actually have the time: on a walk, or on a long drive, when you might otherwise put on a podcast. You open the app, hit the voice button on the home page, and start talking, and it walks you through repos for as long as you want to keep going.

It lives in two places:

- **On a card.** Tap the bars and a guide that already knows the project gives you a short take, then lets you ask, discuss and go deep, or move on to the next card by voice.
- **In the header.** The same bars open search already listening. Describe what you need in your own words and the results appear on the rail.

**The guide already knows the project before you say a word.** Before the browser is handed a short-lived key, the server bakes the whole brief into the session: the card, why it is in your feed, six similar repos, and a compact profile of you. The browser then speaks to the realtime model directly, and the real key never leaves the server.

**It talks first, briefly, then it listens.** The guide gives a take of twenty seconds or less, with the mic closed so a cough cannot cut it off. It ends by offering the floor in the repo's own terms: "ask how it compares to Whisper, what changed in 0.4, or say next." The mic opens as that audio finishes, and from then on you can interrupt at will.

**What you hear and what you see are always the same repo.** Swipes keep working under a conversation, and a page change hands the guide the new brief. When the guide shifts to another repo, it slides that card onto the rail. Nothing is transcribed to the screen. The button breathes with whoever is louder, and the card stays the visual.

**The guide never makes things up about the corpus, because it reads from the same API the feed does.** No model sits on that path and each call returns in under 150 ms. Whatever a tool returns, the guide says, so tools return only what is true right now.

**Hard questions go to a second model that has read the whole README.** The realtime model holds a three-thousand-token brief and cannot read a sixty-thousand-character README. So "does it support X" or "what broke last release" goes to a text model that has the full README, releases and graph as a cached prompt. It answers in three to six seconds; the guide says "let me read" and relays. The same path powers the typed *Ask this repo* box.

**A conversation costs about twenty cents.** Sessions end after three minutes of mutual silence. Idle time is nearly free because the meter runs on audio tokens, not wall clock.

## Search

**Search results are ranked for you, not for everyone.** Three retrievers run together: name prefix, keyword, and semantic. Their results are merged and scored by the same personal ranker as the feed, so "voice agent framework" ranks Python-first for one user and TypeScript-first for another, and every row says why. Results insert onto the rail after the current card, and a swipe down takes you back. Voice search uses the same transport in search mode. The header bars open it already listening, with a one-line invitation. It runs one search, whose query is the only thing that writes the box, and then says one sentence.

**Semantic search finds the right neighbourhood and then has no idea what is best in it.** On sixteen intent queries, the right answer was in the top twenty every time it existed in the corpus, but its mean rank was poor. Thirty voice-agent cards sit within 0.03 of each other because they share one model-written register, and "rust web framework" returned webpack because the language line outweighed the function. So cosine order is never shown. Semantic search finds candidates, keyword matching confirms them, the card's interest breaks ties, and the profile reorders near-equals. Pipecat went from 37th to 6th. The remaining ceiling is coverage: four of the sixteen queries had no correct answer in the corpus at all.

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

**It fails safely.** One guard sits on every route: user or 401, a schema per query, body and path that names the offending field, 413 on oversize, 400 on bad JSON, a 403 when a mutation's Origin names another host, and a 500 that never leaks the message. Every setting is read in one typed place, and boot names the missing keys. Redis is bounded to five retries and a five-second connect, and a corrupt row costs one item rather than the cache every user shares. Every outbound call has a deadline shorter than the function that makes it: the model SDKs defaulted to ten minutes, which outlived the sixty-second function that called them while the tokens still billed. There is one client fetch: a non-2xx becomes a human message with a request id, reads retry once, and every failure has a visible state and a retry, so there is no spinner forever. Server 500s, client throws, and the two server failures that never surface as an error (a voice tool throwing, the realtime handshake refused) ship to a ring buffer with per-day fingerprints. `/api/health` reports Redis latency, corpus version, today's spend, and the backfill queue.

**It cannot be made expensive.** Every route that can spend money is behind two ceilings. Per-caller rate limits, sized by what the route costs us rather than how often a human would call it, and with an IP ceiling on every bucket so dropping the cookie does not reset them. And one global daily budget in Redis, charged before the call, so the sum is bounded and not just each caller: at the old per-user limits one address could have run $2,600 of Haiku in a day. When the budget is gone, search falls back to lexical, voice answers from the brief, and backfill waits for tomorrow; nothing refuses outright that can degrade instead. Fetching a repo nobody has heard of is a 404 before it is a GitHub call, so walking `/api/items/*` with a wordlist costs nothing. A reaction is idempotent, so a replayed request cannot compound a profile. Both limiters fail open: a down cache must not take the read path with it.

**It knows what it keeps.** An anonymous profile lives as long as its cookie plus slack, refreshed on every visit, with the seen set capped at five thousand; before this every cookie ever minted left its keys in Redis forever. The voice trace, which exists because the call is browser-to-OpenAI and leaves no server evidence, records transport events and tool names, but the user's words are reduced to their length and the microphone's device name is not taken. Free text the user types is bounded and stripped of control characters at the door, and the error page shows a stack only in development. The browser is told the same things in headers: scripts and connections only to us and to OpenAI, no framing, the microphone only for this origin.

**It stays fast as it grows.** The read model is one gzip'd key and the vectors are one float block. A cold process loads both in 300 ms, flat in corpus size, where assembling them from five thousand keys took over a second and grew with the corpus. User state is one pipeline. Neighbours score a generated candidate set (hard edges, specific-tag matches, and the semantic top 64 over inverted indexes) rather than the whole corpus. Query embeddings are cached and start before the Redis reads. Warm, the feed, neighbours and search each take under 100 ms in one hop.

**It can be changed.** There are 233 tests against a real scratch Redis rather than a mock, covering ranking, search fusion, user state, embeddings, the read-model snapshot, related-project scoring, the guard, rate limits, the spend cap, the backfill queue, schemas, the error sink, the README parser and the gesture grammar. Six of them were written because they failed: exploration slots silently unused, an undo that left a ghost in the taste vector, a reaction that counted as a visit, sentence punctuation glued onto repo names, a hard README edge vetoed by a low cosine, and a snapshot patch that could drop another process's write. The feed component is split five ways (card, rail, gestures, hint, voice wiring) so an edit to one cannot silently break another, which is how the breath animation and a render bug were lost before. Accessibility was done as a pass, not a sprinkle: AA contrast, one focus ring, global reduced motion, a deck that announces each card as a live region, and a deep dive that is a focus-managed dialog.

**Not yet.** There are no device tests, and no lint. Observability is a ring buffer and a health endpoint, not a dashboard or an alert; the spend cap refuses but does not page anyone. The session cookie is random but unsigned, which is fine for an anonymous taste profile and not for anything more. The CSP still allows inline scripts, because hashing Next's hydration bootstrap means rewriting every HTML response. The corpus still lacks many named peers until the alternatives crawl runs. The 40/60 blend and every threshold in related-project scoring are calibrated by eye on one corpus.
