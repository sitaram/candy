import { createHash } from "node:crypto";
import { reposInText } from "../discover/util";

export interface Extracted {
  readmeLen: number;
  readmeHash: string;
  linkedRepos: string[];
  deps: string[];
  depCount: number;
}

/** Pure: raw docs -> typed fields + edge candidates. No network. Re-runnable. */
export function extract(id: string, readme: string, manifest: string, manifestKind: string): Extracted {
  const linked = reposInText(readme).filter((r) => r.toLowerCase() !== id.toLowerCase());
  const deps = extractDeps(manifest, manifestKind);
  return {
    readmeLen: readme.length,
    readmeHash: readme ? createHash("sha1").update(readme).digest("hex").slice(0, 12) : "",
    linkedRepos: linked.slice(0, 50),
    deps,
    depCount: deps.length,
  };
}

export function extractDeps(text: string, kind: string): string[] {
  if (!text) return [];
  try {
    switch (kind) {
      case "npm": {
        const j = JSON.parse(text) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
        return Object.keys({ ...(j.dependencies ?? {}), ...(j.peerDependencies ?? {}) });
      }
      case "composer": {
        const j = JSON.parse(text) as { require?: Record<string, string> };
        return Object.keys(j.require ?? {}).filter((k) => k !== "php" && !k.startsWith("ext-"));
      }
      case "cargo": {
        const m = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text);
        return m ? Array.from(m[1].matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm), (x) => x[1]) : [];
      }
      case "go": {
        const block = /require\s*\(([\s\S]*?)\)/.exec(text)?.[1] ?? "";
        const single = Array.from(text.matchAll(/^require\s+(\S+)\s+v/gm), (x) => x[1]);
        return [...Array.from(block.matchAll(/^\s*(\S+)\s+v/gm), (x) => x[1]), ...single].filter((d) => !d.startsWith("//"));
      }
      case "pypi": {
        if (text.includes("[project]") || text.includes("[tool.poetry")) {
          const m = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
          const list = m ? Array.from(m[1].matchAll(/["']([A-Za-z0-9_.-]+)/g), (x) => x[1]) : [];
          const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text);
          const p2 = poetry ? Array.from(poetry[1].matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm), (x) => x[1]).filter((d) => d !== "python") : [];
          return Array.from(new Set([...list, ...p2]));
        }
        return text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
          .map((l) => l.split(/[<>=!~;\[ ]/)[0])
          .filter(Boolean);
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}
