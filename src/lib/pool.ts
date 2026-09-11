import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawItem } from "./sources/types";

export interface Pool {
  generatedAt: string;
  count: number;
  items: RawItem[];
}

/** Day-1 store: a JSON file written by `pnpm ingest`. Redis replaces this later. */
export async function loadPool(): Promise<Pool> {
  const file = path.join(process.cwd(), "data", "pool.json");
  try {
    return JSON.parse(await readFile(file, "utf8")) as Pool;
  } catch {
    return { generatedAt: "", count: 0, items: [] };
  }
}
