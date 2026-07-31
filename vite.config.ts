import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { cp, readFile, writeFile } from "node:fs/promises";

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
 * Stamps the version from package.json into the service worker.
 *
 * The name of its cache is the only thing that invalidates the previous one, so
 * a service worker still carrying the last version's number is one the browser
 * has no reason to replace: the old cache is never cleaned and the update never
 * reaches anyone who has been to the site before. Leaving that to be remembered
 * by hand at release time did not work even once, so the build does it.
 *
 * It fails the build rather than passing quietly if the line is not where it
 * expects: a silent miss here is exactly the failure it exists to prevent.
 */
function stampServiceWorker(): Plugin {
  return {
    name: "harness-stamp-sw",
    apply: "build",
    async closeBundle() {
      const target = fileURLToPath(new URL("./dist/sw.js", import.meta.url));
      const source = await readFile(target, "utf8").catch(() => null);
      if (source === null) return; // no service worker in this build
      const line = /const VERSION = "[^"]*";/;
      if (!line.test(source)) throw new Error("sw.js: no VERSION line to stamp the version onto");
      const pkg = await readFile(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8");
      const version = (JSON.parse(pkg) as { version: string }).version;
      await writeFile(target, source.replace(line, `const VERSION = "${version}";`));
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
  plugins: [copyDocs(), stampServiceWorker()],
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
