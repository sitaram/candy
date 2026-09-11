export type SourceName = "github" | "ossinsight" | "hn";

export interface RawItem {
  /** Stable id: "owner/repo" for GitHub repos, "hn:<objectID>" otherwise. */
  id: string;
  url: string;
  title: string;
  description: string;
  stars?: number;
  language?: string;
  topics: string[];
  /** ISO timestamp of the event that made this item recent (created, pushed, posted). */
  ts: string;
  /** Which sources surfaced this item. Merged on dedupe. */
  sources: SourceName[];
  /** Source-specific signals for later ranking. */
  signals: Record<string, number | string>;
}

export interface Source {
  name: SourceName;
  fetch(): Promise<RawItem[]>;
}
