/**
 * Shared request schemas. Every route parses with these; nothing else reads req.json() or
 * searchParams directly. Keep the limits here honest about what the code behind them can afford.
 */
import { z } from "zod";
import { CATEGORIES } from "@/lib/enrich/card";

/** `owner/name`. GitHub's own rules: 1–39 chars each, [A-Za-z0-9._-], no leading dot. Lower-cased. */
export const RepoId = z
  .string()
  .trim()
  .transform((s) => s.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,38})\/[a-z0-9._-]{1,100}$/, "expected owner/name"));

/** One path segment of a repo id, as it arrives from the router (not yet joined). */
export const RepoSeg = z.string().trim().min(1).max(100).regex(/^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]+$/, "bad path segment");

/** Query-string integer with bounds; tolerates the string form URLSearchParams hands us. */
export const Int = (min: number, max: number, dflt: number) =>
  z.preprocess((v) => (v === undefined || v === "" ? dflt : Number(v)), z.number().int().min(min).max(max));

/** Repeatable query param → string[]; a single value is fine too. */
export const Many = (item: z.ZodTypeAny, max = 50) =>
  z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(item).max(max));

/** Free text the user typed. Trimmed, bounded, control chars stripped. */
export const Text = (max: number) =>
  z.string().transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()).pipe(z.string().max(max));

export const Action = z.enum(["like", "skip", "save", "dive", "unsave", "undo"]);
export const Sort = z.enum(["interest", "velocity", "released", "priority", "stars", "created", "random"]);
export const Category = z.enum(CATEGORIES as [string, ...string[]]);
export const Hook = z.enum(["new-project", "major-release", "big-org", "viral", "license-change", "novel-approach", "fills-gap", "none"]);
export const Tag = z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9._+-]*$/i, "bad tag");
export const Why = Many(Text(200), 12);

// ---- per-route ----

export const FeedQuery = z.object({
  n: Int(1, 100, 30),
  exclude: Many(RepoId, 200),
});

export const SearchQuery = z.object({
  q: Text(200).default(""),
  n: Int(1, 40, 20),
});

export const ReactBody = z.object({
  id: RepoId,
  kind: Action,
});

export const AskBody = z.object({
  id: RepoId,
  question: Text(1_000).pipe(z.string().min(1, "question is empty")),
  history: z.array(z.object({ q: Text(1_000), a: Text(4_000) })).max(8).optional(),
  spoken: z.boolean().optional(),
});

export const ItemsQuery = z.object({
  sort: Sort.default("interest"),
  limit: Int(1, 200, 50),
  category: Many(Category, 10),
  tag: Many(Tag, 10),
  hook: Many(Hook, 8),
  minInterest: z.preprocess((v) => (v === undefined || v === "" ? undefined : Number(v)), z.number().min(0).max(10).optional()),
  language: z.string().trim().max(40).optional(),
  createdWithinDays: Int(1, 3650, 0).optional(),
  releasedWithinDays: Int(1, 3650, 0).optional(),
  source: z.string().trim().max(40).optional(),
  collection: z.string().trim().max(80).optional(),
  cardsOnly: z.preprocess((v) => v !== "0", z.boolean()),
  exclude: Many(RepoId, 200),
});

export const ItemParams = z.object({ owner: RepoSeg, name: RepoSeg });

export const VoiceSessionBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("card"), id: RepoId, why: Why.optional() }),
  z.object({ mode: z.literal("search"), query: Text(200).optional() }),
]).or(
  // Legacy: no mode means card.
  z.object({ mode: z.undefined(), id: RepoId, why: Why.optional() }).transform((b) => ({ ...b, mode: "card" as const })),
);

export const VoiceToolBody = z.object({
  name: z.enum(["get_repo", "ask_repo", "find_repos"]),
  args: z.record(z.string(), z.unknown()).default({}),
  current: RepoId.optional(),
});

export const VoiceBriefQuery = z.object({ id: RepoId, why: Why });

export const VoiceTrace = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().max(64).optional(),
  mode: z.string().max(16).optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  entries: z.array(z.unknown()).max(5_000).optional(),
});

/** Client error beacon. Everything bounded; the client is not trusted to be brief. */
export const ClientError = z.object({
  where: Text(80),
  msg: Text(600),
  stack: Text(3000).optional(),
  rid: z.string().max(16).optional(),
  status: z.number().int().min(0).max(999).optional(),
  url: Text(300).optional(),
  extra: z.unknown().optional(),
});
