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
- **Two swipe grammars on one deck.** Up/down pages through cards like TikTok — browse, go back, no judgment. Left/right decides like Tinder — like or pass, and the next card rises. Nobody combines them: TikTok has no "no", Tinder has no "back". Together, browsing is free and deciding is cheap, and swiping down after a decision brings the card back with your 👍/👎 on it. Every card is an opaque page in its own category colour, so the colour arrives with the card.
- **Every swipe is a training example.** The feed is an online learner: a thumbs decision updates the user's interest vector immediately, the next card is re-ranked against it, and the reason shown on that card ("matches your interest in rust, cli") is the model explaining itself. Ten swipes is enough to see the feed change; the user never fills out a form.

## The feed loop

**State.** Per user (anonymous cookie for now): `seen`, `reactions`, `saved`, and a **profile** — a weighted term vector over the card's tags, ecosystem, category, and language. The same fields the LLM extracted for ranking are the features the user model learns on, so ranking and learning share one vocabulary.

**Decisions map to gestures.** Swipe right / 👍 = interesting (+1). Swipe left / 👎 = not for me (−0.5). Bookmark = keep (+2, does not dismiss). Tap or "deep dive" = strong interest (+1.5). Swiping *past* a card (up) marks it seen but sends no reaction — browsing is not a "no". Tapping a button plays the same fly-out as the swipe would, so the gesture teaches itself. Undo reverts both the seen-set and the profile delta. Weights decay 2 %/day so old interests fade unless reinforced.

**Ranking.** For every carded, unflagged, unseen item:
```
score = interest^1.2 × (1 + fit) × recency × social
```
`interest` is the card's 0–10. `fit` is profile · item terms, normalized to [−0.5, 1]. `recency` decays over ~7 days from the freshest of created / released. `social` is +15 % per independent human source (HN, Lobsters, newsletter). Then a greedy diversity pass (repeat category ×0.7) and ~20 % explore slots for good items the profile does not already like — so the feed does not tunnel. Each term contributes a phrase to `why[]`; the card shows the top two.

**Latency.** The feed fetches 30 ranked items in one call; the client shows them one at a time, sends reactions in the background, and refills when 8 remain. Nothing generative is on the hot path — cards, scores, and reasons are all pre-computed, so a swipe is instant and the next card is already there.

**Why this works with ~500 items.** Term-overlap fit is coarse, but the LLM has already normalized tags across repos, so "rust" on one card and "rust" on another mean the same thing. Embeddings will replace the dot product with the same interface when the corpus is large enough to need them.

## Key decisions and tradeoffs

| Decision | Why | Cost |
|---|---|---|
| Offline pipeline, read-only product | Sub-100 ms feed; iterate on UI without waiting on crawls | Freshness is hourly, not live |
| Redis as the only store | One system for frontier, corpus, graph, user state; trivially snapshot-able | Memory-bound; raw docs gzip'd and bounded, disk/S3 next |
| Haiku for cards, tool-use schema | $0.007/repo, schema-enforced output | Over-scores famous repos; fixed with an explicit scale in the prompt |
| GitHub + HN + Lobsters + RSS + awesome lists as sources | All free, no scraping, complementary signals | GitHub-only universe; Hugging Face and registries are gaps |
| Anonymous cookie user, no auth | Personalization from the first swipe | Real accounts later |
| Term-vector profile, not embeddings | Explainable, instant, zero cost, works at 500 items | Coarse similarity; swap for embeddings behind the same `fit()` |
| Vertical paging + horizontal deciding | Browse freely, decide cheaply, undo by swiping back | Axis lock at 10 px; diagonal swipes need a rule |
| Splash is page −1 on the same rail | The intro *is* the tutorial: the first swipe up teaches the gesture and bounces in the first card | Nothing |
| Full-bleed card, no scrolling on mobile | One item, one screen, one decision | Long why-care is clamped; depth is one tap away |

## Learnings

- "Trending" means famous and pushed today. Real signal is events (release, license change, first HN thread) plus velocity.
- "New this week" is ~50 % noise: star farms, piracy, AI-slop. The card pass flags it, so noise is an input, not a blocker.
- README links alone are a bad expansion edge; everything links pytorch. Require two independent members, then a relevance check.
- Third-party trend APIs die. OSS Insight has returned empty since March 2026. Use primary sources.
- Redis filled up at ~800 repos: raw READMEs and release notes were half the bytes. Gzip'd and capped them (4× smaller); raw docs move to disk/S3 next.
- The LLM over-scores anything famous. An explicit 0–10 scale with anchors in the prompt fixed it; so did requiring a second weak signal before flagging a viral repo as a star farm.
- Schema-enforced tool-use output still drifts: a string where an array was declared, an invented enum value, ~1 in 250. Normalize every field on the way in.
- Crawl priority and interest are different things. Popularity decides what to fetch first; the card decides what to show. Mixing them made the frontier a list of famous repos.
- On-demand is fast enough. Fetch + extract + card is ~5 s cold, so pre-crawling the tail is unnecessary; depth can follow attention.
- Decoupling paid off immediately. Once product code only read Redis, a snapshot made every experiment safe and the feed could be built while the crawl ran.
- Cost is not the constraint. Cards are $0.007 each; the whole corpus so far is under $10. Rate limits and memory bound the system, not the LLM bill.
- Six reactions is enough to see the feed change. Three thumbs-up on Rust CLI tools and two thumbs-down on LLM inference produced a profile of `aws, cli, rust, python` and `−cuda, −llm-serving`, and the next page re-ranked visibly. Cold start is short because the card's tags are already clean.
- Reaction semantics matter more than the ranking formula. "Save" as a fourth swipe direction competed with "like" and confused the model. Making bookmark a non-dismissing tap fixed both the UI and the training signal.
- Buttons should perform the gesture. A thumbs-up tap that flies the card right teaches the swipe without a tutorial.
- Transparent cards break paging. When the card was just text over a page gradient, swiping down showed words sliding over the card below. Give each card its own opaque background and the same motion reads as a page.
- A bare chevron is not a call to action. "deep dive" in words, plus tap-anywhere, doubled detail opens in testing.
- Show the reason, not the score. `score 26.45 · fit 0.31` is for `?debug=1`; "matches your interest in mcp, vs code" is what the user needs, and it doubles as a check that the model is learning the right thing.
- Redis `noeviction` fails silently through a pipeline. Writes were dropped for an hour before anything surfaced as an error; monitor `used_memory`, and treat an empty profile after reactions as an alarm.
- Mobile CSS grid: overlapping cards with `grid-area: 1/1` need `min-width: 0` or the longest unbreakable string sets the width of the whole deck.
- A card with one job per zone reads faster than a card with everything. Kicker, title, pitch, two reasons, why-it-matters, a four-number snapshot, actions. Everything else moved to detail, and nothing was missed at swipe time.
