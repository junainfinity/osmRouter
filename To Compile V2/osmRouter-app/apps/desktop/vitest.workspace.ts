import { defineWorkspace } from "vitest/config";
import path from "node:path";

const aliases = {
  "@osmrouter/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
};

export default defineWorkspace([
  {
    resolve: { alias: aliases },
    test: {
      name: "unit",
      include: ["tests/unit/**/*.spec.ts"],
      environment: "node",
      testTimeout: 30_000,
    },
  },
  {
    resolve: { alias: aliases },
    test: {
      name: "security",
      include: ["tests/security/**/*.spec.ts"],
      environment: "node",
      testTimeout: 30_000,
    },
  },
  {
    resolve: { alias: aliases },
    test: {
      name: "integration",
      include: ["tests/integration/**/*.spec.ts"],
      environment: "node",
      testTimeout: 60_000,
    },
  },
]);
