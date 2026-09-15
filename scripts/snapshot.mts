/**
 * Dump or load the whole corpus so product work never waits on a crawl.
 *   pnpm snapshot                 -> data/snapshot-YYYYMMDD-HHMM.json.gz (+ data/snapshot-latest.json.gz)
 *   pnpm snapshot restore [file]  -> load into REDIS_URL (default: latest). Additive; does not flush.
 *   pnpm snapshot restore --fixture -> load only the 60 top-interest repos (fast dev/test dataset)
 */
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { closeRedis, redis } from "../src/lib/store/redis.ts";

type Entry = { key: string; type: string; value: unknown };

const r = redis();
const [cmd, ...rest] = process.argv.slice(2);

async function dump(): Promise<void> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await r.scan(cursor, "COUNT", 1000);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  const entries: Entry[] = [];
  const B = 200;
  for (let i = 0; i < keys.length; i += B) {
    const slice = keys.slice(i, i + B);
    const tp = r.pipeline();
    for (const k of slice) tp.type(k);
    const types = (await tp.exec())!.map((x) => x[1] as string);
    const p = r.pipeline();
    slice.forEach((k, j) => {
      const t = types[j];
      if (t === "hash") p.hgetall(k);
      else if (t === "set") p.smembers(k);
      else if (t === "zset") p.zrange(k, "0", "-1", "WITHSCORES");
      else if (t === "list") p.lrange(k, "0", "-1");
      // STRING keys hold binary: raw:* is gzip, emb:* is Float32. get() would UTF-8-decode them and turn every
      // invalid byte into U+FFFD — a restore then wrote the mangled bytes back and every README/embedding was
      // unreadable. Bytes in, base64 out.
      else p.getBuffer(k);
    });
    const vals = (await p.exec())!;
    slice.forEach((k, j) => {
      const v = vals[j][1];
      entries.push({ key: k, type: types[j], value: types[j] === "string" && Buffer.isBuffer(v) ? { b64: v.toString("base64") } : v });
    });
    process.stdout.write(`\r${Math.min(i + B, keys.length)}/${keys.length}`);
  }
  await mkdir("data", { recursive: true });
  const d = new Date().toISOString();
  const stamp = `${d.slice(0, 10).replace(/-/g, "")}-${d.slice(11, 16).replace(":", "")}`;
  const file = `data/snapshot-${stamp}.json.gz`;
  const gz = createGzip();
  const out = createWriteStream(file);
  const done = pipeline(gz, out);
  gz.write(JSON.stringify({ at: new Date().toISOString(), keys: keys.length, entries }));
  gz.end();
  await done;
  await copyFile(file, "data/snapshot-latest.json.gz");
  console.log(`\n${keys.length} keys -> ${file}`);
}

async function restore(file: string | undefined, fixture: boolean): Promise<void> {
  if (!file) {
    const files = (await readdir("data")).filter((f) => f.startsWith("snapshot-") && f.endsWith(".json.gz") && !f.includes("latest")).sort();
    file = files.length ? `data/${files[files.length - 1]}` : "data/snapshot-latest.json.gz";
  }
  const chunks: Buffer[] = [];
  await pipeline(createReadStream(file), createGunzip(), async function* (src) {
    for await (const c of src) chunks.push(c as Buffer);
  });
  const snap = JSON.parse(Buffer.concat(chunks).toString()) as { at: string; entries: Entry[] };
  let entries = snap.entries;

  if (fixture) {
    // Keep only the top-60 by card interest, plus global keys, plus everything about those ids.
    const cards = entries.filter((e) => e.key.startsWith("card:")).map((e) => ({ id: e.key.slice(5), interest: Number((e.value as Record<string, string>).interest ?? 0) }));
    const keep = new Set(cards.sort((a, b) => b.interest - a.interest).slice(0, 60).map((c) => c.id));
    const idOf = (k: string) => k.split(":")[1];
    const global = new Set(["frontier", "corpus", "fetched", "discovered"]);
    entries = entries
      .filter((e) => global.has(e.key) || e.key.startsWith("by:") || e.key.startsWith("awesome:") || keep.has(idOf(e.key)))
      .map((e) => {
        if (e.type === "set" && (global.has(e.key) || e.key.startsWith("by:") || e.key.startsWith("awesome:")))
          return { ...e, value: (e.value as string[]).filter((id) => keep.has(id)) };
        if (e.type === "zset") {
          const v = e.value as string[];
          const out: string[] = [];
          for (let i = 0; i < v.length; i += 2) if (keep.has(v[i])) out.push(v[i], v[i + 1]);
          return { ...e, value: out };
        }
        return e;
      })
      .filter((e) => !(Array.isArray(e.value) && e.value.length === 0));
  }

  const B = 200;
  for (let i = 0; i < entries.length; i += B) {
    const p = r.pipeline();
    for (const e of entries.slice(i, i + B)) {
      const v = e.value;
      if (e.type === "hash") p.hset(e.key, v as Record<string, string>);
      else if (e.type === "set") p.sadd(e.key, ...(v as string[]));
      else if (e.type === "zset") {
        const arr = v as string[];
        const args: (string | number)[] = [];
        for (let j = 0; j < arr.length; j += 2) args.push(Number(arr[j + 1]), arr[j]);
        if (args.length) p.zadd(e.key, ...args);
      } else if (e.type === "list") {
        p.del(e.key);
        p.rpush(e.key, ...(v as string[]));
      } else {
        const b = v as { b64?: string } | string;
        // Base64 envelope (new snapshots) or plain string (old ones — text keys survived those; binary ones didn't).
        p.set(e.key, typeof b === "object" && b && "b64" in b ? Buffer.from(b.b64!, "base64") : (b as string));
      }
    }
    await p.exec();
    process.stdout.write(`\r${Math.min(i + B, entries.length)}/${entries.length}`);
  }
  console.log(`\nrestored ${entries.length} keys from ${file} (snapshot ${snap.at})${fixture ? " [fixture: top-60]" : ""}`);
}

if (cmd === "restore") await restore(rest.find((a) => !a.startsWith("--")), rest.includes("--fixture"));
else await dump();
await closeRedis();
