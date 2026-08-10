import { builtinModules } from "module";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      shared: resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "vigolium-backend",
      fileName: () => "script.js",
      formats: ["es"],
    },
    outDir: "../../dist/backend",
    emptyOutDir: true,
    rollupOptions: {
      // `caido:*` is host-provided; node builtins are supplied by the LLRT
      // runtime, so neither may be bundled in.
      external: [/^caido:.+/, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { manualChunks: undefined },
    },
  },
  test: {
    environment: "node",
    alias: {
      // `caido:*` only resolves inside the plugin runtime.
      "caido:utils": resolve(__dirname, "src/test/caido-stubs.ts"),
      "caido:http": resolve(__dirname, "src/test/caido-stubs.ts"),
      "caido:plugin": resolve(__dirname, "src/test/caido-stubs.ts"),
    },
  },
});
