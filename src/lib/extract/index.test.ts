import { describe, it, expect } from "vitest";
import { extract, extractDeps } from "./index";
import { reposInText, repoFromUrl, daysAgo } from "../discover/util";

describe("reposInText", () => {
  it("finds owner/repo in URLs, dedupes, strips .git, ignores GitHub's non-user paths and github.io", () => {
    const t = `See https://github.com/OpenAI/codex and https://github.com/openai/codex/issues/1, https://www.github.com/a/b.git.
      Not repos: https://github.com/topics/ai https://github.com/orgs/x https://github.com/foo/github.io https://github.com/sponsors/me`;
    expect(reposInText(t)).toEqual(["OpenAI/codex", "openai/codex", "a/b"]);
  });
  it("does not glue sentence punctuation onto a repo name (regression: 'a/b.git.' → 'a/b.git.')", () => {
    expect(reposInText("Try https://github.com/a/b. Or https://github.com/c/d, then https://github.com/e/f!")).toEqual(["a/b", "c/d", "e/f"]);
    expect(reposInText("https://github.com/a/b.git.")).toEqual(["a/b"]);
  });
  it("schemeless github.com/… is not matched (README links are almost always full URLs; bare mentions are too noisy)", () => {
    expect(reposInText("see github.com/a/b")).toEqual([]);
  });
  it("requires a terminator so a repo inside a longer path is still a repo but a partial name is not glued", () => {
    expect(reposInText("(https://github.com/x/y) [https://github.com/p/q]")).toEqual(["x/y", "p/q"]);
    expect(reposInText('href="https://github.com/u/v"')).toEqual(["u/v"]);
  });
  it("repoFromUrl handles null and non-GitHub urls", () => {
    expect(repoFromUrl("https://github.com/a/b")).toBe("a/b");
    expect(repoFromUrl("https://example.com/a/b")).toBeNull();
    expect(repoFromUrl(null)).toBeNull();
  });
  it("daysAgo is an ISO date", () => {
    expect(daysAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("extract", () => {
  it("hashes the README, counts length, links out (excluding self), caps at 50", () => {
    const links = Array.from({ length: 60 }, (_, i) => `https://github.com/o/r${i}`).join(" ");
    const x = extract("Me/Self", `# t\nhttps://github.com/me/self ${links}`, '{"dependencies":{"a":"1"}}', "npm");
    expect(x.readmeHash).toMatch(/^[0-9a-f]{12}$/);
    expect(x.linkedRepos).toHaveLength(50);
    expect(x.linkedRepos).not.toContain("me/self");
    expect(x.deps).toEqual(["a"]);
    expect(x.depCount).toBe(1);
  });
  it("empty README hashes to empty string", () => {
    expect(extract("a/b", "", "", "none").readmeHash).toBe("");
  });
});

describe("extractDeps", () => {
  it("npm: dependencies + peerDependencies", () => {
    expect(extractDeps('{"dependencies":{"a":"1"},"peerDependencies":{"b":"2"},"devDependencies":{"c":"3"}}', "npm")).toEqual(["a", "b"]);
  });
  it("composer: require minus php and ext-*", () => {
    expect(extractDeps('{"require":{"php":">=8","ext-json":"*","vendor/pkg":"^1"}}', "composer")).toEqual(["vendor/pkg"]);
  });
  it("cargo: [dependencies] table only", () => {
    expect(extractDeps('[package]\nname="x"\n\n[dependencies]\nserde = "1"\ntokio = { version = "1" }\n\n[dev-dependencies]\nrstest = "0"', "cargo")).toEqual(["serde", "tokio"]);
  });
  it("go: require block and single-line requires, skipping comments", () => {
    expect(extractDeps('module m\n\nrequire (\n\tgithub.com/a/b v1.0.0\n\t// github.com/c/d v2\n\tgolang.org/x/net v0.1\n)\nrequire github.com/e/f v3', "go")).toEqual(["github.com/a/b", "golang.org/x/net", "github.com/e/f"]);
  });
  it("pypi: pyproject [project] list, poetry table (minus python), and requirements.txt", () => {
    expect(extractDeps('[project]\ndependencies = [\n  "requests>=2",\n  "numpy",\n]', "pypi")).toEqual(["requests", "numpy"]);
    expect(extractDeps('[tool.poetry.dependencies]\npython = "^3.10"\nhttpx = "*"\n\n[tool.poetry.dev-dependencies]\npytest = "*"', "pypi")).toEqual(["httpx"]);
    expect(extractDeps("# comment\nrequests>=2.0\nnumpy==1.26 ; python_version>'3'\n-e .\nflask[async]\n", "pypi")).toEqual(["requests", "numpy", "flask"]);
  });
  it("unknown kind, empty text, and corrupt JSON all yield []", () => {
    expect(extractDeps("whatever", "gem")).toEqual([]);
    expect(extractDeps("", "npm")).toEqual([]);
    expect(extractDeps("{nope", "npm")).toEqual([]);
  });
});
