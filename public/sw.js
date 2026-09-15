// Online-only PWA. Private lessons, authentication, and API responses are never cached here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
