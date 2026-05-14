import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: { entry: "preload/index.ts", formats: ["cjs"], fileName: () => "preload.js" },
    rollupOptions: {
      external: ["electron"],
    },
    sourcemap: true,
    minify: false,
    target: "node20",
  },
  resolve: {
    alias: {
      "@osmrouter/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
});
