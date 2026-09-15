/**
 * Signed anonymous session id: `<20 hex>.<12 hex HMAC-SHA256 prefix>`.
 *
 * The id itself is 80 random bits, which nobody will guess. Signing adds nothing against guessing; it
 * closes the other door — a client that *edits* its cookie to any string it likes, which the old regex
 * allowed as long as it was alphanumeric. With a signature the server only ever acts on ids it minted.
 *
 * WebCrypto, not node:crypto, because middleware runs on the edge runtime and the guard runs in node.
 * Keyed by SESSION_SECRET; if unset (dev, tests) a fixed dev key is used and a warning is logged once,
 * so cookies from `pnpm dev` are valid across restarts and the test fixtures do not need a secret.
 *
 * Legacy: an unsigned 20-hex id from before signing is accepted for a while and re-signed on the way
 * through, so nobody loses a profile on deploy. Drop `acceptLegacy` after a cookie lifetime.
 */

const ID_RE = /^[a-f0-9]{20}$/;
const SIG_LEN = 12;
export const acceptLegacy = true;

let keyP: Promise<CryptoKey> | null = null;
let warned = false;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (!warned && process.env.NODE_ENV === "production") { warned = true; console.warn("[sign] SESSION_SECRET is not set; using the dev key. Set it in production."); }
  return "candy-dev-key-not-for-production";
}

function key(): Promise<CryptoKey> {
  return (keyP ??= crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
}

async function mac(id: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(id));
  return Array.from(new Uint8Array(sig).slice(0, SIG_LEN / 2), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export async function sign(id: string): Promise<string> {
  return `${id}.${await mac(id)}`;
}

/**
 * The bare id if the cookie is one we minted, else null. `legacy` is true when the value was an old
 * unsigned id (accepted only while acceptLegacy) so the caller can re-set the cookie signed.
 */
export async function verify(cookie: string | undefined): Promise<{ id: string; legacy: boolean } | null> {
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot < 0) return acceptLegacy && ID_RE.test(cookie) ? { id: cookie, legacy: true } : null;
  const id = cookie.slice(0, dot), sig = cookie.slice(dot + 1);
  if (!ID_RE.test(id) || sig.length !== SIG_LEN) return null;
  const want = await mac(id);
  // Constant-time compare; both are 12 lowercase hex chars.
  let diff = 0;
  for (let i = 0; i < SIG_LEN; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { id, legacy: false } : null;
}

/** For tests: forget the cached key so a changed SESSION_SECRET takes effect. */
export function _resetKey(): void { keyP = null; }
