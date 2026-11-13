"""Export the frozen 2026 segments from build.py as plain JSON (lat/lon) for the day-of app.

Run from this folder:  python3 export_app_data.py  ->  ../data/sff-2026.json
"""
import json, math

src = open("build.py").read().split("with PdfPages(")[0]
g = {"__name__": "export"}
exec(compile(src, "build.py", "exec"), g)
KX = g["KX"]

def ll(x, y):            # build coords (x already * KX) -> [lon, lat]
    return [round(x / KX / 1e5 - 90.4, 6), round(y / 1e5 + 38.49, 6)]

def checklist_lines(s):  # same text as the PDF dispatcher log
    L = g["seg_lines"](s)
    if len(L) == 1:
        dsp = s.get("disp", s["side"]).split(",")[0]; short = L[0][0].split()[0]
        if dsp.startswith(short + " "): dsp = dsp[len(short) + 1:]
        L = [(L[0][0] + ", " + dsp, L[0][1])]
    runs_ = g["street_runs"](s)
    if len(runs_) > 1:
        for wi, wt in sorted(g["warn_placement"](s, runs_), reverse=True): L.insert(wi + 1, (wt, ""))
    else:
        if s.get("main"): L.append(("⚠ MAIN ROAD" + (" – NO SIDEWALK" if s.get("nosidewalk") else ""), ""))
        if s.get("warn"): L.append((s["warn"], ""))
    return [{"text": t, "numbers": n, "warning": t.startswith("⚠")} for t, n in L]

out = {"event": "Scouting for Food 2026", "pack": "3721", "frozen": True,
       "coords": "[lon, lat] WGS84", "dens": [], "segments": [], "houses": [],
       "streets": [], "arterials": [], "zones": {}, "stops": [],
       "landmarks": [{"name": "Sappington Elementary", "lonlat": [-90.364914, 38.542702]}]}

for d in g["DENS"]:
    name = {"Arrow of Light": "AOL"}.get(d["name"], d["name"])
    colors = g["seg_colors"](d)
    out["dens"].append({"key": d["key"], "name": d["name"], "short": name, "color": d["color"],
                        "page": g["PAGE"][d["key"]], "scouts": d.get("scouts"), "area": d.get("zone"),
                        "houses": d["total"], "segments": [s["id"] for s in d["segs"]]})
    for i, s in enumerate(d["segs"]):
        parts = s.get("parts") or [dict(street=s["street"], houses=s["houses"])]
        route = [ll(*p) for p in g["street_route"](s)]
        extra = [[ll(*p) for p in g["street_route"](p_)] for p_ in parts[1:]] if s.get("parts") else []
        mx, my = g["mid_on"](g["street_route"](s))   # ID tag spot, same rule as draw_den_map
        if s.get("main"):
            odd = s["side"].startswith("odd"); mx += -22 if odd else 22; my += -40 if odd else 40
        if s.get("tag_at"): mx, my = s["tag_at"]
        out["segments"].append({"id": s["id"], "den": d["key"], "color": colors[i], "houses": s["n"],
                                "main_road": bool(s.get("main")), "lines": checklist_lines(s), "label": ll(mx, my),
                                "route": route, "route_parts": extra})
        for p in parts:
            for h in p["houses"]:
                b = g["_bld_for"](h[1], h[2])
                out["houses"].append({"seg": s["id"], "num": h[0], "street": g["HOUSE_ST"].get((h[0], round(h[1], 3), h[2]), p["street"]) if isinstance(g.get("HOUSE_ST"), dict) else p["street"],
                                      "lonlat": ll(h[1], h[2]),
                                      "outline": [ll(*q) for q in b["r"]], "outline_estimated": bool(b.get("synthetic"))})

for n, t, p in g["streets"]:
    if len(p) > 1: out["streets"].append({"name": n.title(), "type": t, "line": [ll(*q) for q in p]})
for n, pts in g["ARTERIALS"].items():
    out["arterials"].append({"name": n, "line": [ll(int(a) * KX, int(b)) for a, b in (q.split(",") for q in pts.split())]})
# faint grey buildings that aren't on any segment (background, as on the PDF)
# (only those within ~90 m of a house we walk, to keep the file small)
_hx = [h[1] for d in g["DENS"] for s in d["segs"] for p in (s.get("parts") or [s]) for h in p["houses"]]
_hy = [h[2] for d in g["DENS"] for s in d["segs"] for p in (s.get("parts") or [s]) for h in p["houses"]]
_x0, _x1, _y0, _y1 = min(_hx) - 80, max(_hx) + 80, min(_hy) - 80, max(_hy) + 80
out["buildings"] = [[[round(v, 5) for v in ll(*q)] for q in r] for r in g["_other_bld"]()
                    if any(_x0 < x < _x1 and _y0 < y < _y1 for x, y in r)]
for k, R in g["ZONES"].items(): out["zones"][k] = [ll(*q) for q in R]
for x, y, t in g["STOPS"]: out["stops"].append({"label": t, "lonlat": ll(x, y)})

json.dump(out, open("../data/sff-2026.json", "w"), separators=(",", ":"))
print(len(out["segments"]), "segments,", len(out["houses"]), "houses")
