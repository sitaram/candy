/**
 * Every environment variable the app reads, in one place, checked once.
 *
 * Reading process.env at the point of use meant a missing key failed deep inside a request — the
 * voice button spun, the card model threw on the 400th repo, the embedder picked a provider by
 * accident. Now: `env.X` is typed and defaulted; `assertEnv()` runs at first import on the server and
 * names every missing *required* key in one message. Optional keys are declared so that the set of
 * things this app depends on is legible without grepping.
 */

const isServer = typeof window === "undefined";

function str(name: string, dflt?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? dflt : v;
}

/**
 * Live view, not a snapshot: each property reads process.env when accessed. A snapshot would be
 * marginally faster and would break every test that sets a key, and any runtime that injects secrets
 * after module load. The cost is a property lookup; nothing here is on a hot path.
 */
export const env = {
  get NODE_ENV() { return process.env.NODE_ENV ?? "development"; },
  get isProd() { return process.env.NODE_ENV === "production"; },
  /** Redis Cloud in prod; local otherwise. */
  get REDIS_URL() { return str("REDIS_URL", "redis://127.0.0.1:6379")!; },
  /** Cards, ask, related labels. Required for anything that enriches. */
  get ANTHROPIC_API_KEY() { return str("ANTHROPIC_API_KEY"); },
  get CANDY_MODEL() { return str("CANDY_MODEL", "claude-haiku-4-5-20251001")!; },
  get CANDY_ASK_MODEL() { return str("CANDY_ASK_MODEL") ?? str("CANDY_MODEL", "claude-haiku-4-5-20251001")!; },
  /** Embeddings (preferred) and realtime voice. */
  get OPENAI_API_KEY() { return str("OPENAI_API_KEY"); },
  /** Embedding fallback when no OpenAI key. */
  get VOYAGE_API_KEY() { return str("VOYAGE_API_KEY"); },
  get REALTIME_MODEL() { return str("REALTIME_MODEL", "gpt-realtime-2.1")!; },
  get REALTIME_VOICE() { return str("REALTIME_VOICE", "marin")!; },
  get REALTIME_TRANSCRIBE() { return str("REALTIME_TRANSCRIBE", "gpt-4o-mini-transcribe")!; },
  /** Raises GitHub's rate limit 60 → 5,000/h. Discovery is unusable without it. */
  get GITHUB_TOKEN() { return str("GITHUB_TOKEN"); },
};

/** Keys the *product* (not the crawl) cannot serve requests without. */
const REQUIRED_PROD: (keyof typeof env)[] = ["REDIS_URL"];

let asserted = false;
/** Throws a single readable error listing every missing required key. Idempotent. Server only. */
export function assertEnv(): void {
  if (asserted || !isServer) return;
  asserted = true;
  const missing = REQUIRED_PROD.filter((k) => !env[k]);
  if (missing.length) throw new Error(`[env] missing required: ${missing.join(", ")} — see .env.example`);
  const soft: string[] = [];
  if (!env.ANTHROPIC_API_KEY) soft.push("ANTHROPIC_API_KEY (cards, ask, related labels, backfill)");
  if (!env.OPENAI_API_KEY) soft.push("OPENAI_API_KEY (voice; embeddings unless VOYAGE_API_KEY)");
  if (!env.GITHUB_TOKEN) soft.push("GITHUB_TOKEN (crawl rate limit 60/h)");
  if (soft.length && !env.isProd) console.warn(`[env] not set: ${soft.join(" · ")}`);
}

/** For call sites that need a key or must refuse clearly: `need("OPENAI_API_KEY")`. */
export function need(k: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "VOYAGE_API_KEY" | "GITHUB_TOKEN"): string {
  const v = env[k];
  if (!v) throw new Error(`[env] ${k} is not set; this feature is unavailable`);
  return v;
}

assertEnv();
