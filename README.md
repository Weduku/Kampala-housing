# Kampala Housing — proof of concept

A Google-Maps-style rental listing prototype for Uganda. No login, no paid
APIs, no backend — built to be pushed straight to a GitHub repo and hosted
free on GitHub Pages.

## Icons

The compass, add-listing, directions, and map-pin icons are built from your
supplied SVGs (`icons/source-svgs/`), wired up in `js/icons.js`. The app
icon (home screen / browser tab) is generated from `icons/source-svgs/city.svg`
by `icons/generate_icons.py` — white square, black border, the city glyph
centered, "KAMPALA" above it and "HOUSING" below. Re-run that script any
time you want to tweak the layout, swap the source SVG, or regenerate at a
different size; it writes `icon-192.png`, `icon-512.png`, and `icon-180.png`
(Apple touch icon) straight into `icons/`.

Note: these are registered in `manifest.json` with `purpose: "any"` only,
not `"maskable"`. A maskable icon needs its content padded inside a safe
center ~80% zone because Android crops it into a circle/squircle — with
text sitting near the top and bottom edges the way you asked for, marking
it maskable would get "KAMPALA"/"HOUSING" clipped on some Android launchers.
If you want a true adaptive-icon version later, that just means generating
a second, more padded variant for that one manifest entry — the button/pin
icons and the rest of the app are unaffected either way.

## What's real vs. simulated in this prototype

**Real:**
- Interactive map (pan, zoom, search-and-fly-to-neighborhood) using
  OpenStreetMap — free, no API key.
- Add-listing flow: real device geolocation capture, draggable pin,
  bedroom/rent/contact form, real photo upload (stored as the actual
  uploaded images).
- Price-gradient marker coloring (green → yellow → red) computed live from
  whatever listings exist.
- "Get directions" opens real Google Maps turn-by-turn navigation via a free
  deep link (`google.com/maps/dir/?api=1&destination=lat,lng`) — no
  Directions API billing involved.
- Installable PWA (manifest + service worker), so "Add to Home Screen"
  genuinely works.
- Real browser/OS notifications with Yes/No actions, using the actual
  Notification and Service Worker APIs — when you click "Simulate weekly
  check-in," a real notification appears and clicking its buttons really
  updates listing data.

**Simulated (and clearly labeled as such in the UI):**
- **Data storage.** Listings live in the browser's `localStorage`, so they
  are per-browser, not shared between a landlord's phone and a renter's
  phone. This is the right trade for a same-screen demo; see "Next step"
  below for making it multi-device.
- **The weekly check-in trigger.** True push notifications that arrive
  days later *without the app being opened* require a small backend
  holding VAPID keys and each device's push subscription, which a static
  GitHub Pages site can't do alone. This prototype instead checks "is a
  check-in due?" every time the app is opened (`checkDueListings()` in
  `js/app.js`), plus a demo button that fast-forwards a listing to 8 days
  old so you can show the real notification firing without waiting a week.
  `service-worker.js` already has a real `push` event handler wired up and
  commented — it's ready the moment a backend exists to call it.

## Running it locally

Service workers require `https://` or `localhost` — opening `index.html`
directly via `file://` will work for the map and forms, but not push/PWA
install. Serve it locally instead:

```bash
cd kampala-housing
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploying to GitHub Pages (free)

1. Create a new GitHub repo and push this folder's contents to it.
2. In the repo: **Settings → Pages → Source** → select the `main` branch,
   root folder.
3. Your app is live at `https://<username>.github.io/<repo-name>/` within a
   few minutes — this is a real HTTPS URL, so notifications and PWA install
   both work.
4. On a phone, open that URL in Chrome (Android) — you'll get an "Add to
   Home Screen" / install prompt. On iPhone, Safari → Share → Add to Home
   Screen (required for iOS push to work at all, per Apple's rules).

No billing account, API key, or payment method is required anywhere in this
stack.

## Presenting the demo

Suggested flow for a live walkthrough:

1. Click **"Load 6 sample listings"** in the bottom-right demo panel — this
   populates the map so it doesn't look empty, and shows off the price
   gradient + bedroom-numbered pins immediately.
2. Pan/zoom the map, then use the search bar to type a neighborhood (e.g.
   "Najjera") and watch it fly there.
3. Tap a marker → shows the scrollable photo gallery popup with the
   neighborhood/contact overlay and the **Get Directions** button (opens
   real Google Maps navigation).
4. Tap the **add-location button** (top-left, under the compass) → walks
   through the real landlord flow: location capture, form fields, photo
   upload (blocks submission under 2 photos), publish.
5. Allow notifications when prompted.
6. Click **"Simulate weekly check-in"** in the demo panel → a real OS
   notification appears asking "Is your listing still available?" with
   Yes/No actions. Tap one and watch the listing status update live.
7. **"Reset all data"** clears everything for the next run-through.

## Known trade-offs worth stating out loud when presenting

- No login means anyone can post as anyone — there's no ownership
  verification beyond "this browser/device created this listing." Fine for
  a proof of concept; worth a real identity/verification layer before
  trusting it with real transactions.
- Neighborhood coordinates are approximate, hand-seeded values for the demo
  — a production version should use verified coordinates or a proper
  geocoder.
- Given the landlord demographic (older, often feature phones, frequently
  no WhatsApp/email), the *real* production check-in channel is more likely
  to be SMS than push notifications — this prototype uses Web Push because
  that's what was asked for a free, GitHub-hosted proof of concept. Swapping
  the channel later doesn't require touching the map, search, or listing
  UI — only `checkDueListings()` / `sendCheckinNotification()` in `js/app.js`
  and the (currently unused) `push` handler in `service-worker.js`.

## Next step: making listings shared across devices

The cleanest free upgrade is Supabase (Postgres + PostGIS + free file
storage + free tier), which replaces the `DB.*` functions in `js/app.js`
with real API calls — the rest of the app (map, forms, markers, popups)
stays the same.
