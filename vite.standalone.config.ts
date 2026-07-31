import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Standalone build: a single `dist-standalone/index.html` with CSS and JS
 * embedded, which opens on a double click with no web server at all.
 * The bundle is IIFE, with no `type="module"`, precisely because ES modules
 * cannot be loaded over the file:// protocol.
 */
function inlineEverything(): Plugin {
  return {
    name: "harness-inline-everything",
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = Object.entries(bundle);
      const html = files.find(([name]) => name.endsWith(".html"));
      if (!html) return;
      const htmlAsset = html[1] as { source: string };
      let source = String(htmlAsset.source);

      for (const [name, chunk] of files) {
        if (name.endsWith(".html")) continue;
        if (chunk.type === "chunk") {
          // The original tag sits in <head> and is a module, hence deferred. A
          // classic script there would run before the document exists, so it is
          // lifted out and put back at the end of the body.
          source = source.replace(
            new RegExp(`\\s*<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`),
            "",
          );
          const script = `<script>\n${chunk.code}\n</script>\n`;
          source = source.includes("</body>")
            ? source.replace("</body>", `${script}</body>`)
            : source + script;
          delete bundle[name];
        } else if (name.endsWith(".css")) {
          const style = `<style>\n${String(chunk.source)}\n</style>`;
          source = source.replace(new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`), () => style);
          delete bundle[name];
        }
      }
      // in the single file there is nothing beside the page: a manifest or a
      // service worker would only produce failed requests
      source = source.replace(/\s*<link[^>]+rel="manifest"[^>]*>/g, "");
      htmlAsset.source = source;
    },
  };
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig({
  base: "./",
  define: { __HARNESS_STANDALONE__: "true" },
  resolve: {
    alias: [
      // the built-in plugins are embedded: under file:// they cannot be loaded
      {
        find: /^\.\/bundled$/,
        replacement: fileURLToPath(new URL("./src/plugins/bundled.standalone.ts", import.meta.url)),
      },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  plugins: [inlineEverything()],
  build: {
    target: "es2022",
    outDir: "dist-standalone",
    cssCodeSplit: false,
    sourcemap: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { format: "iife", inlineDynamicImports: true, entryFileNames: "app.js" },
    },
  },
});
