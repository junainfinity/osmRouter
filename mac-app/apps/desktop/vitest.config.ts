import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@osmrouter/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    globals: false,
    reporters: ["default"],
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      include: ["main/**/*.ts", "preload/**/*.ts", "../../packages/shared/src/**/*.ts"],
    },
  },
});
