/// <reference lib="webworker" />
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";
import { CacheFirst, NetworkOnly } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

// The shell, fonts, icons and the scanner's WASM decoder are precached, so the app opens with no network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Client routes get the shell. The API and health checks never do.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/healthz/, /^\/readyz/],
  }),
);

const onlyOk = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    response.status === 200 ? response : null,
};

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/v1/images/"),
  new CacheFirst({
    cacheName: "plate-images",
    plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 24 * 60 * 60 })],
  }),
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/wasm/"),
  new CacheFirst({
    cacheName: "plate-wasm",
    plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 5, maxAgeSeconds: 365 * 24 * 60 * 60 })],
  }),
);

// The label reader's models and runtime (about 30 MB) are fetched the first time someone scans a label, then kept.
registerRoute(
  ({ url }) => url.pathname.startsWith("/ocr/"),
  new CacheFirst({
    cacheName: "plate-ocr",
    plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 })],
  }),
);

// Dexie is the data cache. A second cache for API rows would fight the sync engine, so the API is never cached.
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());

// Last resort when a navigation fails and even the shell is missing.
setCatchHandler(async ({ request }) => {
  if (request.destination === "document")
    return (await matchPrecache("/offline.html")) ?? Response.error();
  return Response.error();
});

self.addEventListener("message", (event) => {
  if (
    event.data &&
    typeof event.data === "object" &&
    "type" in event.data &&
    event.data.type === "SKIP_WAITING"
  )
    void self.skipWaiting();
});
