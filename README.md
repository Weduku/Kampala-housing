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

## Base map: Google satellite/hybrid tiles

The base layer pulls Google's public satellite (`lyrs=s`) and hybrid
(`lyrs=y`) tile endpoints directly, matching your Kampala Wall Art project —
satellite only below zoom 17, labels/roads fading in above it (see
`LABEL_ZOOM_THRESHOLD` in `js/app.js`).

Same trade-off as discussed before, stated plainly since it matters: this
is **not** the official, key-based Google Maps JavaScript API. It's
unlicensed use of tiles meant for `maps.google.com` itself, against
Google's Terms of Service, and Google can rate-limit or block it without
warning or notice. This app uses it because you're already running the
same approach live on another project and are making that call knowingly.

If it ever gets throttled or blocked, the fix is small — swap
`satelliteLayer`/`labelsLayer` in `js/app.js` back to the Esri World
Imagery URLs (free, no key, fully ToS-compliant, same visual behavior),
or go through the official Google Maps JavaScript API with a billing
account on file. Neither requires touching anything else in the app.

## Neighborhood search — full dataset, real boundaries

The search now covers **1,379 real neighborhoods** across Kampala and
Wakiso, built from the full GKMA village/parish GIS dataset — not a
hand-picked shortlist. This replaced an earlier 16-neighborhood version
that was the actual cause of most searches ("Bulindo", "Banda", "Luzira",
"Kyebando", etc.) turning up nothing; the real GIS data already covered
almost all of them, they just weren't wired in yet.

The build pipeline (`data/source-gis/build_neighborhoods.py`) does this:

1. **Match VILLAGE first.** Every village in the dataset becomes a
   candidate neighborhood, grouped by (base name, subcounty) so sub-areas
   like "MUYENGA A"/"MUYENGA B" or "KIREKA A"–"D" merge into one "Muyenga"
   / "Kireka" entry.
2. **Fall back to PARISH only where no village covers that name in that
   subcounty.** Places like Bukoto, Kololo, Bugolobi, Nakawa, Kabalagala,
   Ggaba, Mengo, and Kansanga aren't named at the village level, so their
   outline is dissolved from the parish instead — including parishes split
   into several sub-areas (e.g. "KOLOLO I" through "IV"), all merged into
   one shape. This check is **scoped per subcounty**, not just by name —
   an earlier version checked names globally and it silently broke: a
   same-named-but-different village 20km away in Busukuma "claimed" the
   name "Ntinda" and caused the real Ntinda (Nakawa) to be dropped
   entirely, because it only exists in this dataset as a parish. Fixed by
   requiring the village match to be in the *same subcounty* before it's
   allowed to override a parish.
3. **Reproject and simplify.** Source data is in EPSG:21096 (Arc 1960 /
   UTM zone 36N); every shape is converted to WGS84, dissolved with
   Shapely, and simplified (~6m tolerance) to keep the total boundary
   payload a reasonable size over mobile data.

Two output files, both in `data/`: `neighborhoods.json` (~148KB — name,
subcounty/district label, centroid, for instant client-side search) and
`neighborhood-boundaries.geojson` (~2MB — the actual polygons, fetched once
and matched by id). The 6MB original source file and the build script live
in `data/source-gis/` so this can be rerun if you get updated data — drop a
new file in as `GKMA_Boundary.geojson` and run
`python3 build_neighborhoods.py` (needs
`pip install pyproj shapely --break-system-packages`).

**Known gaps, stated plainly:**
- This dataset is **Kampala and Wakiso only**. Mukono and Mpigi aren't in
  it at all — searches there fall through to a live OpenStreetMap lookup,
  or the generated approximate outline if OSM has nothing either. If you
  can source equivalent GIS data for those two districts, the same build
  script extends to cover them the same way.
- **"Buwate" isn't in the dataset** under that name (checked directly —
  no village or parish matches it). It'll fall back to OpenStreetMap/
  approximate until better data exists.
- **Kansanga** has no boundary of its own — its only parish record is a
  combined "KANSANGA - MUYENGA" parish, so its outline currently covers a
  wider area that includes Muyenga too.
- **Place names repeat.** This data has two distinct villages both
  literally called "Ntinda" (20km apart), two called "Kireka", two called
  "Banda", and more — all real, different places. Rather than guess, the
  app shows both as separate search results (labeled by subcounty/district)
  when a query is genuinely ambiguous — see the auto-navigate section below
  for exactly when that happens.

For anywhere still uncovered (or if the fetch fails, e.g. testing from
`file://` without a server), the app falls back to a **hand-generated
irregular polygon** (`generateApproxBoundary` in `js/app.js`) — deliberately
not a circle, but illustrative rather than surveyed. If nothing real exists
anywhere, no boundary is drawn at all — showing nothing is more honest than
showing a shape that isn't real.

## Auto-navigate on search

Typing a neighborhood now jumps straight there once you pause — no need to
tap a suggestion first. The rule, implemented in `runSearch()` in
`js/app.js`:

- **Exactly one exact-name match** (or exactly one match at all) → goes
  there automatically.
- **More than one place shares that exact name** (a real, recurring thing
  in this data — see above) → shows a short list instead of guessing,
  since picking wrong here is worse than one extra tap. This is the fix for
  a live bug found while building it: typing "Ntinda" was silently flying
  to the wrong one 20km away before this check existed.
- Pressing **Enter** always jumps to the top-ranked currently-shown result.

This applies the same way to the OpenStreetMap fallback for places outside
the 1,379-neighborhood dataset. That fallback also now **only accepts real
Polygon/MultiPolygon shapes** — it previously accepted anything except a
bare Point, which is what let Kireka render as a stray line: OpenStreetMap
had an open, unclosed LineString for it, not an actual outline. That specific
case is now moot anyway since Kireka has 4 real merged sub-village polygons
in the GKMA dataset, but the type check stays as a general safeguard for
any future place that only resolves through OpenStreetMap.

## Multi-stop route planner

The route icon in the top-left stack (between add-listing and manage
listings) opens a picker of every active listing — select two or more and
it generates one optimized driving route visiting all of them, using
OSRM's free "Trip" service (`js/app.js`, `generateMultiRoute()`) — a
different endpoint from normal point-to-point directions; this one solves
*what order* to visit stops in, not just how to get from A to B. No API key,
same free OSRM public server already used for nothing else in this app
(single-property "Get Directions" still uses a plain Google Maps deep link,
unchanged).

The route draws on the map, and a panel (bottom-left) shows total distance,
estimated driving time, and the optimized stop order. **Clear route**
(trash icon in that panel) removes it. This is public, not admin-gated —
unlike the demo tools and Manage Listings, route planning is a real feature
for anyone browsing listings, not a testing/admin tool.

## Manage listings (admin panel)

The list icon in the top-left control stack (below add-listing) opens a
panel showing every listing currently stored — thumbnail, neighborhood,
bedrooms, rent, landlord contact, and a "sample"/"awaiting check-in" tag
where relevant — with a **Remove** button on each. This is reading and
writing the same local `DB` as the rest of the app, so removing something
here immediately updates the map too. Once a shared backend exists (see
"Next step" below), this becomes a real moderation view instead of a
per-browser one.

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

## Admin-only controls (demo tools + Manage listings)

The demo-tools flyout (bottom-right) and the **Manage listings** button
(top-left, third icon) are hidden from everyone by default — the build you
share publicly for testing shows only the renter/landlord flow: search,
browse, get directions, add a listing.

To see them yourself, open the app once with `?admin=1` appended to the
URL, e.g.:

```
https://<username>.github.io/<repo-name>/index.html?admin=1
```

That flips a flag in `localStorage` on that device/browser, so the admin
controls stay visible on it from then on — you won't need to add the
query param again on that device. The `?admin=1` is stripped from the
address bar right after, so it doesn't linger somewhere it could get
screenshotted or shared by accident. Visit the plain URL (no query param)
on any other device and those controls simply aren't there.

Worth being clear-eyed about: **this is not real security.** It's a
client-side flag — anyone who reads the page's JavaScript or thinks to try
`?admin=1` themselves can see it and use it too. It solves what you asked
for (public testers don't see or stumble into the admin tools), but it
isn't a login system, and shouldn't be trusted to gate anything sensitive.
A real "only me" guarantee needs actual authentication once there's a
backend — worth prioritizing before this app handles anything you'd mind
a stranger tampering with.

## Presenting the demo

Suggested flow for a live walkthrough:

1. Tap the **flask icon** (bottom-right) to open the demo-tools flyout, then
   **"Load 6 sample listings"** (stacked-layers icon) — populates the map so
   it doesn't look empty, and shows off the price gradient + bedroom-numbered
   pins immediately. The flyout collapses back to one icon afterward, so it
   doesn't cover the map on small screens. This button is admin-only — see
   "Admin-only controls" above for how to see it at all.
2. Pan/zoom the satellite map (Google tiles, labels-free by default), then
   type a neighborhood into the search bar — try a common one like "Najjera"
   (goes straight there, one match), then try **"Ntinda"** to show the
   disambiguation case (two real places share that name) versus a unique
   one like "Bulindo" (goes straight there automatically, no click needed).
3. Tap a marker → shows the scrollable photo gallery popup with the
   neighborhood/contact overlay and the **Get Directions** button (opens
   real Google Maps navigation for that one property).
4. Tap the **route icon** (top-left, third button) → **Plan a multi-stop
   route** → pick 2+ listings → generates one optimized driving route
   visiting all of them, with total distance/time and visiting order shown
   in the bottom-left panel.
5. Tap the **add-location button** (top-left, second button) → walks
   through the real landlord flow: location capture, form fields, photo
   upload (blocks submission under 2 photos), publish.
6. Allow notifications when prompted.
7. Open the demo flyout again → **"Simulate weekly check-in"** (bell icon)
   → a real OS notification appears asking "Is your listing still
   available?" with Yes/No actions. Tap one and watch the listing status
   update live.
8. Tap the **list icon** (top-left, last button) → **Manage listings**
   shows every listing currently stored, with a Remove button on each —
   this is the "see and take down what's been posted" admin view. Also
   admin-only.
9. **"Reset all data"** (trash icon in the demo flyout) clears everything
   for the next run-through.

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
