import { route } from "@/lib/api/guard";
import { resetTaste } from "@/lib/user/state";

export const dynamic = "force-dynamic";

/** POST /api/me/reset — forget likes, passes, and the learned profile. Saved items stay. */
export const POST = route({ limit: "write" }, async ({ uid }) => Response.json(await resetTaste(uid)));
