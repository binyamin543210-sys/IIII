// Simple service worker for caching BNAPP Calendar

const CACHE_NAME = "bnapp-v3";

const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/firebase-config.js",
  "/manifest.json"
];

// Install
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate – מחיקה של קבצים ישנים
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
});

// Fetch – טעינה מהמטמון + עדכון
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return (
        cached ||
        fetch(e.request).catch(() =>
          cached || new Response("Offline", { status: 503 })
        )
      );
    })
  );
});
