/**
 * Key schema. Everything is keyed by repo id "owner/name" (lowercased).
 *
 * frontier               ZSET  repo -> priority (sum of discovery weights). Popped by crawler.
 * repo:{id}              HASH  typed fields (see Repo). Written by fetch + extract.
 * raw:{id}:readme        STRING README markdown
 * raw:{id}:manifest      STRING primary manifest text
 * raw:{id}:releases      STRING JSON array of releases
 * mentions:{id}          LIST  JSON Mention[] (who talked about it, where, when)
 * stars:{id}             ZSET  ts -> stars (velocity snapshots)
 * edges:{id}:{type}      SET   related repo ids. type: links | depends | awesome-sibling | same-author
 * edges:{id}:linked-by   SET   reverse of links: repos whose README points at {id} (written with links)
 * awesome:{list}         SET   repo ids in that awesome list
 * tags:{id}              SET   awesome:{list}, lang:{x}, topic:{y}
 * corpus                 SET   all repo ids with repo:{id} populated
 * fetched                ZSET  repo -> fetchedAt ms (for refresh scheduling)
 * discovered             ZSET  repo -> first discovered ms
 */
export const K = {
  frontier: "frontier",
  corpus: "corpus",
  fetched: "fetched",
  discovered: "discovered",
  repo: (id: string) => `repo:${id}`,
  raw: (id: string, doc: "readme" | "manifest" | "releases") => `raw:${id}:${doc}`,
  mentions: (id: string) => `mentions:${id}`,
  stars: (id: string) => `stars:${id}`,
  edges: (id: string, type: EdgeType) => `edges:${id}:${type}`,
  awesome: (list: string) => `awesome:${list}`,
  tags: (id: string) => `tags:${id}`,
} as const;

export type EdgeType = "links" | "depends" | "awesome-sibling" | "same-author" | "linked-by";

export function normId(id: string): string {
  return id.trim().toLowerCase().replace(/\.git$/, "");
}
