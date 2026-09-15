import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./about.css";
import { DocVoice } from "./DocVoice";

export const dynamic = "force-static";

/** The design doc, rendered in-app. Same tokens as the feed; no context switch. */
export default async function About() {
  const md = await readFile(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
  return (
    <main className="about">
      <nav className="about-nav">
        <a href="/">← feed</a>
        <span>how it works</span>
        <DocVoice />
      </nav>
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </article>
    </main>
  );
}
