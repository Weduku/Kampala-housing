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
// Neighborhoods seed list (Kampala area) — used for local search-and-zoom.
// Approximate coordinates for demo purposes.
// ---------------------------------------------------------------------------
const NEIGHBORHOODS = [
  { name: "Najjera", lat: 0.3841, lng: 32.6349 },
  { name: "Kyaliwajjala", lat: 0.3937, lng: 32.6467 },
  { name: "Naalya", lat: 0.3765, lng: 32.6285 },
  { name: "Kira", lat: 0.3980, lng: 32.6350 },
  { name: "Kyanja", lat: 0.3850, lng: 32.6050 },
  { name: "Ntinda", lat: 0.3630, lng: 32.6050 },
  { name: "Bukoto", lat: 0.3450, lng: 32.6050 },
  { name: "Kololo", lat: 0.3350, lng: 32.5900 },
  { name: "Nakawa", lat: 0.3330, lng: 32.6150 },
  { name: "Bugolobi", lat: 0.3200, lng: 32.6200 },
  { name: "Kansanga", lat: 0.2950, lng: 32.6050 },
  { name: "Muyenga", lat: 0.2980, lng: 32.5950 },
  { name: "Kabalagala", lat: 0.2990, lng: 32.5990 },
  { name: "Ggaba", lat: 0.2700, lng: 32.6150 },
  { name: "Mengo", lat: 0.3080, lng: 32.5650 },
  { name: "Bukasa", lat: 0.2850, lng: 32.6300 },
];

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

async function runSearch(q) {
  const qLower = q.toLowerCase();
  const localMatches = NEIGHBORHOODS.filter((n) => n.name.toLowerCase().includes(qLower));

  renderSearchResults(
    localMatches.map((n) => ({ label: n.name, sub: "Neighborhood", lat: n.lat, lng: n.lng, geojson: null, bbox: null }))
  );

  if (localMatches.length === 0) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&countrycodes=ug&limit=5&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();
      renderSearchResults(
        data.map((d) => ({
          label: d.display_name.split(",")[0],
          sub: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          geojson: d.geojson && d.geojson.type !== "Point" ? d.geojson : null,
          bbox: d.boundingbox
            ? [
                [parseFloat(d.boundingbox[0]), parseFloat(d.boundingbox[2])],
                [parseFloat(d.boundingbox[1]), parseFloat(d.boundingbox[3])],
              ]
            : null,
        }))
      );
    } catch (e) {
      // silent fail — local results (if any) still stand
    }
  }
}

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
// same idea as Google Maps' search highlight. Real polygon when OSM has
// one; a soft dashed circle fallback otherwise (also what Google itself
// falls back to for places without precise boundary data).
// ---------------------------------------------------------------------------
function clearBoundary() {
  boundaryLayer.clearLayers();
}

function drawBoundaryFromGeoJSON(geojson) {
  clearBoundary();
  if (!geojson) return false;
  L.geoJSON(geojson, { style: { color: "#0f0f0f", weight: 5, opacity: 0.3, fill: false } }).addTo(boundaryLayer);
  L.geoJSON(geojson, {
    style: { color: "#ffffff", weight: 2.4, opacity: 0.95, dashArray: "7,6", fill: false },
  }).addTo(boundaryLayer);
  return true;
}

function drawBoundaryCircle(lat, lng, radius = 750) {
  clearBoundary();
  L.circle([lat, lng], { radius, color: "#0f0f0f", weight: 5, opacity: 0.3, fill: false }).addTo(boundaryLayer);
  L.circle([lat, lng], {
    radius,
    color: "#ffffff",
    weight: 2.4,
    opacity: 0.95,
    dashArray: "7,6",
    fill: false,
  }).addTo(boundaryLayer);
}

async function selectSearchResult(item) {
  searchResults.classList.remove("show");
  searchInput.value = item.label;

  if (item.geojson) {
    drawBoundaryFromGeoJSON(item.geojson);
    if (item.bbox) map.flyToBounds(item.bbox, { duration: 0.8, maxZoom: 16, padding: [40, 40] });
    else map.flyTo([item.lat, item.lng], 15, { duration: 0.8 });
    return;
  }

  // Local neighborhood picks (or point-only OSM results) don't carry a
  // polygon yet — show an immediate dashed-circle placeholder, then try to
  // upgrade to a real boundary from OSM in the background.
  drawBoundaryCircle(item.lat, item.lng);
  map.flyTo([item.lat, item.lng], 15, { duration: 0.8 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&countrycodes=ug&limit=1&q=${encodeURIComponent(item.label + ", Kampala, Uganda")}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data[0] && data[0].geojson && data[0].geojson.type !== "Point") {
      drawBoundaryFromGeoJSON(data[0].geojson);
    }
  } catch (e) {
    // keep the circle fallback already drawn
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
