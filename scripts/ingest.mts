/**
 * Fetch all sources, merge, write data/pool.json.
 * Usage: pnpm ingest
 */
import { mkdir, writeFile } from "node:fs/promises";
import { merge, sources } from "../src/lib/sources/index.ts";
import type { RawItem } from "../src/lib/sources/types.ts";

const results = await Promise.allSettled(sources.map((s) => s.fetch()));

const raw: RawItem[] = [];
sources.forEach((s, i) => {
  const r = results[i];
  if (r.status === "fulfilled") {
    console.log(`${s.name.padEnd(10)} ${String(r.value.length).padStart(4)} items`);
    raw.push(...r.value);
  } else {
    console.error(`${s.name.padEnd(10)} FAILED: ${(r.reason as Error).message}`);
  }
});

const pool = merge(raw).sort((a, b) => b.sources.length - a.sources.length || (b.stars ?? 0) - (a.stars ?? 0));

await mkdir("data", { recursive: true });
await writeFile(
  "data/pool.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), count: pool.length, items: pool }, null, 2),
);

const multi = pool.filter((p) => p.sources.length > 1).length;
console.log(`\nmerged     ${pool.length} unique (${multi} seen in 2+ sources) -> data/pool.json`);
