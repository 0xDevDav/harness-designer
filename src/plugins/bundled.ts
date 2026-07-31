/**
 * Built-in plugin sources embedded in the program.
 *
 * In the web distribution the plugins stay separate files under `plugins/`,
 * loaded at runtime, so they can be updated without recompiling. The
 * **single-file** distribution has no folder next to the document, and the
 * browser forbids loading modules from disk under `file://`: there the sources
 * are embedded and this module is swapped for `bundled.standalone.ts`.
 */
export const BUNDLED_SOURCES: Record<string, string> = {};
