# Pack 3721 Scouting for Food (SFF)

These are the tools for Cub Scout Pack 3721's Scouting for Food walk in south St. Louis County, MO (around Baptist Church Rd and Musick Rd).

Start with `PLAN.md`. The current job is the **day-of tracker**: a phone web page with the den map, a GPS dot, and tap-to-text the dispatcher.

## Layout

- `PLAN.md`: the plan for the day-of tracker, including requirements, milestones and open questions.
- `data/sff-2026.json`: the frozen 2026 segments, houses, outlines and streets as lat/lon. This is the app's only data source.
- `app/`: the day-of tracker, a static page (`index.html`, `app.js`, `app.css`) that draws the map as SVG. `dispatcher.html` makes the dispatcher's QR code. `vendor/` holds third-party code served from this site; `vendor/README.md` lists where each file came from and its integrity hash. `app/sff-2026.json` is a symlink to the data file. Test it with `python3 -m http.server -d app`.
- `.github/workflows/`: `pages.yml` deploys `app/` to GitHub Pages, and `zizmor.yml` audits the workflows. Pin actions to commit SHAs, and run `zizmor .` before pushing workflow changes.
- `planner/`: the Python scripts that made the printed 2026 map pack (matplotlib and pypdf).
  - `build.py` builds the 8-page colour PDF. Run it as `python3 build.py`, or `BW=1 python3 build.py` for black and white.
  - `booklet.py` builds the 11×17 saddle-stitch booklet from the colour PDF.
  - `export_app_data.py` regenerates `data/sff-2026.json`.
  - `addr.txt` and `streets.txt` hold the county address points and street lines, in local units: x = (lon + 90.4) × 1e5, y = (lat − 38.49) × 1e5.
  - `layers/ms.txt` holds Microsoft building outlines for the area, in the same units, with each row as `height|x,y x,y …`.
- `docs/how-the-maps-were-made.md`: data sources, how the dens were balanced and the segments built, the hand checks, and lessons for next year.

## Rules

- **The 2026 segments are frozen** because the maps are printed. Don't change segment IDs, membership or house numbers. Cosmetic changes to the PDFs are fine.
- **No phone numbers, email addresses or scout or family names in the repo.** The dispatcher's number reaches the app only through the QR link fragment (`#tel=…`). Use 555-01xx numbers in tests.
- **No third-party scripts, fonts, analytics or online QR APIs** in the app. The page has to stay self-contained so the `#` fragment can't leak.
- **Treat the MSD sidewalk data as information only.** It's missing sidewalks that are visible on satellite, so a missing line doesn't mean "no sidewalk". Don't draw it on maps, and **don't commit MSD sidewalk or contour data**: its terms don't allow sharing.
- **Licences:** code is PolyForm Noncommercial 1.0.0 (`LICENSE`), writing is CC BY-NC 4.0, and map data keeps its sources' terms. `NOTICE.md` lists them. Credit new data sources there, and don't use Scouting America logos or emblems.
- **Text wording** matches page 1 of the paper pack, with the week in front: "Wk1: Wolf A – W7 done", "Wk1: Wolf A available", "Wk1: Wolf A – send bags to W8, …".

## Useful facts

- **2026 dates:** Week 1 (bags) is Saturday Nov 14, 2026. Week 2 (pickup) is Saturday Nov 21, 2026. The app picks the week from the date.
- **The pack is "721" in everyday use.** 3721 is the technical unit number, which keeps it apart from the troop. Use 721 in anything people read, such as the app name "SFF 721 Map". Use 3721 where the official unit is meant.
- The dens are Lions (L), Tigers (T), Wolves (W), Bears (B), Webelos (WB, with segment IDs starting WE) and AOL (A). There are 79 segments and 1,183 houses.
- Main-road segments are marked ⚠: MW1–2, MB1–2, MWE1–2 and MA. The place to cross Baptist Church Rd is the all-way stop at Kingsmere.
- The printed PDFs and the dispatcher Google Sheet are in the pack's Google Drive. They aren't in this repo.
