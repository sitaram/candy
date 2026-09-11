import { resetTaste } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

/** POST /api/me/reset — forget likes, passes, and the learned profile. Saved items stay. */
export async function POST() {
  return Response.json(await resetTaste(await getUid()));
}
