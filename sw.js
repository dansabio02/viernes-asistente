// Service Worker: la app abre instantáneo, pero los archivos locales
// siempre se actualizan desde la red (así los arreglos llegan al instante).
const CACHE = "viernes-v4";
const ASSETS = ["./", "index.html", "viernes.js", "config.js", "icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const esLocal = url.origin === self.location.origin;
  const esAppShell = esLocal && (
    url.pathname === "/" || url.pathname === "/index.html" ||
    url.pathname.endsWith(".js") || url.pathname.endsWith(".webmanifest")
  );

  if (esAppShell) {
    // RED primero: siempre tienes la última versión; cache = respaldo offline
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
