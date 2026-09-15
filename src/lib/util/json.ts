/**
 * JSON from storage is untrusted: a write that was cut off by OOM, a schema that moved, a hand edit.
 * One corrupt string must cost one item, not the whole corpus read that is cached for every user.
 */

const warned = new Set<string>();

/** Parse or return the fallback; never throws. Logs once per distinct `where` per process so a bad row is visible but not noisy. */
export function safeJson<T>(s: string | null | undefined, fallback: T, where = "json"): T {
  if (s == null || s === "") return fallback;
  try { return JSON.parse(s) as T; } catch (e) {
    if (!warned.has(where)) { warned.add(where); console.warn(`[${where}] corrupt JSON (${s.length} chars): ${(e as Error).message}; using fallback. Further ${where} warnings suppressed.`); }
    return fallback;
  }
}
