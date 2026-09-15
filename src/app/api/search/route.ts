import { route } from "@/lib/api/guard";
import { SearchQuery } from "@/lib/api/schemas";
import { search } from "@/lib/user/search";
import { charge } from "@/lib/api/spend";
import { HttpError } from "@/lib/api/guard";

export const dynamic = "force-dynamic";

/** GET /api/search?q=…&n=20 — personalized search; same FeedItem shape as /api/feed plus `match`. */
export const GET = route({ query: SearchQuery, limit: "embed" }, async ({ uid, query }) => {
  // Over budget → lexical only, not a refusal: search must keep working, it just stops calling the embedder.
  let semantic = true;
  if (query.q) { try { await charge("embed"); } catch (e) { if (e instanceof HttpError && e.status === 503) semantic = false; else throw e; } }
  return Response.json(await search(uid, query.q, query.n, { semantic }));
});
