import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { cp } from "node:fs/promises";

/**
 * The plugin guide lives in `docs/`, where developers read it on the
 * repository, but the application panel links it with a relative path: without
 * this copy it would answer 404 in production.
 */
function copyDocs(): Plugin {
  return {
    name: "harness-copy-docs",
    apply: "build",
    async closeBundle() {
      const from = fileURLToPath(new URL("./docs", import.meta.url));
      const to = fileURLToPath(new URL("./dist/docs", import.meta.url));
      await cp(from, to, { recursive: true }).catch(() => {
        /* the documentation is not essential to running the app */
      });
    },
  };
}

/**
 * Static build: no backend, no environment variables.
 * `base: "./"` produces relative references, so `dist/` works both at the root
 * of a domain and inside a subfolder.
 */
export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [copyDocs()],
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5173, open: false },
  preview: { port: 4173 },
});
