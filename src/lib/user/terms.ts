/**
 * Profile terms as a person would say or read them: cat:ai-llm → "AI and LLM tools", lang:rust → "Rust",
 * mcp → "MCP servers". Used by the voice prompts *and* by the feed's "matches your interest in …" line,
 * which used to show the raw slug ("ai-llm", "local-inference").
 */
const SPOKEN: Record<string, string> = {
  "cat:ai-llm": "AI and LLM tools", "cat:ai-agents": "AI agents", "cat:ml-infra": "ML infrastructure", "cat:dev-tools": "dev tools", "cat:cli": "command-line tools",
  "cat:web-framework": "web frameworks", "cat:frontend": "frontend", "cat:backend": "backend", "cat:database": "databases", "cat:data-eng": "data engineering",
  "cat:devops-infra": "DevOps and infra", "cat:security": "security", "cat:networking": "networking", "cat:systems": "systems programming",
  "cat:languages-compilers": "languages and compilers", "cat:mobile": "mobile", "cat:desktop": "desktop apps", "cat:games-graphics": "games and graphics",
  "cat:science": "scientific computing", "cat:productivity": "productivity", "cat:learning-resource": "learning resources",
  mcp: "MCP servers", llm: "LLM tooling", "local-inference": "local LLMs", rag: "RAG", agents: "agents", cli: "CLI tools", rust: "Rust", python: "Python",
  typescript: "TypeScript", go: "Go", "vs code": "VS Code extensions", vscode: "VS Code extensions", neovim: "Neovim", terminal: "terminal tools",
  "self-hosted": "self-hosted software", "local-first": "local-first apps", kubernetes: "Kubernetes", postgres: "Postgres", postgresql: "Postgres",
  voice: "voice", tts: "text-to-speech", stt: "speech-to-text", testing: "testing", e2e: "end-to-end testing", observability: "observability",
  claude: "Claude tooling", openai: "OpenAI tooling", anthropic: "Anthropic tooling", huggingface: "Hugging Face", "hugging-face": "Hugging Face",
  pytorch: "PyTorch", cuda: "CUDA", react: "React", nextjs: "Next.js", "next.js": "Next.js", vue: "Vue", svelte: "Svelte", tailwind: "Tailwind",
  docker: "Docker", wasm: "WebAssembly", webassembly: "WebAssembly", privacy: "privacy tools", "speaker-diarization": "speaker diarization",
  whisper: "Whisper", langchain: "LangChain", "vector-database": "vector databases", embeddings: "embeddings", "fine-tuning": "fine-tuning",
  "open-source": "open source", oss: "open source", github: "GitHub tooling", git: "Git tools", sqlite: "SQLite", redis: "Redis", graphql: "GraphQL",
};
export function spoken(term: string): string {
  if (SPOKEN[term]) return SPOKEN[term];
  if (term.startsWith("lang:")) { const l = term.slice(5); return l.length <= 3 ? l.toUpperCase() : l[0].toUpperCase() + l.slice(1); }
  if (term.startsWith("cat:")) return term.slice(4).replace(/-/g, " ");
  return term.replace(/-/g, " ");
}


/** Same, for the feed's why[] line: lower-case where the term is a common noun, so "matches your interest in MCP servers, Rust". */
export function readable(term: string): string { return spoken(term); }
