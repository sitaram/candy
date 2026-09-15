import { route } from "@/lib/api/guard";
import { ClientError } from "@/lib/api/schemas";
import { record } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Client errors land here (sendBeacon or keepalive fetch). 204 always: the sender cannot act on
 * the answer, and a console error on every report would be recursive.
 */
export const POST = route({ body: ClientError, limit: "beacon", maxBody: 8_000 }, async ({ uid, body, req }) => {
  const extra = body.extra === undefined ? undefined : JSON.stringify(body.extra).slice(0, 1_000);
  await record({ at: Date.now(), side: "client", uid, ua: (req.headers.get("user-agent") ?? "").slice(0, 200), ...body, extra });
  return new Response(null, { status: 204 });
});
