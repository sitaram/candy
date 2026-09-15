import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import { MarkdownAsync } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./about.css";
import { DocVoice } from "./DocVoice";

// Rendered per request, not at build: the CSP nonce is per response, and a prerendered page would ship
// inline scripts without it — the browser would then refuse to hydrate.
export const dynamic = "force-dynamic";

// …but the expensive part — parsing 22 KB of markdown through remark/rehype into a React tree — is the same
// every request. Cached per process (the file is read-only in a deployment); only the nonced shell is per-request.
// Cold: ~60–100 ms. Warm: the tree is a constant. Dev re-reads the file when its mtime changes.
let cached: { mtime: number; tree: ReactNode } | null = null;
async function doc(): Promise<ReactNode> {
  const file = path.join(process.cwd(), "docs", "DESIGN.md");
  const mtime = process.env.NODE_ENV === "development" ? (await stat(file)).mtimeMs : 0;
  if (cached && cached.mtime === mtime) return cached.tree;
  const md = await readFile(file, "utf8");
  // MarkdownAsync parses *now* and returns plain <h2>/<p>/<ul> elements — so what we cache is the parsed tree,
  // not a <ReactMarkdown> element that would re-parse on every render.
  const tree = await MarkdownAsync({ remarkPlugins: [remarkGfm], children: md });
  cached = { mtime, tree };
  return tree;
}

/** The design doc, rendered in-app. Same tokens as the feed; no context switch. */
export default async function About() {
  const tree = await doc();
  return (
    <main className="about">
      <header className="feed-head about-head" role="banner">
        <a href="/" className="s-back about-back" aria-label="Back to the feed">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        <a href="/" className="brand">candy</a>
        <span className="head-label">how it works</span>
        <DocVoice />
      </header>
      <article className="prose">{tree}</article>
    </main>
  );
}
