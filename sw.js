// Offline support: caches the app and emulator engine so it works with no internet.
// Bump VERSION whenever you upload changed files.
const VERSION = "dualscreen-v4";
const CORE = [
  "./", "index.html", "play.html", "manifest.webmanifest",
  "css/app.css", "css/player.css",
  "js/db.js", "js/nds.js", "js/library.js", "js/player.js",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "data/loader.js", "data/emulator.min.js", "data/emulator.min.css", "data/version.json",
  "data/localization/en-US.json",
  "data/compression/extractzip.js", "data/compression/extract7z.js",
  "data/cores/reports/melonds.json", "data/cores/reports/desmume2015.json",
  "data/cores/melonds-wasm.data", "data/cores/desmume2015-wasm.data",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  const url = new URL(req.url);
  const isPage = req.mode === "navigate";
  e.respondWith(
    caches.match(isPage ? url.pathname.replace(/\/$/, "/index.html") : req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      });
      return hit || net.catch(() => caches.match("index.html"));
    })
  );
});
