import { discoverAwesome } from "./awesome";
import { discoverGithub } from "./github";
import { discoverRss } from "./rss";
import { discoverHn, discoverLobsters } from "./social";
import type { Discovery } from "../store/types";

export const discoverers: Record<string, () => Promise<Discovery[]>> = {
  github: discoverGithub,
  hn: discoverHn,
  lobsters: discoverLobsters,
  rss: discoverRss,
  awesome: discoverAwesome,
};
