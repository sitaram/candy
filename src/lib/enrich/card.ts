/**
 * Structured "card" per repo: the typed metadata layer that ranking, feed,
 * and voice read from. Produced once per README hash by an LLM.
 */
export interface Card {
  /** One sentence, plain English, no marketing. What it is and who it is for. */
  pitch: string;
  /** Why an engineer should care right now. 1-2 sentences. Mentions the concrete hook if any. */
  whyCare: string;
  /** 20-40s spoken script for voice. Plain, no markdown, no URLs. */
  voice: string;
  /** Primary category from a fixed list. */
  category: Category;
  /** Free-form tags for similarity. 3-8 lowercase kebab-case. */
  tags: string[];
  /** Who this is for. */
  audience: string[];
  /** Stacks/ecosystems it belongs to (e.g. "node", "python", "react", "kubernetes"). */
  ecosystem: string[];
  maturity: "experiment" | "early" | "usable" | "mature" | "legacy";
  /** Type of thing. */
  kind: Kind;
  /** Named alternatives / competitors, as "owner/repo" if known, else plain names. */
  alternatives: string[];
  /** Repos this builds on, from README. "owner/repo" or plain names. */
  buildsOn: string[];
  /** The concrete reason this is newsworthy, if any. */
  hook: Hook;
  /** 0-10. How interesting to a general software engineer. Honest. Most things are 3-5. */
  interest: number;
  /** Signals the model saw that suggest inflated stars, spam, or low substance. */
  flags: Flag[];
  /** Primary human language of README. ISO 639-1. */
  lang: string;
}

export type Category =
  | "ai-llm"
  | "ai-agents"
  | "ml-infra"
  | "dev-tools"
  | "cli"
  | "web-framework"
  | "frontend"
  | "backend"
  | "database"
  | "data-eng"
  | "devops-infra"
  | "security"
  | "networking"
  | "systems"
  | "languages-compilers"
  | "mobile"
  | "desktop"
  | "games-graphics"
  | "science"
  | "productivity"
  | "learning-resource"
  | "awesome-list"
  | "other";

export type Kind = "library" | "framework" | "app" | "cli" | "service" | "model" | "dataset" | "list" | "tutorial" | "config" | "plugin" | "other";

export type Hook =
  | "new-project"
  | "major-release"
  | "big-org"
  | "viral"
  | "license-change"
  | "novel-approach"
  | "fills-gap"
  | "none";

export type Flag = "spam-suspect" | "star-farm-suspect" | "no-substance" | "non-english" | "abandoned" | "fork-of-known" | "ai-slop";

export const CATEGORIES: Category[] = [
  "ai-llm", "ai-agents", "ml-infra", "dev-tools", "cli", "web-framework", "frontend", "backend", "database",
  "data-eng", "devops-infra", "security", "networking", "systems", "languages-compilers", "mobile", "desktop",
  "games-graphics", "science", "productivity", "learning-resource", "awesome-list", "other",
];
