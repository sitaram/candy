import { route } from "@/lib/api/guard";
import { SearchQuery } from "@/lib/api/schemas";
import { search } from "@/lib/user/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q=…&n=20 — personalized search; same FeedItem shape as /api/feed plus `match`. */
export const GET = route({ query: SearchQuery, limit: "embed" }, async ({ uid, query }) =>
  Response.json(await search(uid, query.q, query.n)),
);
