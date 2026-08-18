// Kampala Housing service worker
// Handles: offline app-shell caching, showing weekly check-in notifications,
// and routing the landlord's Yes/No tap back into the app.
//
// NOTE ON PUSH: True server-sent push (arriving even when the browser is
// fully closed, without the app ever having to be opened) requires a small
// backend holding VAPID keys + subscriptions, which this free static-hosting
// prototype doesn't include yet. This worker DOES implement the real
// `push` event handler below so it's ready to go the moment a backend
// exists — see README.md "Making check-ins real" for the upgrade path.
// For the prototype, the check-in is triggered locally from app.js when the
// landlord opens the app and 7+ days have passed (or via the demo "simulate"
// button), using self.registration.showNotification(), which is genuine,
// real browser/OS notification UI — no fakery, just locally-triggered.

const CACHE_NAME = "rentmap-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/icons.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // network-first for map tiles / API calls, cache-first for app shell
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});

// Real server push (future backend hooks into this)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Kampala Housing", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(showCheckinNotification(data.listingId, data.neighborhood));
});

// Called locally by app.js for the prototype's simulated weekly check-in
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SHOW_CHECKIN") {
    event.waitUntil(
      showCheckinNotification(event.data.listingId, event.data.neighborhood)
    );
  }
});

function showCheckinNotification(listingId, neighborhood) {
  return self.registration.showNotification("Is your listing still available?", {
    body: `Your listing in ${neighborhood || "your neighborhood"} is due for its weekly check-in.`,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: `checkin-${listingId}`,
    requireInteraction: true,
    data: { listingId },
    actions: [
      { action: "yes", title: "Yes, still available" },
      { action: "no", title: "No, remove it" },
    ],
  });
}

self.addEventListener("notificationclick", (event) => {
  const listingId = event.notification.data && event.notification.data.listingId;
  event.notification.close();

  const response = event.action === "no" ? "no" : event.action === "yes" ? "yes" : "open";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const url = self.registration.scope + `index.html?checkin=${listingId}&response=${response}`;
      const existing = clientsArr.find((c) => "focus" in c);
      if (existing) {
        existing.postMessage({ type: "CHECKIN_RESPONSE", listingId, response });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
