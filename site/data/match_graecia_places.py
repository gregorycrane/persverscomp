"""
Matches region polygons (from any Kiepert-derived layer -- Graecia,
Persia/Macedon, Egypt, etc.) against real ToposText place records
(ZPLACES.ZDISPLAYNAME) to find each region's real place_id -- proposed
for review, never auto-accepted silently.

Different source layers use different property names for the region's
own name (Graecia: "Name_CityState"; Persia/Egypt: plain "Name") --
pass --name-field= to match whichever one applies.

ZDISPLAYNAME values look like:
    "Boiotia region (Boeotia) 1673 Viotia - \u0392\u03bf\u03b9\u03c9\u03c4\u03af\u03b1"
(ancient name, an English gloss in parens, a modern-place code, the
modern name, and a Greek transliteration all mashed into one string) --
so a plain exact-string match against "Boeotia" won't hit it. Matching
strategy, in priority order:
  1. Case-insensitive SUBSTRING match: does the region name appear
     anywhere in ZDISPLAYNAME? (catches the "(Boeotia)" bracketed gloss
     directly -- this is the high-confidence path)
  2. Fuzzy match (difflib) against the whole ZDISPLAYNAME as a fallback,
     surfaced as low-confidence, for a human to actually look at rather
     than trust automatically.

Workflow, per source layer, deliberately not a single auto-pipeline:
    python3 match_graecia_places.py match <db> <geojson> [--name-field=Name] [out.csv]
        -> writes a review CSV. Open it, fill in / correct the
           chosen_place_id column for each row (blank = skip that
           region entirely -- it won't appear on the map).
    python3 match_graecia_places.py build <geojson> <reviewed.csv> [--name-field=Name] [out.geojson]
        -> joins your reviewed choices back to the polygon geometry and
           writes a place_polygons.geojson for that one layer.

Once you've built one place_polygons.geojson per source layer, combine
them into the single file map.html actually reads:
    python3 match_graecia_places.py merge place_polygons.geojson \\
        graecia_polygons.geojson persia_polygons.geojson egypt_polygons.geojson
"""

import csv
import difflib
import json
import sqlite3
import sys


def load_places(db_path):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT ZPLACEID, ZDISPLAYNAME, ZFEATURETYPE FROM ZPLACES "
        "WHERE ZDISPLAYNAME IS NOT NULL"
    ).fetchall()
    conn.close()
    return rows  # list of (place_id, display_name, feature_type)


def find_candidates(name, places, max_fuzzy=3):
    name_lower = name.lower().strip()
    substring_hits = [
        (pid, disp, ftype) for pid, disp, ftype in places
        if name_lower in disp.lower()
    ]
    if substring_hits:
        return "substring", substring_hits

    scored = sorted(
        places,
        key=lambda row: difflib.SequenceMatcher(None, name_lower, row[1].lower()).ratio(),
        reverse=True,
    )[:max_fuzzy]
    return "fuzzy", scored


def cmd_match(db_path, geojson_path, name_field, out_csv="match_review.csv"):
    places = load_places(db_path)
    print(f"Loaded {len(places)} places from {db_path}")

    geojson = json.load(open(geojson_path, encoding="utf-8"))
    feats = geojson["features"]

    rows_out = []
    n_substring, n_fuzzy_only, n_none = 0, 0, 0

    for f in feats:
        p = f["properties"]
        name = p.get(name_field) or ""
        objectid = p["OBJECTID"]
        match_type, candidates = find_candidates(name, places)

        if match_type == "substring":
            n_substring += 1
        elif candidates:
            n_fuzzy_only += 1
        else:
            n_none += 1

        if not candidates:
            rows_out.append({
                "objectid": objectid, "name_citystate": name,
                "match_type": "none", "candidate_place_id": "",
                "candidate_display_name": "", "candidate_feature_type": "",
                "chosen_place_id": "",
            })
            continue

        # One row per candidate, grouped by objectid, so a human can see
        # every option (especially for fuzzy matches) rather than have
        # the script silently pick the top-ranked one.
        for pid, disp, ftype in candidates:
            rows_out.append({
                "objectid": objectid, "name_citystate": name,
                "match_type": match_type, "candidate_place_id": pid,
                "candidate_display_name": disp, "candidate_feature_type": ftype,
                "chosen_place_id": pid if match_type == "substring" and len(candidates) == 1 else "",
            })

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "objectid", "name_citystate", "match_type", "candidate_place_id",
            "candidate_display_name", "candidate_feature_type", "chosen_place_id",
        ])
        w.writeheader()
        w.writerows(rows_out)

    print(f"\n{len(feats)} regions processed:")
    print(f"  {n_substring} had an unambiguous substring match "
          f"(chosen_place_id pre-filled where there was exactly one candidate)")
    print(f"  {n_fuzzy_only} had only fuzzy candidates -- needs a human look")
    print(f"  {n_none} had NO candidates at all -- may not exist in ZPLACES under any name")
    print(f"\nWrote {out_csv}")
    print("Next: open it, review every row (especially fuzzy/multi-candidate "
          "ones), fill in chosen_place_id for each region you want on the "
          "map (leave blank to skip), then run the 'build' command.")


def cmd_build(geojson_path, reviewed_csv, name_field, out_geojson="place_polygons.geojson"):
    geojson = json.load(open(geojson_path, encoding="utf-8"))
    feats_by_objectid = {f["properties"]["OBJECTID"]: f for f in geojson["features"]}

    chosen = {}  # objectid -> place_id
    with open(reviewed_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = (row.get("chosen_place_id") or "").strip()
            if pid:
                chosen[int(row["objectid"])] = pid

    out_features = []
    skipped = []
    for objectid, place_id in chosen.items():
        feat = feats_by_objectid.get(objectid)
        if not feat:
            continue
        out_features.append({
            "type": "Feature",
            "properties": {
                "place_id": place_id,
                "name": feat["properties"].get(name_field),
            },
            "geometry": feat["geometry"],
        })

    for f in geojson["features"]:
        if f["properties"]["OBJECTID"] not in chosen:
            skipped.append(f["properties"].get(name_field))

    out = {"type": "FeatureCollection", "features": out_features}
    json.dump(out, open(out_geojson, "w", encoding="utf-8"), ensure_ascii=False)

    print(f"Wrote {len(out_features)} matched regions to {out_geojson}")
    if skipped:
        print(f"Skipped (no chosen_place_id): {skipped}")


def cmd_merge(out_geojson, input_geojsons):
    """Combines multiple already-built place_polygons.geojson files (e.g.
    one per source layer -- Graecia, Persia, Egypt) into a single file,
    de-duplicating by place_id if the same region somehow got matched
    from two different source layers (keeps the first one seen, prints
    a warning so it's not silently arbitrary).
    """
    seen = {}
    for path in input_geojsons:
        data = json.load(open(path, encoding="utf-8"))
        for feat in data["features"]:
            pid = feat["properties"]["place_id"]
            if pid in seen:
                print(f"! duplicate place_id {pid} in {path} "
                      f"(already had it from {seen[pid][1]}) -- keeping the first one")
                continue
            seen[pid] = (feat, path)

    out = {"type": "FeatureCollection", "features": [f for f, _ in seen.values()]}
    json.dump(out, open(out_geojson, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"Merged {len(input_geojsons)} files -> {len(out['features'])} "
          f"total unique regions -> {out_geojson}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "match":
        # python3 match_graecia_places.py match <db> <geojson> [--name-field=Name] [out.csv]
        args = [a for a in sys.argv[2:] if not a.startswith("--")]
        name_field = "Name_CityState"
        for a in sys.argv[2:]:
            if a.startswith("--name-field="):
                name_field = a.split("=", 1)[1]
        db_path, geojson_path = args[0], args[1]
        out_csv = args[2] if len(args) > 2 else "match_review.csv"
        print(f"Using name field: {name_field!r}")
        cmd_match(db_path, geojson_path, name_field, out_csv)
    elif cmd == "build":
        # python3 match_graecia_places.py build <geojson> <reviewed.csv> [--name-field=Name] [out.geojson]
        args = [a for a in sys.argv[2:] if not a.startswith("--")]
        name_field = "Name_CityState"
        for a in sys.argv[2:]:
            if a.startswith("--name-field="):
                name_field = a.split("=", 1)[1]
        geojson_path, reviewed_csv = args[0], args[1]
        out_geojson = args[2] if len(args) > 2 else "place_polygons.geojson"
        cmd_build(geojson_path, reviewed_csv, name_field, out_geojson)
    elif cmd == "merge":
        # python3 match_graecia_places.py merge <out.geojson> <in1.geojson> <in2.geojson> ...
        out_geojson = sys.argv[2]
        inputs = sys.argv[3:]
        cmd_merge(out_geojson, inputs)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
