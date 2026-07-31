import metraggi from "../../public/plugins/metraggi.js?raw";
import connettoreTondo from "../../public/plugins/connettore-tondo.js?raw";

/**
 * The variant the single-file build uses: the built-in plugin sources are
 * embedded as text and evaluated in memory, with no network request at all. It
 * is the only way they can work when the page is opened from `file://`.
 *
 * The key is the file name, that is the tail of the address the built-in
 * plugins are declared with in `main.ts`.
 */
export const BUNDLED_SOURCES: Record<string, string> = {
  "metraggi.js": metraggi,
  "connettore-tondo.js": connettoreTondo,
};
