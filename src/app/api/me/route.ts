import { me } from "@/lib/user/state";
import { getUid } from "@/lib/user/uid";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await me(await getUid()));
}
