/**
 * One place errors go. Client failures arrive via POST /api/err (sendBeacon-safe); server 500s are
 * recorded by the guard. Both land in a global Redis ring buffer so `pnpm errors` shows every crash
 * from every device, newest first, with the request id that ties a client symptom to a server log.
 *
 *   err:log            LIST  JSON ErrorRecord, newest first, capped at 500
 *   err:count:{day}    HASH  fingerprint → count   (dedupe view; 14 d)
 *
 * No third-party sink. When one is wanted, `record()` is the only function to change.
 */
import { redis } from "../store/redis";
import { alert, ERR_SPIKE } from "./alert";

export interface ErrorRecord {
  at: number;
  side: "client" | "server";
  /** Where in the code: "feed", "search", "api:/api/feed", "window", "unhandledrejection". */
  where: string;
  msg: string;
  stack?: string;
  /** Request id from the guard when the error came from or produced an API response. */
  rid?: string;
  status?: number;
  uid?: string;
  url?: string;
  ua?: string;
  /** Anything small and structured the reporter had at hand. Stringified and capped at the door. */
  extra?: string;
}

const CAP = 500;

/** Stable key for "the same error": side + where + first line of the message with numbers/ids stripped. */
export function fingerprint(e: Pick<ErrorRecord, "side" | "where" | "msg">): string {
  const m = e.msg.split("\n")[0].replace(/[0-9a-f]{8,}/gi, "#").replace(/\d+/g, "#").slice(0, 120);
  return `${e.side}:${e.where}:${m}`;
}

export async function record(e: ErrorRecord): Promise<void> {
  try {
    const r = redis();
    const day = new Date(e.at).toISOString().slice(0, 10);
    const p = r.pipeline();
    p.lpush("err:log", JSON.stringify(e));
    p.ltrim("err:log", 0, CAP - 1);
    const fp = fingerprint(e);
    p.hincrby(`err:count:${day}`, fp, 1);
    p.expire(`err:count:${day}`, 14 * 86_400);
    const res = await p.exec();
    const n = Number(res?.[2]?.[1] ?? 0);
    if (n === ERR_SPIKE) alert("error-spike", `"${fp}" has happened ${n}× today (last: ${e.msg.slice(0, 120)})`, `error-spike:${fp}`);
  } catch (err) {
    // The error reporter must never be the thing that throws.
    console.error("[errors] could not record:", (err as Error).message);
  }
}

/** Server-side: called by the guard on 5xx, and by anything that catches and continues. */
export function recordServer(where: string, err: unknown, ctx: Partial<ErrorRecord> = {}): void {
  const e = err as Error;
  void record({ at: Date.now(), side: "server", where, msg: e?.message ?? String(err), stack: (e?.stack ?? "").split("\n").slice(0, 8).join("\n"), ...ctx });
}
