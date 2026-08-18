// Icon library — built from the user-supplied SVGs:
//   location.svg          -> used for the map pin (outer pin path recolored
//                             per price, house glyph kept white; the 3
//                             decorative star paths were removed and
//                             replaced with a bedroom-count number badge,
//                             per instructions).
//   add_location.svg       -> used whole for the "add a listing" button.
//   noun-car-2009236.svg    -> used whole for the "get directions" button.
// All UI-button icons render white-on-transparent inside the shared
// `.map-btn` (black, rounded, shadowed) wrapper defined in styles.css.

const ICONS = {
  // Compass / recenter-on-me button (no source file provided for this one —
  // kept as a simple generated compass to match the black/white/shadow set)
  compass: `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="white" stroke-width="1.6"/>
      <path d="M15.6 8.4L13 13L8.4 15.6L11 11L15.6 8.4Z" fill="white"/>
      <circle cx="12" cy="12" r="1.3" fill="white"/>
    </svg>`,

  // "Add a listing" button — from add_location.svg (pin + plus badge)
  addLocation: `
    <svg viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M101.8,10.4c-17,1.8-33.4,8.9-45.9,20.2C40.8,44.1,31.5,63.7,29.1,86.7c-1.7,16.8,1.5,35,8.6,49.4c2,4,10.2,16.3,37.1,55.1c19,27.5,34.7,50,34.9,50c0.2,0,2-2.4,4.1-5.3l3.7-5.3l-2.2-3.5c-14.1-22.7-14-50.7,0.3-72.6c10-15.5,25.1-25.9,43-29.8c5.4-1.2,16.6-1.7,22-0.9c2.2,0.3,4.4,0.6,4.9,0.6c0.7,0.1,1.1-0.5,1.9-3.4c7-24.5,2.5-55.6-11.2-75.9C160,21,130.9,7.5,101.8,10.4z M117.7,61.7c10.5,2.7,18.7,10.9,21.5,21.4c0.9,3.5,1,10.3,0.2,13.9c-0.8,3.6-3.8,9.5-6.1,12.3c-5.6,6.5-12.7,10.1-21.2,10.7c-13.8,0.9-27.1-9-30.3-22.6c-2.3-9.5,0.4-19.7,6.9-26.8c1.6-1.8,4.1-3.9,5.5-4.9c2.6-1.8,7.5-3.8,10.7-4.4C108.3,60.6,114.1,60.8,117.7,61.7z" fill="white"/>
      <path d="M166.2,136.4c-28,3.4-48.6,26.7-48.6,54.8c0,21.1,11.8,39.9,30.8,49.1c9.6,4.7,19.4,6.5,29.3,5.4c41.5-4.4,63.4-50.6,40.2-85.3c-3.2-4.9-9.8-11.6-14.4-14.7C192.7,138.4,178.5,134.8,166.2,136.4z M181.1,145.3c17.6,3.4,31.7,16.8,36.3,34.3c1,3.8,1.2,5.7,1.2,10.9c0,3.6-0.2,7.5-0.5,9c-4.2,19.5-18.1,33.3-37.4,37.3c-4.5,1-14.1,0.7-18.9-0.4c-18.3-4.5-32.1-19.1-35.3-37.6c-4.3-24.4,11.9-48.3,36.4-53.5C167,144.5,176.8,144.5,181.1,145.3z" fill="white"/>
      <path d="M170.4,162c-2.2,1.2-2.3,2.1-2.4,13.8v11h-10.9c-13.4,0-14.1,0.2-14.1,4.4c0,1.1,0.4,2,1.2,2.7l1.1,1.2h11.3H168l0.1,11.6l0.1,11.6l1.3,1.1c1.5,1.3,3.1,1.4,5,0.4c0.8-0.4,1.4-0.8,1.5-0.8c0,0,0.2-5.4,0.4-11.9l0.2-11.8l11.1-0.1c11.7-0.1,12.7-0.3,13.6-2.3c0.8-1.9,0.6-3.4-0.8-4.8l-1.3-1.3h-11.4h-11.4v-11.5v-11.5l-1.4-1.2C173.4,161.2,172.1,161,170.4,162z" fill="white"/>
    </svg>`,

  // "Get directions" button — from noun-car-2009236.svg
  car: `
    <svg viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="m1100 487.5v-125c-0.082031-72.91-29.082-142.81-80.637-194.36-51.555-51.555-121.45-80.555-194.36-80.637h-424.24c-73.012-0.015625-143.05 28.926-194.74 80.48-51.695 51.555-80.832 121.51-81.016 194.52v125h-25c-26.523-0.007812-51.965 10.527-70.719 29.281s-29.289 44.195-29.281 70.719v250c-0.0078125 26.523 10.527 51.965 29.281 70.719s44.195 29.289 70.719 29.281v75c0 35.727 19.059 68.738 50 86.602 30.941 17.863 69.059 17.863 100 0 30.941-17.863 50-50.875 50-86.602v-75h600v75c0 35.727 19.059 68.738 50 86.602 30.941 17.863 69.059 17.863 100 0 30.941-17.863 50-50.875 50-86.602v-75c26.523 0.007812 51.965-10.527 70.719-29.281s29.289-44.195 29.281-70.719v-250c0.007812-26.523-10.527-51.965-29.281-70.719s-44.195-29.289-70.719-29.281zm-825-125c0.14062-33.238 13.457-65.066 37.035-88.5 23.574-23.434 55.48-36.559 88.723-36.5h424.24c33.141 0.039062 64.91 13.223 88.344 36.656s36.617 55.203 36.656 88.344v125h-675zm-50 425c-19.891 0-38.969-7.9023-53.031-21.969-14.066-14.062-21.969-33.141-21.969-53.031s7.9023-38.969 21.969-53.031c14.062-14.066 33.141-21.969 53.031-21.969s38.969 7.9023 53.031 21.969c14.066 14.062 21.969 33.141 21.969 53.031 0.027344 19.898-7.8672 38.992-21.938 53.062s-33.164 21.965-53.062 21.938zm750-150c19.891 0 38.969 7.9023 53.031 21.969 14.066 14.062 21.969 33.141 21.969 53.031s-7.9023 38.969-21.969 53.031c-14.062 14.066-33.141 21.969-53.031 21.969s-38.969-7.9023-53.031-21.969c-14.066-14.062-21.969-33.141-21.969-53.031-0.027344-19.898 7.8672-38.992 21.938-53.062s33.164-21.965 53.062-21.938z" fill="white"/>
    </svg>`,

  // Close / X for modals
  close: `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 6l12 12M18 6L6 18" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,

  // Camera glyph for the photo upload control
  camera: `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.1l.9-1.5h7l.9 1.5h2.1A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9z" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="12" cy="13" r="3.2" stroke="white" stroke-width="1.5"/>
    </svg>`,

  // Search glyph for the neighborhood search bar
  search: `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10.5" cy="10.5" r="6" stroke="white" stroke-width="1.6"/>
      <path d="M15.2 15.2L20 20" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
};

// Price-to-color gradient: green (cheapest) -> yellow (mid) -> red (priciest)
// `t` is 0..1, where the caller has already normalized price within the
// current min/max range of active listings.
function priceToColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    { p: 0, c: [34, 197, 94] },   // green  #22c55e
    { p: 0.5, c: [234, 179, 8] }, // yellow #eab308
    { p: 1, c: [239, 68, 68] },   // red    #ef4444
  ];
  let a = stops[0], b = stops[1];
  if (t > 0.5) { a = stops[1]; b = stops[2]; }
  const localT = a.p === b.p ? 0 : (t - a.p) / (b.p - a.p);
  const rgb = a.c.map((v, i) => Math.round(v + (b.c[i] - v) * localT));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

// Builds the map pin from location.svg: the outer pin path is recolored to
// the price-gradient color, the house glyph stays white on top of it, and
// the original 3 decorative star paths are replaced with a dark circle
// badge showing the bedroom count (per instructions: stars -> bedroom
// number). viewBox matches the source file (0 0 256 256) so proportions
// stay faithful to the original artwork.
function makeMarkerSVG(bedrooms, color) {
  return `
    <svg width="42" height="42" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" style="display:block; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));">
      <path d="M118,10.4c-27.5,3.8-50.7,19.7-63.4,43.7c-7.6,14.3-11.3,33.6-8.9,47c4.9,27.8,31.4,77.2,71.6,133.2c8.1,11.3,9.1,12.3,12,11.5c3.4-0.8,36.2-49.5,52.4-77.7c11.9-20.7,22.6-43.7,26.4-56.9c2.5-8.9,3.2-14.5,2.8-22.1c-1.1-21.6-10-41.1-25.5-56.1c-11.6-11.2-25.5-18.4-41.5-21.7C137.8,10.1,123.7,9.6,118,10.4z M142.1,19.9c19.6,3.8,37.6,16,48.3,32.8c5,7.8,8.7,16.8,10.6,26.2c1.4,6.9,1.4,18.7,0,24.6c-6,25.8-28.2,66.5-65.1,119.3c-4.2,6.1-7.8,11.1-8,11.1c-0.3,0-5.2-6.9-14.1-19.9c-37.7-55-58.7-96.8-60.1-119c-0.5-9.2,1.4-20.2,5.3-29.8c10-24.9,32.7-42.5,59.4-46.2C123.7,18.4,136.7,18.8,142.1,19.9z" fill="${color}" stroke="#0f0f0f" stroke-width="3"/>
      <path d="M116.3,89.9c-1.1,1.1-1.4,1.9-1.4,4.4v3h-7.4c-7.2,0-7.5,0.1-8.7,1.4l-1.4,1.3v16.2v16.1h-3c-2.5,0-3.3,0.2-4.4,1.4c-1.8,1.8-1.8,4.3,0,6l1.3,1.4H128h36.7l1.3-1.4c1.8-1.8,1.8-4.3,0-6c-1.1-1.1-1.9-1.4-4.4-1.4h-3v-20.5V91.2l-1.4-1.3l-1.3-1.4h-19.2h-19.2L116.3,89.9z M149.9,114.8v17.5h-13.1h-13.1v-17.5V97.3h13.1h13.1V114.8z M114.9,119.2v13.1h-4.4h-4.4v-13.1V106h4.4h4.4L114.9,119.2L114.9,119.2z" fill="#ffffff"/>
      <circle cx="128" cy="58" r="32" fill="#0f0f0f" stroke="${color}" stroke-width="3"/>
      <text x="128" y="69" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="700" font-size="34" fill="#ffffff">${bedrooms}</text>
    </svg>`;
}
