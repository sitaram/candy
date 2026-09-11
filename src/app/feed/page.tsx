import { redirect } from "next/navigation";

/** The feed now lives at /. Keep old links working. */
export default function FeedRedirect() {
  redirect("/");
}
