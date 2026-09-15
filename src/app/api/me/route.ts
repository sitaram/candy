import { route } from "@/lib/api/guard";
import { me } from "@/lib/user/state";

export const dynamic = "force-dynamic";

export const GET = route({ limit: "read" }, async ({ uid }) => Response.json(await me(uid)));
