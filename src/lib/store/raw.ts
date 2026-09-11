/**
 * Raw documents (README, manifest, releases) are the bulk of corpus memory.
 * Store gzip'd with a marker prefix; read transparently. ~4-5x smaller.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { K } from "./keys";
import { redis } from "./redis";

const MARK = Buffer.from("\u0001gz");
export type RawDoc = "readme" | "manifest" | "releases";

/** Bound each release body: 15 MB of release notes for one repo is not metadata. */
export const MAX_README = 60_000;
export const MAX_RELEASE_BODY = 4_000;
export const MAX_RELEASES = 10;

export function encodeRaw(text: string): Buffer {
  return Buffer.concat([MARK, gzipSync(Buffer.from(text, "utf8"))]);
}

export function decodeRaw(buf: Buffer | null): string {
  if (!buf) return "";
  if (buf.subarray(0, MARK.length).equals(MARK)) return gunzipSync(buf.subarray(MARK.length)).toString("utf8");
  return buf.toString("utf8");
}

export async function setRaw(id: string, doc: RawDoc, text: string): Promise<void> {
  await redis().set(K.raw(id, doc), encodeRaw(text));
}

export async function getRaw(id: string, doc: RawDoc): Promise<string> {
  return decodeRaw(await redis().getBuffer(K.raw(id, doc)));
}

/** Trim releases before storing: cap count and body length. */
export function boundReleases<T extends { body: string | null }>(releases: T[]): T[] {
  return releases.slice(0, MAX_RELEASES).map((r) => ({ ...r, body: r.body ? r.body.slice(0, MAX_RELEASE_BODY) : r.body }));
}
