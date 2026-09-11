import { github } from "./github";
import { hn } from "./hn";
import type { RawItem, Source } from "./types";

// ossinsight.ts is kept but disabled: their trending endpoint has been
// returning empty rows since 2026-03 (event capture outage, per data_quality).
export const sources: Source[] = [github, hn];

/** Merge items with the same id; union sources/topics, keep richer fields. */
export function merge(all: RawItem[]): RawItem[] {
  const byId = new Map<string, RawItem>();
  for (const it of all) {
    const key = it.id.toLowerCase();
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, { ...it, topics: [...it.topics], sources: [...it.sources] });
      continue;
    }
    prev.sources = Array.from(new Set([...prev.sources, ...it.sources]));
    prev.topics = Array.from(new Set([...prev.topics, ...it.topics]));
    prev.description = prev.description.length >= it.description.length ? prev.description : it.description;
    prev.stars = Math.max(prev.stars ?? 0, it.stars ?? 0) || undefined;
    prev.language = prev.language ?? it.language;
    prev.ts = prev.ts > it.ts ? prev.ts : it.ts;
    prev.signals = { ...prev.signals, ...it.signals };
  }
  return Array.from(byId.values());
}

export type { RawItem, Source } from "./types";
