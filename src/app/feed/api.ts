/**
 * The one way the client talks to /api.
 *
 * Every route answers 4xx/5xx with `{ error, rid }` and rate limits with 429 + Retry-After; this
 * turns those into an ApiError whose `.message` a person can read, so callers do
 * `catch (e) { setErr(e.message) }` and never show "ask 429" or an empty spinner.
 *
 * - Network failure / timeout → ApiError(0). Default timeout 12 s; the caller's own `signal`
 *   (component unmount) still aborts and propagates as a plain AbortError.
 * - GETs that fail with network or 5xx get one retry after 600 ms. Mutations are never retried.
 * - `post()` is fire-and-forget for reactions: reported, never thrown at gesture code.
 * - `report()` is the single sink for client failures. Console today; a real reporter hangs off it.
 */
import { ship } from "./errship";

export class ApiError extends Error {
  constructor(public status: number, message: string, public rid?: string, public retryAfter?: number) { super(message); this.name = "ApiError"; }
  get isNetwork() { return this.status === 0; }
}

interface Opts extends Omit<RequestInit, "body"> { body?: unknown; timeout?: number; retry?: boolean }

export async function api<T>(url: string, opts: Opts = {}): Promise<T> {
  const { body, timeout = 12_000, retry, ...init } = opts;
  const method = (init.method ?? "GET").toUpperCase();
  const canRetry = retry ?? method === "GET";

  const attempt = async (): Promise<T> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    // Forward the caller's abort; removed in `finally` so a retry does not leave the first attempt's
    // listener on a long-lived signal (the Detail sheet's controller lives as long as the sheet).
    const fwd = () => ac.abort();
    init.signal?.addEventListener("abort", fwd, { once: true });
    let r: Response;
    try {
      r = await fetch(url, {
        ...init, method, signal: ac.signal,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      const timedOut = (e as Error).name === "AbortError";
      throw new ApiError(0, timedOut ? "That took too long. Try again." : typeof navigator !== "undefined" && navigator.onLine === false ? "You’re offline." : "Couldn’t reach the server.");
    } finally { clearTimeout(t); init.signal?.removeEventListener("abort", fwd); }
    if (r.ok) return (r.status === 204 ? undefined : await r.json()) as T;
    const j = (await r.json().catch(() => ({}))) as { error?: string; rid?: string };
    const ra = Number(r.headers.get("retry-after") ?? 0);
    throw new ApiError(r.status, humanize(r.status, j.error, ra), j.rid ?? r.headers.get("x-request-id") ?? undefined, ra || undefined);
  };

  try { return await attempt(); } catch (e) {
    if (canRetry && e instanceof ApiError && (e.isNetwork || e.status >= 500) && !init.signal?.aborted) {
      await new Promise((res) => setTimeout(res, 600));
      return attempt();
    }
    throw e;
  }
}

/** Fire-and-forget mutation. */
export function post(url: string, body?: unknown): void {
  api(url, { method: "POST", body }).catch((e) => report(e, url));
}

/**
 * One sink for client-side failures: console for the developer, POST /api/err for the ring buffer.
 * A 4xx is the user's or our schema's doing, and the server already has it; only 0 (network) and
 * 5xx from ApiError are shipped, plus every non-ApiError (those are bugs).
 */
export function report(e: unknown, where: string): void {
  if (e instanceof ApiError) {
    console.error(`[candy] ${where}: ${e.status} ${e.message}${e.rid ? ` rid=${e.rid}` : ""}`);
    if (e.status === 0 || e.status >= 500) ship({ where, msg: e.message, rid: e.rid, status: e.status });
    return;
  }
  const err = e as Error;
  if (err?.name === "AbortError") return;
  console.error(`[candy] ${where}:`, e);
  ship({ where, msg: err?.message ?? String(e), stack: err?.stack });
}

function humanize(status: number, serverMsg: string | undefined, retryAfter: number): string {
  switch (status) {
    case 400: return serverMsg ?? "That request didn’t make sense.";
    case 401: return "Session expired — reload the page.";
    case 404: return serverMsg ?? "Not found.";
    case 413: return "That was too much text.";
    case 429: return retryAfter > 90 ? `Slow down a little — try again in ${Math.ceil(retryAfter / 60)} min.` : `Slow down a little — try again in ${Math.max(1, retryAfter)}s.`;
    case 502: case 503: return serverMsg ?? "A service we depend on is having trouble. Try again shortly.";
    case 500: return "Something broke on our side. It has been logged.";
    default: return serverMsg ?? `Request failed (${status}).`;
  }
}
