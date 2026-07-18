import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // server-only is a bundler guard; tests run in Node legitimately.
      "server-only": path.resolve(__dirname, "scripts/noop.js"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
