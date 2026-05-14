import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: { entry: "main/index.ts", formats: ["es"], fileName: () => "main.js" },
    rollupOptions: {
      // External: anything that must be loaded at RUNTIME rather than bundled.
      //   - node: builtins                  → ESM resolver handles them
      //   - electron                         → injected by Electron
      //   - *.node + node_modules/keytar/    → native bindings (can't be parsed by Rollup)
      //
      // We intentionally let pino + pino-pretty be bundled (pure JS, small).
      // Why: the workspace hoist puts them at the monorepo root node_modules/,
      // but electron-packager only ships apps/desktop/node_modules/ — so an
      // externalised pino would fail at runtime with ERR_MODULE_NOT_FOUND.
      external: [
        /^node:/,
        /\.node$/,
        /[\\/]node_modules[\\/]keytar[\\/]/,
        "electron",
        "keytar",
      ],
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
