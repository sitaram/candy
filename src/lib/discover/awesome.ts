import { addAwesome } from "../store/corpus";
import type { Discovery } from "../store/types";
import { getText, reposInText } from "./util";

/**
 * Curated awesome lists. Membership is a category tag and co-membership is an
 * "alternative-to" edge candidate. Fetched from raw.githubusercontent.com,
 * which does not count against the API rate limit.
 */
export const AWESOME_LISTS: string[] = [
  "sindresorhus/awesome-nodejs",
  "vinta/awesome-python",
  "avelino/awesome-go",
  "rust-unofficial/awesome-rust",
  "enaqx/awesome-react",
  "sorrycc/awesome-javascript",
  "dzharii/awesome-typescript",
  "awesome-selfhosted/awesome-selfhosted",
  "josephmisiti/awesome-machine-learning",
  "e2b-dev/awesome-ai-agents",
  "Shubhamsaboo/awesome-llm-apps",
  "Hannibal046/Awesome-LLM",
  "punkpeye/awesome-mcp-servers",
  "veggiemonk/awesome-docker",
  "ramitsurana/awesome-kubernetes",
  "unixorn/awesome-zsh-plugins",
  "agarrharr/awesome-cli-apps",
  "rockerBOO/awesome-neovim",
  "jaywcjlove/awesome-mac",
  "pawelborkar/awesome-repos",
];

async function fetchReadme(list: string): Promise<string> {
  for (const f of ["readme.md", "README.md", "README.MD", "Readme.md"]) {
    try {
      return await getText(`https://raw.githubusercontent.com/${list}/HEAD/${f}`);
    } catch {
      /* try next */
    }
  }
  throw new Error(`no readme for ${list}`);
}

export async function discoverAwesome(lists = AWESOME_LISTS): Promise<Discovery[]> {
  const out: Discovery[] = [];
  const results = await Promise.allSettled(
    lists.map(async (list) => {
      const md = await fetchReadme(list);
      const repos = reposInText(md).filter((r) => r.toLowerCase() !== list.toLowerCase());
      await addAwesome(list, repos);
      return repos.map<Discovery>((repo) => ({ repo, source: `awesome:${list}`, weight: 0.5 }));
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      out.push(...r.value);
      console.log(`  awesome ${lists[i].padEnd(45)} ${r.value.length}`);
    } else console.error(`  awesome ${lists[i]} failed: ${(r.reason as Error).message}`);
  });
  return out;
}
