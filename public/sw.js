// Keeps the app's own files on the phone, so it opens without a network.
// Only this site's files: the lists come from GitHub's API, which is never
// cached here (the app keeps its own encrypted copy in IndexedDB).
const CACHE = "todo-lists-v2"

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./index.html", "./manifest.webmanifest"])).then(() => self.skipWaiting()))
})

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener("fetch", event => {
  const req = event.request
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return
  event.respondWith(caches.open(CACHE).then(async cache => {
    // The page itself: the network first, so a new version shows at once;
    // the kept copy when offline.
    if (req.mode === "navigate") {
      try {
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./index.html")) || Response.error()
      }
    }
    // Its files have their content's hash in their names: kept ones serve.
    const cached = await cache.match(req)
    if (cached) return cached
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  }))
})
