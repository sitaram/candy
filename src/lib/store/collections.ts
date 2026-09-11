import { normId } from "./keys";
import { redis } from "./redis";

/**
 * collection:{name}      SET  repo ids
 * collections:{id}       SET  collection names (reverse index)
 * collection:meta:{name} HASH description, createdAt, seeds (JSON)
 * collections            SET  all collection names
 */
export const COL = {
  members: (name: string) => `collection:${name}`,
  of: (id: string) => `collections:${id}`,
  meta: (name: string) => `collection:meta:${name}`,
  all: "collections",
};

export async function addToCollection(name: string, ids: string[], meta?: { description?: string; seeds?: string[] }): Promise<void> {
  const r = redis();
  const p = r.pipeline();
  const norm = ids.map(normId);
  if (norm.length) p.sadd(COL.members(name), ...norm);
  for (const id of norm) p.sadd(COL.of(id), name);
  p.sadd(COL.all, name);
  p.hsetnx(COL.meta(name), "createdAt", new Date().toISOString());
  if (meta?.description) p.hset(COL.meta(name), "description", meta.description);
  if (meta?.seeds) p.hset(COL.meta(name), "seeds", JSON.stringify(meta.seeds));
  await p.exec();
}

export async function collectionMembers(name: string): Promise<string[]> {
  return redis().smembers(COL.members(name));
}

export async function collectionsOf(id: string): Promise<string[]> {
  return redis().smembers(COL.of(normId(id)));
}

export async function listCollections(): Promise<{ name: string; count: number; description: string }[]> {
  const r = redis();
  const names = await r.smembers(COL.all);
  const out = await Promise.all(
    names.map(async (name) => ({
      name,
      count: await r.scard(COL.members(name)),
      description: (await r.hget(COL.meta(name), "description")) ?? "",
    })),
  );
  return out.sort((a, b) => b.count - a.count);
}
