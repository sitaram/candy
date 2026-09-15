import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/app/feed/logic.ts"],
      exclude: ["src/lib/**/llm.ts", "src/lib/discover/*.ts", "src/lib/crawl/**", "src/lib/enrich/relate.ts", "src/lib/corpus/backfill.ts", "src/lib/corpus/ensure.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
});
