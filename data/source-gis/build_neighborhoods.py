"""
Builds the app's full neighborhood search database from the GKMA village/
parish GIS dataset — replacing the old hand-picked list of 16 with
comprehensive coverage of every named village (and parish, where a village
doesn't cover it) in the dataset.

Two output files:
  neighborhoods.json              - lightweight {id, name, sub, lat, lng}
                                     list for instant client-side search
  neighborhood-boundaries.geojson - the actual polygons, simplified to keep
                                     the file a reasonable size over mobile
                                     data, fetched once and matched to
                                     neighborhoods.json by id

Grouping rules:
  - Villages are grouped by (base name, subcounty) — base name strips a
    trailing sub-area suffix like "A"/"B"/"I"/"II" so e.g. "MUYENGA A" and
    "MUYENGA B" become one "Muyenga" entry. Grouping includes subcounty so
    same-named villages in different subcounties (a real, fairly common
    thing in this data — see the Ntinda/Bukasa collisions found earlier)
    stay separate, distinguishable by their "sub" label in search results.
  - Every parish that has no village of a matching (or base-matching) name
    also becomes its own searchable entry, dissolved across all of that
    parish's sub-areas (e.g. "KOLOLO I".."IV"). This is the same
    village-first-then-parish rule used for the original 16, now applied
    across the whole dataset.
  - Geometries are simplified (Shapely, ~5m tolerance) to keep the total
    boundary payload reasonably small for mobile connections.

Coverage note: this dataset only covers Kampala and Wakiso districts.
Mukono and Mpigi are NOT in this file — neighborhoods there fall back to
live OpenStreetMap lookup or the generated-approximate outline in the app,
until/unless equivalent GIS data for those two districts is supplied.
"""
import json
import os
import re
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform as shp_transform

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(SCRIPT_DIR, "GKMA_Boundary.geojson")
OUT_INDEX = os.path.join(SCRIPT_DIR, "..", "neighborhoods.json")
OUT_BOUNDARIES = os.path.join(SCRIPT_DIR, "..", "neighborhood-boundaries.geojson")
OUT_REPORT = os.path.join(SCRIPT_DIR, "boundary-build-report.txt")

SIMPLIFY_TOLERANCE_DEG = 0.00006  # ~6-7m at this latitude — trims vertices, keeps shape

SUFFIX_RE = re.compile(r"\s+(A|B|C|D|E|I|II|III|IV|V)$")


def base_name(n):
    return SUFFIX_RE.sub("", n).strip()


def title_case(n):
    # Keep short connector words lowercase for readability, capitalize the rest
    small = {"and", "the", "of", "a"}
    words = n.strip().split()
    out = []
    for i, w in enumerate(words):
        wl = w.lower()
        out.append(wl if (wl in small and i != 0) else wl.capitalize())
    return " ".join(out)


def main():
    with open(SRC, encoding="utf-8") as fh:
        data = json.load(fh)
    feats = data["features"]

    transformer = Transformer.from_crs("EPSG:21096", "EPSG:4326", always_xy=True)

    def reproj(x, y):
        return transformer.transform(x, y)

    report = []

    # --- Group villages by (base name, subcounty) ---
    village_groups = {}
    for f in feats:
        v = (f["properties"].get("VILLAGE") or "").strip().upper()
        sc = (f["properties"].get("SUBCOUNTY") or "").strip().upper()
        if not v:
            continue
        key = (base_name(v), sc)
        village_groups.setdefault(key, []).append(f)

    village_base_names = set(k[0] for k in village_groups.keys())  # kept for reporting only

    # --- Group parish-only areas (no matching village of the SAME name in
    # the SAME subcounty). This must be subcounty-scoped, not just name-based
    # — a global name check would (and initially did) wrongly treat an
    # unrelated same-named village in a totally different subcounty as
    # "already covering" a parish, silently dropping the real neighborhood.
    # Concretely: the real Ntinda (Nakawa, Kampala) only exists in this
    # dataset as a PARISH, not a village — but a same-named, unrelated
    # village called "Ntinda" also exists 20km away in Busukuma, Wakiso.
    # A global check would let that unrelated village "cover" the name and
    # skip generating the real Ntinda entry entirely. Scoping to
    # (base_name, subcounty) fixes this. ---
    parish_groups = {}
    for f in feats:
        p = (f["properties"].get("PARISH") or "").strip().upper()
        sc = (f["properties"].get("SUBCOUNTY") or "").strip().upper()
        if not p:
            continue
        p_base = base_name(p)
        key = (p_base, sc)
        if key in village_groups or (p, sc) in village_groups:
            continue  # a village of this name in THIS subcounty already covers it
        parish_groups.setdefault(key, []).append(f)

    index_entries = []
    boundary_features = []
    next_id = 1

    def process_group(name_base, subcounty, group_feats, source_field):
        nonlocal next_id
        geoms = []
        for f in group_feats:
            g = shp_transform(reproj, shape(f["geometry"]))
            geoms.append(g)
        dissolved = unary_union(geoms)
        dissolved = dissolved.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
        c = dissolved.centroid

        district = group_feats[0]["properties"].get("DISTRICT", "")
        parish = group_feats[0]["properties"].get("PARISH", "")
        entry_id = f"gkma_{next_id}"
        next_id += 1

        display_name = title_case(name_base)
        sub_label = f"{title_case(subcounty)} · {title_case(district)}" if subcounty else title_case(district)

        index_entries.append({
            "id": entry_id,
            "name": display_name,
            "sub": sub_label,
            "lat": round(c.y, 6),
            "lng": round(c.x, 6),
        })
        boundary_features.append({
            "type": "Feature",
            "properties": {"id": entry_id, "name": display_name, "source_field": source_field},
            "geometry": mapping(dissolved),
        })

    for (base, subcounty), group_feats in sorted(village_groups.items()):
        process_group(base, subcounty, group_feats, "VILLAGE")

    for (base, subcounty), group_feats in sorted(parish_groups.items()):
        process_group(base, subcounty, group_feats, "PARISH")

    report.append(f"Village-based entries: {len(village_groups)}")
    report.append(f"Parish-only entries: {len(parish_groups)}")
    report.append(f"Total neighborhoods: {len(index_entries)}")

    os.makedirs(os.path.dirname(OUT_INDEX), exist_ok=True)
    with open(OUT_INDEX, "w", encoding="utf-8") as fh:
        json.dump(index_entries, fh)
    with open(OUT_BOUNDARIES, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": boundary_features}, fh)
    with open(OUT_REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(report))

    print("\n".join(report))
    print(f"Wrote {OUT_INDEX}")
    print(f"Wrote {OUT_BOUNDARIES}")


if __name__ == "__main__":
    main()
