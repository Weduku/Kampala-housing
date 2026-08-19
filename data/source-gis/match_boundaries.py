"""
Matches the app's 16 seeded neighborhood names to the uploaded GKMA
village/parish boundary dataset, reprojects from EPSG:21096 (Arc 1960 /
UTM 36N) to WGS84 (EPSG:4326), dissolves multi-part matches into a single
clean outline per neighborhood, and writes the result as a small GeoJSON
file the app can load directly.

Matching rule (per instructions):
  1. Try VILLAGE first. A match is either an exact name match, or an exact
     match after stripping a trailing "A"/"B"/"I"/"II"/"III"/"IV" sub-area
     suffix (handles e.g. "MUYENGA A" + "MUYENGA B" both belonging to
     "Muyenga"). Deliberately NOT a loose substring match — that produced
     false positives (e.g. "NAKAKOLOLO" incorrectly matching "Kololo").
  2. If no VILLAGE match, fall back to PARISH with the same rule. A parish
     can be split into numbered sub-parishes (e.g. "KOLOLO I".."IV") — all
     matching parish features are unioned into one boundary.
  3. No match at all -> left for the app's existing generated-approximate
     fallback (unchanged).
"""
import json
import re
import math
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform as shp_transform

import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(SCRIPT_DIR, "GKMA_Boundary.geojson")
OUT = os.path.join(SCRIPT_DIR, "..", "neighborhood-boundaries.geojson")
OUT_REPORT = os.path.join(SCRIPT_DIR, "boundary-match-report.txt")

# name -> approximate (lat, lng) already used as the seed pin in js/app.js —
# used as a sanity check so a same-named village in a totally different part
# of Uganda (a real, fairly common thing) doesn't get matched by name alone.
NAMES = {
    "Najjera": (0.3841, 32.6349),
    "Kyaliwajjala": (0.3937, 32.6467),
    "Naalya": (0.3765, 32.6285),
    "Kira": (0.3980, 32.6350),
    "Kyanja": (0.3850, 32.6050),
    "Ntinda": (0.3630, 32.6050),
    "Bukoto": (0.3450, 32.6050),
    "Kololo": (0.3350, 32.5900),
    "Nakawa": (0.3330, 32.6150),
    "Bugolobi": (0.3200, 32.6200),
    "Kansanga": (0.2950, 32.6050),
    "Muyenga": (0.2980, 32.5950),
    "Kabalagala": (0.2990, 32.5990),
    "Ggaba": (0.2700, 32.6150),
    "Mengo": (0.3080, 32.5650),
    "Bukasa": (0.2850, 32.6300),
}

MAX_DISTANCE_KM = 8.0  # reject any candidate further than this from the seed point

SUFFIX_RE = re.compile(r"\s+(A|B|C|D|I|II|III|IV|V)$")


def base_name(n):
    return SUFFIX_RE.sub("", n).strip()


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_matches(feats, field, target_up, allow_hyphen_split=False):
    out = []
    for f in feats:
        val = (f["properties"].get(field) or "").strip().upper()
        if not val:
            continue
        if val == target_up or base_name(val) == target_up:
            out.append(f)
            continue
        # Combined parish names like "KANSANGA - MUYENGA" cover two
        # neighborhoods in one parish record — match if the target is one
        # of the hyphen-separated components. Restricted to PARISH: at the
        # VILLAGE level, hyphenated names (e.g. "BUGIRI-BUKASA") are
        # distinct villages that merely reference a neighboring place,
        # not sub-parts of the target neighborhood.
        if allow_hyphen_split and "-" in val:
            components = [c.strip() for c in val.split("-")]
            if target_up in components:
                out.append(f)
    return out


def main():
    with open(SRC, encoding="utf-8") as fh:
        data = json.load(fh)
    feats = data["features"]

    transformer = Transformer.from_crs("EPSG:21096", "EPSG:4326", always_xy=True)

    def reproj(x, y):
        return transformer.transform(x, y)

    report_lines = []
    out_features = []
    unmatched = []

    def resolve(field, target_up, seed_lat, seed_lng, allow_hyphen=False):
        matches = find_matches(feats, field, target_up, allow_hyphen_split=allow_hyphen)
        survivors, rejected = [], []
        for m in matches:
            geom_wgs84 = shp_transform(reproj, shape(m["geometry"]))
            c = geom_wgs84.centroid
            dist_km = haversine_km(seed_lat, seed_lng, c.y, c.x)
            label = m["properties"].get(field)
            if dist_km <= MAX_DISTANCE_KM:
                survivors.append((m, geom_wgs84))
            else:
                rejected.append(f"{label} ({m['properties'].get('SUBCOUNTY')}, {dist_km:.1f}km away)")
        return survivors, rejected, bool(matches)

    for name, (seed_lat, seed_lng) in NAMES.items():
        target_up = name.upper()

        candidates, rejected, had_name_match = resolve("VILLAGE", target_up, seed_lat, seed_lng)
        source_field = "VILLAGE"

        if not candidates:
            p_candidates, p_rejected, p_had_name_match = resolve(
                "PARISH", target_up, seed_lat, seed_lng, allow_hyphen=True
            )
            candidates, rejected, had_name_match = p_candidates, rejected + p_rejected, had_name_match or p_had_name_match
            source_field = "PARISH"

        if not candidates:
            unmatched.append(name)
            reason = f"all candidates too far away (rejected: {rejected})" if had_name_match else "no name match at all"
            report_lines.append(f"{name}: NO MATCH — {reason} — kept generated approximate boundary")
            continue

        matched_labels = sorted(set(m["properties"].get(source_field) for m, _ in candidates))
        is_shared_parish = source_field == "PARISH" and any("-" in lbl for lbl in matched_labels)
        note_parts = []
        if is_shared_parish:
            note_parts.append("shared/combined parish — boundary covers a wider area than just this neighborhood")
        if rejected:
            note_parts.append(f"excluded same-named-elsewhere: {rejected}")
        note = f" [NOTE: {'; '.join(note_parts)}]" if note_parts else ""
        report_lines.append(
            f"{name}: matched via {source_field} -> {matched_labels} ({len(candidates)} feature(s)){note}"
        )

        dissolved = unary_union([g for _, g in candidates])

        out_features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "source_field": source_field,
                "source_values": matched_labels,
                "shared_parish": is_shared_parish,
            },
            "geometry": mapping(dissolved),
        })

    out_geojson = {"type": "FeatureCollection", "features": out_features}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out_geojson, fh)

    with open(OUT_REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(report_lines))
        if unmatched:
            fh.write(f"\n\nUnmatched ({len(unmatched)}): {unmatched}")

    print(f"Wrote {len(out_features)} boundaries to {OUT}")
    print(f"Unmatched: {unmatched}")
    print("\n".join(report_lines))


if __name__ == "__main__":
    main()
