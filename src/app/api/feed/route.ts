import { route } from "@/lib/api/guard";
import { FeedQuery } from "@/lib/api/schemas";
import { feed } from "@/lib/user/feed";

export const dynamic = "force-dynamic";

/** GET /api/feed?n=30&exclude=a/b&exclude=c/d */
export const GET = route({ query: FeedQuery, limit: "read" }, async ({ uid, query }) =>
  Response.json(await feed(uid, query.n, query.exclude)),
);
