import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Type checking is already strict in `tsconfig.json`, so what matters here are
 * the rules the compiler does not cover: code evaluated at runtime, forgotten
 * promises, leftover diagnostics.
 *
 * `eslint-config-prettier` comes last: it switches off the purely formatting
 * rules, which are Prettier's business.
 */
export default tseslint.config(
  {
    ignores: ["dist/", "dist-standalone/", "node_modules/", "coverage/", "public/plugins/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The plugin system evaluates code: the exemption is local and documented
      // where it happens, not a blanket permission.
      "no-implied-eval": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Browser APIs often return promises nobody here cares about; declaring
      // that with `void` stays compulsory.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // `String(v)` over an unknown value is how normalization accepts any
      // file: "[object Object]" in place of an object is exactly the intended
      // fallback, not an oversight.
      "@typescript-eslint/no-base-to-string": "off",
      // Plugins hand over functions, not methods bound to an object: the public
      // contract has no `this`.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // The service worker is JavaScript outside the type program, with the
    // globals of its own context rather than the page's.
    files: ["public/**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        Request: "readonly",
        URL: "readonly",
      },
    },
    // the spread's rules have to be kept: overwriting `rules` would wipe them
    // and the type-aware rules would switch back on
    rules: { ...tseslint.configs.disableTypeChecked.rules, "no-undef": "off" },
  },
  {
    // Configuration files run in Node, outside the type program.
    files: ["*.config.ts", "*.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
