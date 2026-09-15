/**
 * Pull in the alternatives our cards name but the corpus lacks. This is where "related" quality
 * actually comes from: a coding agent's peers are other coding agents, and if they are not in the
 * corpus no ranker can surface them.
 *
 * For each unresolved alternative: bare names → GitHub search (top result by stars, must plausibly
 * match the name); owner/name → direct. Then ensureItem() fetches + cards it. Idempotent.
 *
 * pnpm alts [max=150] [minMentions=1]
 */
import { allItems } from "../src/lib/corpus/api";
import { invalidate } from "../src/lib/corpus/api";
import { ensureItem } from "../src/lib/corpus/ensure";
import { ghHeaders } from "../src/lib/discover/github";
import { getJson } from "../src/lib/discover/util";
import { closeRedis } from "../src/lib/store/redis";

const max = Number(process.argv[2] ?? 150), minMentions = Number(process.argv[3] ?? 1);
const all = (await allItems()).filter((i) => i.card);
const ids = new Set(all.map((i) => i.repo.id));
const names = new Set(all.map((i) => i.repo.name.toLowerCase()));
// Things that are not GitHub repos, or are hosted products. Searching them wastes rate limit.
const SKIP = /^(elevenlabs|synthesia|descript|otter\.ai|assemblyai|deepgram|google[- ]cloud.*|azure.*|aws.*|amazon.*|openai.*api|chatgpt|claude|gemini|copilot|github copilot.*|lm[- ]studio|cursor|windsurf|replit|vercel|netlify|supabase|firebase|notion|slack|discord|zoom|figma|canva|jira|linear|datadog|sentry|stripe|twilio|mongodb atlas|snowflake|databricks|hugging ?face|colab|kaggle)$/i;

const want = new Map<string, number>();
for (const it of all) for (const a of it.card!.alternatives) {
  const al = a.toLowerCase().trim().replace(/^https?:\/\/github\.com\//, "");
  if (!al || SKIP.test(al)) continue;
  if (ids.has(al) || names.has(al.split("/").pop()!)) continue;
  want.set(al, (want.get(al) ?? 0) + 1);
}
const todo = [...want].filter(([, n]) => n >= minMentions).sort((a, b) => b[1] - a[1]).slice(0, max);
console.log(`${want.size} unresolved alternatives · doing ${todo.length}`);

interface GhRepo { full_name: string; stargazers_count: number; archived: boolean; fork: boolean }
async function resolve(name: string): Promise<string | null> {
  if (name.includes("/")) return name;
  const q = `${name.replace(/[^a-z0-9._ -]/g, " ")} in:name`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=5`;
  const body = await getJson<{ items: GhRepo[] }>(url, ghHeaders()).catch(() => null);
  if (!body) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = body.items.find((r) => !r.fork && !r.archived && r.stargazers_count >= 50 && norm(r.full_name.split("/")[1]).includes(norm(name).slice(0, 12)));
  return hit ? hit.full_name.toLowerCase() : null;
}

let fetched = 0, carded = 0, miss = 0; const t0 = Date.now();
for (const [name, n] of todo) {
  const id = await resolve(name);
  if (!id) { miss++; process.stdout.write(`\r  ? ${name.padEnd(40)} (×${n})                    `); continue; }
  if (ids.has(id)) continue;
  try {
    const r = await ensureItem(id, { enrich: true });
    if (r.fetched) fetched++; if (r.enriched) carded++;
    process.stdout.write(`\r  ✓ ${name.padEnd(24)} → ${id.padEnd(36)} ${r.enriched ? "carded" : r.exists ? "have" : "gone"} (×${n})     `);
  } catch (e) { console.error(`\n  ${name}: ${(e as Error).message}`); }
  await new Promise((r) => setTimeout(r, 700));   // search API: 30 req/min authenticated
}
console.log(`\n${fetched} fetched · ${carded} carded · ${miss} unresolved · ${Math.round((Date.now() - t0) / 1000)}s`);
console.log("next: pnpm embed && pnpm relate 2000 6");
await invalidate();   // rebuild the read snapshot every process serves from
await closeRedis();
