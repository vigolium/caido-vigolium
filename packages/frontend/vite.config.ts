import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  // Vite does NOT substitute process.env.NODE_ENV in library mode, but Vue and
  // PrimeVue both read it. Left alone the bundle throws "process is not defined"
  // at module-evaluation time - before init() runs, so Caido reports nothing and
  // the plugin simply never appears.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "{}",
  },
  resolve: {
    alias: {
      shared: resolve(__dirname, "../shared/src/index.ts"),
      backend: resolve(__dirname, "../backend/src/index.ts"),
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "vigolium-frontend",
      fileName: () => "script.js",
      formats: ["es"],
    },
    outDir: "../../dist/frontend",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
        // The manifest points at a fixed style filename, so keep it stable.
        assetFileNames: "style.css",
      },
    },
  },
});
