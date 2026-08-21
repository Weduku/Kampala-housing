/* ==========================================================================
   Kampala Housing — proof of concept
   ==========================================================================
   Storage: browser localStorage only (no backend yet). This means listings
   are per-browser, not shared across devices — fine for presenting the full
   user story on one screen, but the first real upgrade needed before
   showing this to actual landlords/renters on separate phones is a shared
   backend (see README.md). Every place that touches storage is isolated in
   the DB.* functions below so that swap is small.

   Check-in: implemented with real Notification/Service Worker APIs. Since
   this is static hosting with no server, the trigger is "on app open, is a
   check-in due?" rather than a true background push — see service-worker.js
   for notes on the upgrade path to real server-sent push.
   ========================================================================== */

const CHECKIN_INTERVAL_DAYS = 7;
const GRACE_HOURS_AFTER_NOTIFY = 48;

// ---------------------------------------------------------------------------
// Tiny local "database" backed by localStorage
// ---------------------------------------------------------------------------
const DB = {
  KEY: "rentmap_listings_v1",
  DEVICE_KEY: "rentmap_device_id_v1",

  all() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || [];
    } catch (e) {
      return [];
    }
  },
  save(listings) {
    localStorage.setItem(this.KEY, JSON.stringify(listings));
  },
  add(listing) {
    const listings = this.all();
    listings.push(listing);
    this.save(listings);
  },
  update(id, patch) {
    const listings = this.all().map((l) => (l.id === id ? { ...l, ...patch } : l));
    this.save(listings);
  },
  remove(id) {
    this.save(this.all().filter((l) => l.id !== id));
  },
  clearAll() {
    localStorage.removeItem(this.KEY);
  },
  deviceId() {
    let id = localStorage.getItem(this.DEVICE_KEY);
    if (!id) {
      id = "dev_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(this.DEVICE_KEY, id);
    }
    return id;
  },
};

const DEVICE_ID = DB.deviceId();

// ---------------------------------------------------------------------------
// Admin mode — hides the demo tools and "manage listings" button from the
// general public. Visit the app once with ?admin=1 on the URL (e.g.
// https://your-site/index.html?admin=1) on your own device/browser; that
// flips a localStorage flag so those controls stay visible on that device
// from then on, without needing the query param again. Anyone who opens
// the plain URL never sees them.
//
// Worth being honest about: this is NOT real security — it's a client-side
// flag, visible to anyone who reads the JS or thinks to try the URL
// parameter. It stops the controls from appearing in front of everyday
// visitors, which is what you asked for, but it isn't a login system and
// shouldn't gate anything sensitive. A real "only me" guarantee needs
// actual auth once there's a backend.
const ADMIN_STORAGE_KEY = "kampala_housing_admin_v1";
function isAdminMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("admin") === "1" || params.get("admin") === "true") {
    localStorage.setItem(ADMIN_STORAGE_KEY, "1");
    // Strip it from the URL so it doesn't linger in the address bar/history
    // if this link ever gets shared or screenshotted by accident.
    params.delete("admin");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? "?" + rest : ""));
  }
  return localStorage.getItem(ADMIN_STORAGE_KEY) === "1";
}
if (isAdminMode()) {
  document.body.classList.add("admin-mode");
}

// ---------------------------------------------------------------------------
// Fallback approximate outline generator — only used now if a searched
// place has no real polygon anywhere (neither the GKMA dataset nor a live
// OpenStreetMap lookup), e.g. most Mukono/Mpigi searches, since the
// uploaded GIS dataset only covers Kampala and Wakiso districts. Deliberately
// NOT a circle (see prior discussion) — a deterministic irregular polygon
// instead, stable across reloads but clearly illustrative, not surveyed.
// ---------------------------------------------------------------------------
function seededRandom(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

function generateApproxBoundary(lat, lng, name, baseRadiusM = 700) {
  const rand = seededRandom(name);
  const points = 9;
  const ring = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const radius = baseRadiusM * (0.68 + rand() * 0.6); // irregular, not a circle
    const dLat = (radius * Math.cos(angle)) / 111320;
    const dLng = (radius * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
    ring.push([lat + dLat, lng + dLng]);
  }
  ring.push(ring[0]); // close the ring
  return ring;
}

// ---------------------------------------------------------------------------
// Neighborhood database — loaded from the full GKMA village/parish dataset
// (data/neighborhoods.json, ~1,367 entries covering Kampala + Wakiso;
// data/neighborhood-boundaries.geojson has the matching real polygons,
// linked by id). This replaces the old hand-picked list of 16 — that list
// was the actual cause of most searches turning up nothing; the real GIS
// data already covered almost everything, it just wasn't wired in.
//
// Mukono and Mpigi districts are NOT in the uploaded dataset — searches
// there fall through to a live OpenStreetMap lookup, or the generated
// approximate outline above if OSM has nothing either.
// ---------------------------------------------------------------------------
let NEIGHBORHOODS = [];
let neighborhoodsReady = false;

async function loadNeighborhoods() {
  try {
    const [idxRes, boundaryRes] = await Promise.all([
      fetch("data/neighborhoods.json"),
      fetch("data/neighborhood-boundaries.geojson"),
    ]);
    const idx = idxRes.ok ? await idxRes.json() : [];
    const boundaryData = boundaryRes.ok ? await boundaryRes.json() : { features: [] };

    const boundaryById = {};
    boundaryData.features.forEach((f) => {
      boundaryById[f.properties.id] = f.geometry;
    });

    NEIGHBORHOODS = idx.map((n) => ({
      ...n,
      realGeoJSON: boundaryById[n.id] || null,
      boundary: null, // computed lazily below only if no real geometry exists
    }));
    NEIGHBORHOODS.forEach((n) => {
      if (!n.realGeoJSON) n.boundary = generateApproxBoundary(n.lat, n.lng, n.name);
    });
  } catch (e) {
    // Data files unavailable (e.g. running from file:// or not deployed yet)
    // — search still works via live OpenStreetMap lookup, just without the
    // local instant results.
    NEIGHBORHOODS = [];
  }
  neighborhoodsReady = true;
}
const neighborhoodsLoadPromise = loadNeighborhoods();

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------
const map = L.map("map", { zoomControl: false }).setView([0.3476, 32.5825], 12);
L.control.zoom({ position: "bottomright" }).addTo(map);

// Satellite/hybrid base — Google's public tile endpoint, matching your
// Kampala Wall Art project. Note this is the same trade-off flagged before:
// it's not the official, key-based Maps JavaScript API, so it's unlicensed
// use of tiles meant for maps.google.com — it can be rate-limited or

// blocked by Google without notice. Using it here since you've already
// run it live on another project and are making that call knowingly; if it
// ever gets throttled, the Esri World Imagery version from before is a
// drop-in fallback (same L.tileLayer shape, no other code changes needed).
const LABEL_ZOOM_THRESHOLD = 17; // roughly a ~150–300m-wide view, adjust to taste
const satelliteLayer = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
  attribution: "Map data &copy; Google",
  subdomains: ["mt0", "mt1", "mt2", "mt3"],
  maxZoom: 20,
}).addTo(map);

const labelsLayer = L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
  attribution: "Map data &copy; Google",
  subdomains: ["mt0", "mt1", "mt2", "mt3"],
  maxZoom: 20,
});

function updateLabelLayer() {
  const shouldShow = map.getZoom() >= LABEL_ZOOM_THRESHOLD;
  const isShown = map.hasLayer(labelsLayer);
  if (shouldShow && !isShown) labelsLayer.addTo(map);
  if (!shouldShow && isShown) map.removeLayer(labelsLayer);
}
map.on("zoomend", updateLabelLayer);
updateLabelLayer();

const markersLayer = L.layerGroup().addTo(map);
const boundaryLayer = L.layerGroup().addTo(map); // dashed neighborhood outline, one at a time
let meMarker = null;
let tempPinMarker = null; // draggable pin shown while the add-listing modal is open

// ---------------------------------------------------------------------------
// Inject icons into buttons
// ---------------------------------------------------------------------------
document.getElementById("btn-locate").innerHTML = ICONS.compass;
document.getElementById("btn-add").innerHTML = ICONS.addLocation;
document.getElementById("btn-manage").innerHTML = ICONS.list;
document.getElementById("btn-route-planner").innerHTML = ICONS.route;
document.getElementById("btn-clear-route").innerHTML = ICONS.trash;
document.getElementById("btn-close-modal").innerHTML = ICONS.close;
document.getElementById("btn-close-admin").innerHTML = ICONS.close;
document.getElementById("search-icon").innerHTML = ICONS.search;
document.getElementById("camera-icon").innerHTML = ICONS.camera;
document.getElementById("btn-demo-toggle").innerHTML = ICONS.flask;
document.getElementById("btn-seed").innerHTML = ICONS.layers;
document.getElementById("btn-simulate").innerHTML = ICONS.bell;
document.getElementById("btn-reset").innerHTML = ICONS.trash;

// ---------------------------------------------------------------------------
// Placeholder photos (no external image hosting needed — zero-cost, no
// network dependency). Swap DB photo strings for real uploaded photos;
// user-submitted listings use real FileReader data URLs, this is only
// for the seeded demo listings.
// ---------------------------------------------------------------------------
function placeholderPhoto(bgHex, label) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
      <rect width="480" height="360" fill="${bgHex}"/>
      <g opacity="0.9">
        <rect x="180" y="140" width="120" height="90" rx="8" fill="rgba(255,255,255,0.25)"/>
        <circle cx="210" cy="170" r="12" fill="rgba(255,255,255,0.5)"/>
        <path d="M180 215 L215 180 L240 205 L265 175 L300 215 Z" fill="rgba(255,255,255,0.4)"/>
      </g>
      <text x="240" y="270" font-family="Arial, sans-serif" font-size="18" fill="rgba(255,255,255,0.85)" text-anchor="middle">${label}</text>
    </svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

// ---------------------------------------------------------------------------
// Sample data for presenting (marked isSeed so it's excluded from the
// weekly check-in loop, which only governs listings *this device* created)
// ---------------------------------------------------------------------------
function seedListings() {
  const samples = [
    { neighborhood: "Najjera", lat: 0.3838, lng: 32.6355, bedrooms: 2, rent: 650000, contact: "0772 100 200", color: "#1d4ed8" },
    { neighborhood: "Kyaliwajjala", lat: 0.3930, lng: 32.6472, bedrooms: 3, rent: 900000, contact: "0752 220 330", color: "#7c3aed" },
    { neighborhood: "Naalya", lat: 0.3760, lng: 32.6290, bedrooms: 1, rent: 400000, contact: "0701 555 900", color: "#059669" },
    { neighborhood: "Ntinda", lat: 0.3625, lng: 32.6058, bedrooms: 4, rent: 1500000, contact: "0788 321 654", color: "#b45309" },
    { neighborhood: "Kira", lat: 0.3975, lng: 32.6345, bedrooms: 2, rent: 700000, contact: "0774 909 111", color: "#0891b2" },
    { neighborhood: "Bukoto", lat: 0.3455, lng: 32.6045, bedrooms: 5, rent: 2200000, contact: "0700 444 222", color: "#be123c" },
  ];
  const now = Date.now();
  const listings = samples.map((s, i) => ({
    id: "seed_" + i,
    isSeed: true,
    deviceId: null,
    bedrooms: s.bedrooms,
    neighborhood: s.neighborhood,
    rentUGX: s.rent,
    contact: s.contact,
    photos: [
      placeholderPhoto(s.color, s.neighborhood + " — photo 1"),
      placeholderPhoto(s.color, s.neighborhood + " — photo 2"),
      placeholderPhoto(s.color, s.neighborhood + " — photo 3"),
    ],
    lat: s.lat,
    lng: s.lng,
    active: true,
    createdAt: now,
    lastConfirmed: now,
    notificationSentAt: null,
  }));
  const existing = DB.all().filter((l) => !l.isSeed);
  DB.save([...existing, ...listings]);
  renderMarkers();
  showToast("6 sample listings loaded");
}

// ---------------------------------------------------------------------------
// UGX formatting
// ---------------------------------------------------------------------------
function formatUGX(n) {
  return "UGX " + Number(n).toLocaleString("en-UG");
}
function formatUGXShort(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderMarkers() {
  markersLayer.clearLayers();
  const active = DB.all().filter((l) => l.active);

  if (active.length === 0) {
    document.getElementById("legend-min").textContent = "—";
    document.getElementById("legend-mid").textContent = "—";
    document.getElementById("legend-max").textContent = "—";
    return;
  }

  const rents = active.map((l) => l.rentUGX);
  const min = Math.min(...rents);
  const max = Math.max(...rents);
  document.getElementById("legend-min").textContent = formatUGXShort(min);
  document.getElementById("legend-mid").textContent = formatUGXShort(Math.round((min + max) / 2));
  document.getElementById("legend-max").textContent = formatUGXShort(max);

  active.forEach((listing) => {
    const t = max === min ? 0.5 : (listing.rentUGX - min) / (max - min);
    const color = priceToColor(t);
    const icon = L.divIcon({
      className: "",
      html: makeMarkerSVG(listing.bedrooms, color),
      iconSize: [42, 42],
      iconAnchor: [21, 40],
      popupAnchor: [0, -38],
    });
    const marker = L.marker([listing.lat, listing.lng], { icon }).addTo(markersLayer);
    marker.bindPopup(buildPopupHTML(listing), { closeButton: true, maxWidth: 260, minWidth: 260 });
    marker.on("popupopen", () => wirePopupEvents(listing));
  });
}

function buildPopupHTML(listing) {
  const imgs = listing.photos
    .map((src) => `<img src="${src}" alt="Property photo" />`)
    .join("");
  return `
    <div class="listing-card" data-id="${listing.id}">
      <div class="gallery">
        ${imgs}
        <div class="gallery-dots">${listing.photos.length} photos</div>
        <div class="gallery-overlay">
          <span class="loc">${escapeHTML(listing.neighborhood)}</span>
          <span class="phone">${escapeHTML(listing.contact)}</span>
        </div>
      </div>
      <div class="body">
        <p class="price">${formatUGX(listing.rentUGX)}<span style="font-weight:500; color:#6b6b70; font-size:12.5px;"> / month</span></p>
        <p class="meta">${listing.bedrooms} bedroom${listing.bedrooms > 1 ? "s" : ""} &middot; ${escapeHTML(listing.neighborhood)}</p>
        <div class="directions-row">
          <button class="map-btn small" data-directions="${listing.lat},${listing.lng}" title="Get directions" aria-label="Get directions"></button>
        </div>
      </div>
    </div>`;
}

function wirePopupEvents(listing) {
  const btn = document.querySelector(`.leaflet-popup [data-directions="${listing.lat},${listing.lng}"]`);
  if (btn) {
    btn.innerHTML = ICONS.car;
    btn.addEventListener("click", () => {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${listing.lat},${listing.lng}&travelmode=driving`;
      window.open(url, "_blank", "noopener");
    });
  }
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ---------------------------------------------------------------------------
// Recenter / "compass" button — Google-Maps-style "find me"
// ---------------------------------------------------------------------------
document.getElementById("btn-locate").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("Geolocation isn't available on this device");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.flyTo([latitude, longitude], 15, { duration: 0.8 });
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#1d4ed8",
        fillOpacity: 1,
      }).addTo(map);
    },
    () => showToast("Couldn't get your location — check location permissions"),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// ---------------------------------------------------------------------------
// Search — local neighborhood list first, live OSM (Nominatim) fallback
// ---------------------------------------------------------------------------
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchDebounce = null;

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  clearTimeout(searchDebounce);
  if (q.length < 2) {
    searchResults.classList.remove("show");
    searchResults.innerHTML = "";
    return;
  }
  searchDebounce = setTimeout(() => runSearch(q), 250);
});

function rankLocalMatches(qLower) {
  return NEIGHBORHOODS.filter((n) => n.name.toLowerCase().includes(qLower)).sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    const aStarts = an.startsWith(qLower) ? 0 : 1;
    const bStarts = bn.startsWith(qLower) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return an.length - bn.length; // more specific/shorter names first
  });
}

function toSearchItem(n) {
  return {
    label: n.name,
    sub: n.sub || "Neighborhood",
    lat: n.lat,
    lng: n.lng,
    geojson: n.realGeoJSON || null,
    bbox: null,
    boundary: n.boundary,
  };
}

let lastRankedResults = [];

async function runSearch(q) {
  await neighborhoodsLoadPromise;
  const qLower = q.toLowerCase().trim();
  if (!qLower) {
    renderSearchResults([]);
    return;
  }

  const ranked = rankLocalMatches(qLower);
  lastRankedResults = ranked;

  // Auto-navigate on a confident match — but "confident" means genuinely
  // unambiguous. Several real places in this dataset share an exact name
  // across different subcounties (e.g. two villages both literally called
  // "Ntinda", 20km apart) — silently picking whichever sorts first was
  // exactly the bug that sent an earlier version of this to the wrong one.
  // So: auto-navigate only when there's exactly one exact-name match, or
  // exactly one candidate at all. Multiple same-name hits still show the
  // list, disambiguated by their subcounty/district label.
  const exactMatches = ranked.filter((n) => n.name.toLowerCase() === qLower);
  if (exactMatches.length === 1) {
    renderSearchResults([]);
    await selectSearchResult(toSearchItem(exactMatches[0]));
    return;
  }
  if (exactMatches.length === 0 && ranked.length === 1) {
    renderSearchResults([]);
    await selectSearchResult(toSearchItem(ranked[0]));
    return;
  }

  const top = ranked.slice(0, 8);
  renderSearchResults(top.map(toSearchItem));

  if (ranked.length === 0) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&countrycodes=ug&limit=5&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();
      // Only Polygon/MultiPolygon count as a real boundary — Nominatim can
      // return LineString for open/unclosed ways, which rendered as a
      // stray line rather than an outline (the Kireka bug).
      const items = data.map((d) => ({
        label: d.display_name.split(",")[0],
        sub: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        geojson: d.geojson && (d.geojson.type === "Polygon" || d.geojson.type === "MultiPolygon") ? d.geojson : null,
        bbox: d.boundingbox
          ? [
              [parseFloat(d.boundingbox[0]), parseFloat(d.boundingbox[2])],
              [parseFloat(d.boundingbox[1]), parseFloat(d.boundingbox[3])],
            ]
          : null,
      }));
      lastRankedResults = [];
      if (items.length === 1) {
        renderSearchResults([]);
        await selectSearchResult(items[0]);
        return;
      }
      renderSearchResults(items);
      // Stash for Enter-to-go
      searchResults.dataset.osmMode = "1";
      window.__lastOsmItems = items;
    } catch (e) {
      // silent fail — local results (if any) still stand
    }
  } else {
    searchResults.dataset.osmMode = "";
  }
}

searchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const osmMode = searchResults.dataset.osmMode === "1";
  if (osmMode && window.__lastOsmItems && window.__lastOsmItems[0]) {
    selectSearchResult(window.__lastOsmItems[0]);
  } else if (!osmMode && lastRankedResults[0]) {
    selectSearchResult(toSearchItem(lastRankedResults[0]));
  }
});

function renderSearchResults(items) {
  if (items.length === 0) {
    searchResults.classList.remove("show");
    searchResults.innerHTML = "";
    return;
  }
  searchResults.innerHTML = items
    .map(
      (it, i) => `<button type="button" data-i="${i}">${escapeHTML(it.label)}<span class="muted">${escapeHTML(it.sub)}</span></button>`
    )
    .join("");
  searchResults.classList.add("show");
  Array.from(searchResults.querySelectorAll("button")).forEach((btn, i) => {
    btn.addEventListener("click", () => selectSearchResult(items[i]));
  });
}

// ---------------------------------------------------------------------------
// Neighborhood boundary — dashed outline shown around the searched area,
// same idea as Google Maps' search highlight. Prefers a real OSM polygon;
// falls back to the hand-generated approximate outline for seeded
// neighborhoods (see generateApproxBoundary above); draws nothing at all
// if neither exists, rather than a misleading circle.
// ---------------------------------------------------------------------------
function clearBoundary() {
  boundaryLayer.clearLayers();
}

function drawBoundaryFromGeoJSON(geojson) {
  clearBoundary();
  if (!geojson) return null;
  L.geoJSON(geojson, { style: { color: "#0f0f0f", weight: 5, opacity: 0.3, fill: false } }).addTo(boundaryLayer);
  const dashed = L.geoJSON(geojson, {
    style: { color: "#ffffff", weight: 2.4, opacity: 0.95, dashArray: "7,6", fill: false },
  }).addTo(boundaryLayer);
  return dashed;
}

function drawBoundaryLatLngs(ring) {
  clearBoundary();
  if (!ring) return false;
  L.polygon(ring, { color: "#0f0f0f", weight: 5, opacity: 0.3, fill: false }).addTo(boundaryLayer);
  L.polygon(ring, {
    color: "#ffffff",
    weight: 2.4,
    opacity: 0.95,
    dashArray: "7,6",
    fill: false,
  }).addTo(boundaryLayer);
  return true;
}

async function selectSearchResult(item) {
  searchResults.classList.remove("show");
  searchInput.value = item.label;

  if (item.geojson) {
    const layer = drawBoundaryFromGeoJSON(item.geojson);
    if (layer && layer.getBounds().isValid()) {
      map.flyToBounds(layer.getBounds(), { duration: 0.8, maxZoom: 16, padding: [50, 50] });
    } else {
      map.flyTo([item.lat, item.lng], 15, { duration: 0.8 });
    }
    return;
  }

  // Show the approximate outline immediately (if this is one of our seeded
  // neighborhoods), then try to upgrade to a real OSM polygon in the
  // background. If there's no local outline and OSM has nothing either,
  // no boundary is drawn — a missing outline is more honest than a wrong one.
  if (item.boundary) drawBoundaryLatLngs(item.boundary);
  else clearBoundary();
  map.flyTo([item.lat, item.lng], 15, { duration: 0.8 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&countrycodes=ug&limit=1&q=${encodeURIComponent(item.label + ", Kampala, Uganda")}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data[0] && data[0].geojson && data[0].geojson.type !== "Point") {
      drawBoundaryFromGeoJSON(data[0].geojson);
    }
  } catch (e) {
    // keep whatever was already drawn (approximate outline, or nothing)
  }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap") && !e.target.closest(".search-results")) {
    searchResults.classList.remove("show");
  }
});

// ---------------------------------------------------------------------------
// Add-listing modal
// ---------------------------------------------------------------------------
const modalBackdrop = document.getElementById("modal-backdrop");
const geoStatusEl = document.getElementById("geo-status");
const geoStatusText = document.getElementById("geo-status-text");
let capturedLatLng = null;

document.getElementById("btn-add").addEventListener("click", openAddModal);
document.getElementById("btn-close-modal").addEventListener("click", closeAddModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeAddModal();
});

function openAddModal() {
  modalBackdrop.classList.add("show");
  requestLocationForNewListing();
  map.on("click", onMapClickWhileAdding);
}

function closeAddModal() {
  modalBackdrop.classList.remove("show");
  map.off("click", onMapClickWhileAdding);
  if (tempPinMarker) {
    map.removeLayer(tempPinMarker);
    tempPinMarker = null;
  }
  capturedLatLng = null;
}

function onMapClickWhileAdding(e) {
  placeTempPin(e.latlng.lat, e.latlng.lng);
  setGeoStatus(true, "Pin placed — drag to fine-tune, or tap elsewhere on the map");
}

function requestLocationForNewListing() {
  setGeoStatus(false, "Requesting your location…");
  if (!navigator.geolocation) {
    setGeoStatus(false, "Location unavailable — tap the map to place your pin");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      placeTempPin(latitude, longitude);
      map.flyTo([latitude, longitude], 16, { duration: 0.6 });
      setGeoStatus(true, "Location captured — drag the pin to fine-tune");
    },
    () => setGeoStatus(false, "Permission denied — tap the map to place your pin manually"),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

document.getElementById("btn-retry-geo").addEventListener("click", requestLocationForNewListing);

function setGeoStatus(ok, text) {
  geoStatusText.textContent = text;
  geoStatusEl.classList.toggle("ok", ok);
}

function placeTempPin(lat, lng) {
  capturedLatLng = { lat, lng };
  if (tempPinMarker) {
    tempPinMarker.setLatLng([lat, lng]);
    return;
  }
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:46px;height:46px;border-radius:12px;background:#0f0f0f;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;">${ICONS.addLocation}</div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 40],
  });
  tempPinMarker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
  tempPinMarker.on("dragend", () => {
    const ll = tempPinMarker.getLatLng();
    capturedLatLng = { lat: ll.lat, lng: ll.lng };
    setGeoStatus(true, "Location captured — drag the pin to fine-tune");
  });
}

// --- Photo picker ---
const photoPicker = document.getElementById("photo-picker");
const photoInput = document.getElementById("f-photos");
const photoPreviews = document.getElementById("photo-previews");
const photoError = document.getElementById("photo-error");
let capturedPhotos = []; // array of data URLs

photoPicker.addEventListener("click", (e) => {
  if (e.target === photoInput) return;
  photoInput.click();
});

photoInput.addEventListener("change", () => {
  const files = Array.from(photoInput.files).slice(0, 8 - capturedPhotos.length);
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      capturedPhotos.push(reader.result);
      renderPhotoPreviews();
    };
    reader.readAsDataURL(file);
  });
  photoInput.value = "";
});

function renderPhotoPreviews() {
  photoPreviews.innerHTML = capturedPhotos
    .map(
      (src, i) => `<div class="thumb"><img src="${src}" alt="Photo ${i + 1}" /><button type="button" data-i="${i}">&times;</button></div>`
    )
    .join("");
  Array.from(photoPreviews.querySelectorAll("button")).forEach((btn) => {
    btn.addEventListener("click", () => {
      capturedPhotos.splice(Number(btn.dataset.i), 1);
      renderPhotoPreviews();
    });
  });
  photoError.classList.toggle("show", false);
}

// --- Form submit ---
document.getElementById("listing-form").addEventListener("submit", (e) => {
  e.preventDefault();

  if (capturedPhotos.length < 2) {
    photoError.classList.add("show");
    photoPicker.classList.add("has-error");
    return;
  }
  if (!capturedLatLng) {
    showToast("Please capture a location first — allow location access or tap the map");
    return;
  }

  const bedrooms = parseInt(document.getElementById("f-bedrooms").value, 10);
  const neighborhood = document.getElementById("f-neighborhood").value.trim();
  const rentUGX = parseInt(document.getElementById("f-rent").value, 10);
  const contact = document.getElementById("f-contact").value.trim();

  const now = Date.now();
  const listing = {
    id: "l_" + Math.random().toString(36).slice(2, 10),
    isSeed: false,
    deviceId: DEVICE_ID,
    bedrooms,
    neighborhood,
    rentUGX,
    contact,
    photos: capturedPhotos.slice(),
    lat: capturedLatLng.lat,
    lng: capturedLatLng.lng,
    active: true,
    createdAt: now,
    lastConfirmed: now,
    notificationSentAt: null,
  };

  DB.add(listing);
  renderMarkers();
  closeAddModal();
  resetForm();
  showToast("Listing published");

  requestNotificationPermissionForCheckins();
});

function resetForm() {
  document.getElementById("listing-form").reset();
  capturedPhotos = [];
  renderPhotoPreviews();
  photoPicker.classList.remove("has-error");
}

// ---------------------------------------------------------------------------
// Weekly check-in: service worker registration + local trigger
// ---------------------------------------------------------------------------
let swRegistration = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .then((reg) => {
      swRegistration = reg;
    })
    .catch(() => {
      // service workers require https or localhost — silently no-op on file://
    });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "CHECKIN_RESPONSE") {
      handleCheckinResponse(event.data.listingId, event.data.response);
    }
  });
}

function requestNotificationPermissionForCheckins() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        showToast("Weekly check-ins enabled for this listing");
      }
    });
  }
}

function checkDueListings() {
  const now = Date.now();
  const mine = DB.all().filter((l) => l.active && l.deviceId === DEVICE_ID);

  mine.forEach((l) => {
    const daysSinceConfirm = (now - l.lastConfirmed) / (1000 * 60 * 60 * 24);
    if (daysSinceConfirm >= CHECKIN_INTERVAL_DAYS && !l.notificationSentAt) {
      DB.update(l.id, { notificationSentAt: now });
      sendCheckinNotification(l);
    }
  });

  runGraceSweep();
}

function sendCheckinNotification(listing) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    // No permission — fall back to an in-app toast so the flow is still visible in the demo
    showToast(`Check-in due for your ${listing.neighborhood} listing (notifications not enabled)`);
    return;
  }
  if (swRegistration && swRegistration.active) {
    swRegistration.active.postMessage({
      type: "SHOW_CHECKIN",
      listingId: listing.id,
      neighborhood: listing.neighborhood,
    });
  } else {
    new Notification("Is your listing still available?", {
      body: `Your listing in ${listing.neighborhood} is due for its weekly check-in.`,
      icon: "icons/icon-192.png",
    });
  }
}

function runGraceSweep() {
  const now = Date.now();
  const mine = DB.all().filter((l) => l.active && l.deviceId === DEVICE_ID && l.notificationSentAt);
  mine.forEach((l) => {
    const hoursSinceSent = (now - l.notificationSentAt) / (1000 * 60 * 60);
    if (hoursSinceSent >= GRACE_HOURS_AFTER_NOTIFY) {
      DB.remove(l.id);
      renderMarkers();
      showToast(`Listing in ${l.neighborhood} removed — no check-in response`);
    }
  });
}

function handleCheckinResponse(listingId, response) {
  const listing = DB.all().find((l) => l.id === listingId);
  if (!listing) return;

  if (response === "yes") {
    DB.update(listingId, { lastConfirmed: Date.now(), notificationSentAt: null });
    showToast(`Thanks — your ${listing.neighborhood} listing stays active`);
  } else if (response === "no") {
    DB.remove(listingId);
    showToast(`Listing in ${listing.neighborhood} removed`);
  }
  renderMarkers();
}

// Handle the case where the notification opened a *new* window/tab
(function handleIncomingCheckinURL() {
  const params = new URLSearchParams(window.location.search);
  const checkinId = params.get("checkin");
  const response = params.get("response");
  if (checkinId && response) {
    handleCheckinResponse(checkinId, response);
    window.history.replaceState({}, "", window.location.pathname);
  }
})();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkDueListings();
});
checkDueListings();

// ---------------------------------------------------------------------------
// Manage listings (admin panel) — lets you actually see what's been posted
// and remove entries. Reads/writes the same local DB as everything else;
// once a shared backend exists this becomes a real moderation view instead
// of a per-browser one.
// ---------------------------------------------------------------------------
const adminBackdrop = document.getElementById("admin-backdrop");
const adminList = document.getElementById("admin-list");
const adminSummary = document.getElementById("admin-summary");

document.getElementById("btn-manage").addEventListener("click", openAdminModal);
document.getElementById("btn-close-admin").addEventListener("click", closeAdminModal);
adminBackdrop.addEventListener("click", (e) => {
  if (e.target === adminBackdrop) closeAdminModal();
});

function openAdminModal() {
  renderAdminList();
  adminBackdrop.classList.add("show");
}
function closeAdminModal() {
  adminBackdrop.classList.remove("show");
}

function renderAdminList() {
  const listings = DB.all().sort((a, b) => b.createdAt - a.createdAt);
  adminSummary.textContent =
    listings.length === 0
      ? "No listings yet."
      : `${listings.length} listing${listings.length > 1 ? "s" : ""} stored on this device.`;

  if (listings.length === 0) {
    adminList.innerHTML = `<div class="admin-empty">Nothing here yet — add a listing, or load the sample set from the demo tools.</div>`;
    return;
  }

  adminList.innerHTML = listings
    .map((l) => {
      const badges = [];
      if (l.isSeed) badges.push(`<span class="admin-badge sample">Sample</span>`);
      if (l.notificationSentAt) badges.push(`<span class="admin-badge pending">Awaiting check-in</span>`);
      return `
        <div class="admin-row" data-id="${l.id}">
          <img class="admin-thumb" src="${l.photos[0] || ""}" alt="" />
          <div class="admin-info">
            <p class="title">${escapeHTML(l.neighborhood)} &middot; ${l.bedrooms} bd &middot; ${formatUGX(l.rentUGX)}</p>
            <p class="sub">${escapeHTML(l.contact)}</p>
            <div class="admin-badges">${badges.join("")}</div>
          </div>
          <button class="admin-remove" data-id="${l.id}">Remove</button>
        </div>`;
    })
    .join("");

  Array.from(adminList.querySelectorAll(".admin-remove")).forEach((btn) => {
    btn.addEventListener("click", () => {
      const listing = DB.all().find((l) => l.id === btn.dataset.id);
      DB.remove(btn.dataset.id);
      renderMarkers();
      renderAdminList();
      if (listing) showToast(`Removed listing in ${listing.neighborhood}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Multi-stop route planner — pick several listings, get one optimized
// driving route visiting all of them, using OSRM's free "Trip" service
// (a different endpoint from normal routing: this one solves *what order*
// to visit stops in, not just point-to-point directions). Free, no API key.
// ---------------------------------------------------------------------------
let routeLayer = null;
let routeUserMarker = null;

const routePlannerBackdrop = document.getElementById("route-planner-backdrop");
const sitePickerList = document.getElementById("site-picker-list");
const routePlannerError = document.getElementById("route-planner-error");
const routePanel = document.getElementById("route-panel");

document.getElementById("btn-route-planner").addEventListener("click", openRoutePlannerModal);
document.getElementById("btn-close-route-planner").addEventListener("click", closeRoutePlannerModal);
routePlannerBackdrop.addEventListener("click", (e) => {
  if (e.target === routePlannerBackdrop) closeRoutePlannerModal();
});
document.getElementById("btn-clear-route").addEventListener("click", clearRoute);
document.getElementById("btn-generate-route").addEventListener("click", generateMultiRoute);

function openRoutePlannerModal() {
  const listings = DB.all().filter((l) => l.active);
  if (listings.length === 0) {
    showToast("No listings to route to yet");
    return;
  }
  sitePickerList.innerHTML = listings
    .map(
      (l) => `
      <div class="site-picker-item">
        <input type="checkbox" id="pick-${l.id}" value="${l.id}" class="route-planner-checkbox" />
        <label for="pick-${l.id}">${escapeHTML(l.neighborhood)} — ${l.bedrooms}bd, ${formatUGX(l.rentUGX)}
          <span class="muted">${escapeHTML(l.contact)}</span>
        </label>
      </div>`
    )
    .join("");
  routePlannerError.classList.remove("show");
  routePlannerBackdrop.classList.add("show");
}

function closeRoutePlannerModal() {
  routePlannerBackdrop.classList.remove("show");
}

async function generateMultiRoute() {
  const checkedIds = Array.from(document.querySelectorAll(".route-planner-checkbox:checked")).map((cb) => cb.value);
  if (checkedIds.length < 2) {
    routePlannerError.classList.add("show");
    return;
  }
  if (!navigator.geolocation) {
    showToast("Your device doesn't support location — can't plan a route from here");
    return;
  }

  const selectedListings = checkedIds.map((id) => DB.all().find((l) => l.id === id)).filter(Boolean);
  closeRoutePlannerModal();
  map.closePopup();

  showToast("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;

      if (routeUserMarker) map.removeLayer(routeUserMarker);
      routeUserMarker = L.circleMarker([userLat, userLng], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#1d4ed8",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup("You are here");

      const coordsStr = [`${userLng},${userLat}`, ...selectedListings.map((l) => `${l.lng},${l.lat}`)].join(";");
      const url = `https://router.project-osrm.org/trip/v1/driving/${coordsStr}?source=first&roundtrip=false&overview=full&geometries=geojson`;

      try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.trips || !data.trips.length) {
          showToast("Could not generate a route for those listings");
          return;
        }
        const trip = data.trips[0];
        const coords = trip.geometry.coordinates.map((c) => [c[1], c[0]]);

        if (routeLayer) map.removeLayer(routeLayer);
        routeLayer = L.polyline(coords, { color: "#1d4ed8", weight: 5, opacity: 0.9 }).addTo(map);
        map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });

        // waypoints[0] is the user's start; the rest correspond to
        // selectedListings in their original order, each carrying its
        // position in the OPTIMIZED visiting sequence via waypoint_index
        const stopOrder = data.waypoints
          .slice(1)
          .map((wp, i) => ({ listing: selectedListings[i], order: wp.waypoint_index }))
          .sort((a, b) => a.order - b.order);

        const km = (trip.distance / 1000).toFixed(1);
        const mins = Math.round(trip.duration / 60);

        document.getElementById("route-panel-title").textContent = `${selectedListings.length}-stop route`;
        document.getElementById("route-panel-stats").textContent = `${km} km · ~${mins} min driving`;
        document.getElementById("route-panel-stops").innerHTML = stopOrder
          .map((s) => `<li>${escapeHTML(s.listing.neighborhood)} — ${s.listing.bedrooms}bd, ${formatUGX(s.listing.rentUGX)}</li>`)
          .join("");
        routePanel.classList.add("show");
      } catch (err) {
        showToast("Could not generate a route right now — try again");
      }
    },
    () => showToast("Could not get your location — check location permissions"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (routeUserMarker) {
    map.removeLayer(routeUserMarker);
    routeUserMarker = null;
  }
  routePanel.classList.remove("show");
}

// ---------------------------------------------------------------------------
// Demo panel wiring (clearly-labeled prototype tooling, not production UI)
// ---------------------------------------------------------------------------
document.getElementById("btn-seed").addEventListener("click", seedListings);

document.getElementById("btn-simulate").addEventListener("click", () => {
  const mine = DB.all().filter((l) => l.active && l.deviceId === DEVICE_ID);
  if (mine.length === 0) {
    showToast("Add a listing from this device first, then simulate its check-in");
    return;
  }
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  mine.forEach((l) => DB.update(l.id, { lastConfirmed: eightDaysAgo, notificationSentAt: null }));
  checkDueListings();
  showToast("Simulated: check-in notification triggered");
});

document.getElementById("btn-reset").addEventListener("click", () => {
  DB.clearAll();
  renderMarkers();
  showToast("All data cleared");
});

// Flyout toggle for the compact demo-tools icon cluster
const demoToggle = document.getElementById("btn-demo-toggle");
const demoFlyout = document.getElementById("demo-flyout");
demoToggle.addEventListener("click", () => {
  demoFlyout.classList.toggle("show");
  demoToggle.classList.toggle("active");
});
demoFlyout.addEventListener("click", (e) => {
  if (e.target.closest("button")) {
    demoFlyout.classList.remove("show");
    demoToggle.classList.remove("active");
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".demo-tools") && demoFlyout.classList.contains("show")) {
    demoFlyout.classList.remove("show");
    demoToggle.classList.remove("active");
  }
});

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------
renderMarkers();
