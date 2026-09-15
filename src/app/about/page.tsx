import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./about.css";
import { DocVoice } from "./DocVoice";

// Rendered per request, not at build: the CSP nonce is per response, and a prerendered page would ship
// inline scripts without it — the browser would then refuse to hydrate. Reading one markdown file is ~1 ms.
export const dynamic = "force-dynamic";

/** The design doc, rendered in-app. Same tokens as the feed; no context switch. */
export default async function About() {
  const md = await readFile(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
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
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </article>
    </main>
  );
}
