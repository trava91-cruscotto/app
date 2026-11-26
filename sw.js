// sw.js — tiene in cache i soli file dell'app, per aprirla senza rete.
//
// I dati non passano da qui: arrivano da api.github.com (altra origine, con
// token) e l'ultima copia buona sta nel localStorage.

const CACHE = "ptf-v1"; // da aumentare a ogni pubblicazione

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/main.js",
  "js/api.js",
  "icons/icon.svg",
];

// GitHub Pages fa tenere i file 10 minuti: con "no-cache" ogni file si
// ricontrolla col server (se non è cambiato risponde 304). Per l'apertura della
// pagina i reindirizzamenti restano al browser: redirect "manual".
const fresco = (req) => (req.mode === "navigate"
  ? new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
  : new Request(req, { cache: "no-cache" }));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la rete, la cache solo se la rete manca.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(fresco(req))
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copia)));
        }
        return resp;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true }))
        || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
  );
});
