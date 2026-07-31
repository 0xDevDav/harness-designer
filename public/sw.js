/**
 * Harness Designer service worker.
 *
 * No dependencies and no build-generated file list: fingerprinted names change
 * with every release, so they are cached as they pass through here rather than
 * at install time.
 *
 * Every path is resolved against the scope, because the application has to work
 * when it is served from a subfolder of the host, say /harness/.
 */

/**
 * Renames the cache, which is what invalidates the previous one.
 *
 * The build stamps the version from package.json over this line, so it cannot
 * drift from the program it caches — it did once, and a service worker whose
 * own file never changes is one the browser never replaces: the old cache is
 * then never cleaned and the update never lands. What is written here is only
 * what `npm run dev` sees.
 */
const VERSION = "1.1.1";
const CACHE_PREFIX = "harness-designer-";
const CACHE = CACHE_PREFIX + VERSION;

const SCOPE = new URL("./", self.location.href);
const INDEX = new URL("./index.html", SCOPE).href;
const ASSETS_PATH = new URL("assets/", SCOPE).pathname;

/** Minimum shell for the first offline start. */
const SHELL = ["./", "./index.html", "./manifest.webmanifest"].map((p) => new URL(p, SCOPE).href);

/** Typical name of a fingerprinted file produced by Vite: name-A1b2C3d4.ext */
const FINGERPRINTED = /-[A-Za-z0-9_]{8,}\.[A-Za-z0-9]+$/;

self.addEventListener("install", (event) => {
  // No automatic skipWaiting: an open tab must not change version
  // under the user while they are drawing.
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanup());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  const type = typeof data === "string" ? data : data && data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Fuori origine o fuori scope: nessuna intromissione.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, true));
    return;
  }
  if (isFingerprinted(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request, false));
});

async function precache() {
  const cache = await caches.open(CACHE);
  // Added one at a time: with addAll a single missing address would
  // fallire l'intera installazione.
  await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
}

async function cleanup() {
  const names = await caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n)),
  );
  await self.clients.claim();
}

function isFingerprinted(url) {
  return url.pathname.startsWith(ASSETS_PATH) || FINGERPRINTED.test(url.pathname);
}

/** Only same-origin, complete responses; the rest must not be kept. */
function isCacheable(response) {
  return Boolean(response) && response.ok && response.type === "basic";
}

/** Fingerprinted file: for a given name the content never changes. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone());
  return response;
}

/** Navigation and non-fingerprinted files: the network wins, the cache is the fallback. */
async function networkFirst(request, isNavigation) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (isNavigation) {
      const shell = (await cache.match(INDEX)) || (await cache.match(SCOPE.href));
      if (shell) return shell;
    }
    throw err;
  }
}
