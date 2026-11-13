# How the 2026 Scouting for Food maps were made

Notes on how the Pack 3721 SFF 2026 map packs were built, what data they use, and what was checked by hand. Use this to rebuild or adjust them next year.

## What was produced

The files are in Google Drive at Pack 721 › Scouting For Food › 2026:

- **SFF-2026-Pack3721-Maps.pdf**: the colour pack, 8 landscape letter pages
  1. Dispatcher overview: shaded den areas with page numbers, a den table, texting instructions, a "Your group" blank, and dispatcher Week 1 (bags) / Week 2 (pickup) name and phone blanks
  2. to 7. One page per den: Lions, Tigers, Wolves, Bears, Webelos, AOL. Each has a map of numbered segments and a checklist with Numbers, Street / side, Houses, Bags and Pickup columns.
  8. Dispatcher log on one page: Seg, Help, Done and the streets, with den bars down the side
- **SFF-2026-Pack3721-Maps-BW.pdf**: the same pages in black and white. Line patterns and greys stand in for colours.
- **SFF-2026-Pack3721-Maps-Booklet-Tabloid.pdf**: the colour pages laid out on 11×17 for a saddle-stitched booklet that opens top-bound, like a calendar. Print portrait, duplex flip on short edge, then put sheet 2 inside sheet 1 and fold. Page order: sheet 1 = 8 (upside down) / 1 and 2 / 7; sheet 2 = 6 / 3 and 4 / 5.

**Segments frozen for 2026.** The maps were printed in November 2026. From then on, segment IDs, boundaries and house numbers stay as printed. Any later Drive updates are cosmetic or informational only, so the printed copies and the Drive copies always match.

## Data sources

- **Official pack boundaries**: AREA-C and AREA-F polygons from the pack's Google My Map. Only addresses inside these polygons are included.
- **House addresses**: St. Louis County GIS *Address_Points* (ArcGIS FeatureServer). Current addresses only, with no apartment units.
- **Street lines**: St. Louis County GIS *County_Streets* centerlines.
- **Den sizes**: the pack roster CSV, counting active scouts only. Lions 5, Tigers 10, Wolves 14, Bears 9, Webelos 8, AOL 6 (52 total). The roster has no den type for Den 5, so it was assumed to be AOL.
- **Satellite / street-level checks**: Esri World Imagery, plus Apple Maps and Look Around screenshots supplied by Jay.
- OpenStreetMap was tried first but had almost no house numbers for this area. It was used only to check sidewalk and stop-sign tags.

## How dens were balanced

- **Age multipliers:** Lions and Tigers ×1, Wolves ×1.25, Bears ×1.5, Webelos ×1.75, AOL ×2.
- **Load = houses ÷ (scouts × multiplier).** The goal was even loads across dens. Final loads are about 13.6 (Lions) to 17.1.
- **Lions and Tigers swapped zones.** Zone F has more houses than zone C, and putting the F dens there made them overloaded. In the final layout Lions take the small south-west pocket of zone C, and Tigers take the north corner of zone F.
- **Den areas never cross a main road.** Every street belongs to exactly one den, and no overflow areas are assigned in advance. Groups that finish early text the dispatcher for more segments.
- **Final totals: 1,183 houses.** Lions 68, Tigers 171, Wolves 299, Bears 214, Webelos 226, AOL 205.

## How segments were built

- **Base rule:** one side of one street per segment, walked in house-number order. Long sides are cut into chunks of about 13 houses, and courts and short streets are walked as a single loop covering both sides.
- **Grouping:** segments next to each other are then joined, up to about 22 houses, as long as the next one starts within about 100 m. Groups never cross Baptist Church Rd.
- **Hand-tuned areas:** many spots were reworked by hand from aerial photos. These include the Fawnhaven / Fawnway / Fawndale inner and outer loops, Edgemoor / Kingsmere / Havelock, the Three Court south courts, Pickwick with Galena and Palmyra, Webelos side streets walked as both-sides segments, and Roscommon split at Kilrush.
- **Segment IDs** are the den letter plus a number, in walking order and grouped by street: L, T, W, B, WE (Webelos), A.
- **Main-road segments** carry a ⚠ and are named MW1–2, MB1–2, MWE1–2 and MA.
- **Houses are drawn as their real building shapes** (Microsoft Global ML Building Footprints, February 2026 release, matched to each address point by location; FEMA outlines were tried first but had a stray outline across Wilderness Battle Dr and missing houses there; 9 houses with no usable outline get a standard house-sized box), filled with a pale tint of the segment colour. Other dens' houses are solid light grey, and other buildings, like garages and neighbours, are a paler grey. This was added after printing (12 Nov), so it's in the Drive copies only. The segments didn't change.
- **Map lines follow the street,** offset to the side the houses are on, so they don't cut through yards. The arrow marks where a segment starts. The house numbers at each end show where one segment stops and the next begins.

## Things checked by hand

- **Coverage audit:** an independent review found 1,195 county addresses inside the boundaries, and the maps had 1,192. It added 9924 Musick, which the county files as "Musick Rd", and fixed a hand-drawn street connector on Three Court that doesn't exist.
- **Empty lots removed (11),** confirmed on satellite: 10021 Mayo; 9700 and 9801 Vicksburg Siege; 9804 Richmond Cavalry; 9864 Chattanooga Campaign; 9726 and 9727 Wilderness Battle; 10957 Teakwood Ct; 10078 Arbor Park; 10125 Florinda; 11060 Fawnhaven.
- **Edge cases:**
  - 10699 Tesson Ferry was added as Webelos stop MWE2 ⚠.
  - 10729 Mallory sits just outside the boundary. It's left out because it belongs with the 107xx subdivision to the east.
  - Five other points just outside the boundary turned out to be woods or businesses.
- **Sidewalks:**
  - Baptist Church Rd has a sidewalk on the east side only. West-side segments are marked "NO SIDEWALK".
  - Musick Ave has a sidewalk on the pack's (east) side from Larkspur to Sonata, including over the creek bridge, but none from Sonata to Kamping. 10304 Musick is flagged.
- **Crossing:** the Kingsmere all-way stop is the marked place to cross Baptist Church Rd. There is also a stop at Ridge Forest Dr, which is outside the area.
- **Musick corner lots** are folded into their side street's segment. The exceptions are the private lane at 9940/9946/9950 (MA) and the Musick Manor Ln / shared driveway / 10104 stretch (MWE1).
- **Sappington Elementary** (11011 Gravois Rd) is marked on the overview. Its position came from GreatSchools coordinates and was not checked on satellite.

## How it was built (technical)

- Python with matplotlib draws the maps and checklists. pypdf lays out the booklet and compresses it.
- The build script (`build.py`), address data (`addr.txt`) and street data (`streets.txt`) were in the Claude session workspace and are not in Drive. Ask Claude to recreate them, or save copies, if you want to rebuild next year.
- Deploying uploads new copies to the Drive folder and moves the old ones to the trash. The Drive connector can't replace a file in place, so file links change with each deploy. Share the folder rather than individual files.

## Extra data checked after printing (for 2027)

These were looked at in November 2026, after the segments were frozen. Nothing on the 2026 maps changed. A two-page preview map, *SFF-Data-Preview-2027.pdf*, shows all of these layers over both zones.

- **Public sidewalks:** MSD Sidewalks layer, last edited 2023. It is hosted in the county's ArcGIS account, `services2.arcgis.com/w657bnjzrjguNyOy/.../Sidewalks/FeatureServer/0`, and PUBSIDEWALK is the street sidewalk.
  - Only 204 of 1,183 houses have a public sidewalk on their side of the street. Another 9 have one across the street only, and 970 have none.
  - The sidewalks are in pockets: Fawnhaven north, Kingsmere / Havelock / Edgemoor, Patrina / Abdell / Alpena / Littie, Larkspur / Copperfield, Grant Forest, plus parts of Baptist Church, Musick and Roscommon.
  - It agrees with the hand checks. Baptist Church has a sidewalk on the east side only, and Musick has none from Sonata to Kamping (10248, 10304, 10318).
  - **Use it for information only, and don't draw it on the maps.** Jay compared it with satellite photos and found sidewalks that the layer doesn't show. A line on the layer means there is a sidewalk, but no line does not mean there's no sidewalk. Confirm "no sidewalk" warnings on aerial photos or street-level views.
- **Front walks:** MSD PRIVSIDEWALK lines. About half the houses (595) have a mapped front walk. On 7 corner lots it leads to a different street than the one the house is filed under. That suggests the door faces the side street:
  - 11145 Valdamere → Wisteria
  - 10210 Abdell → Patrina
  - 10126 Baptist Church → Mugan
  - 10135 Baptist Church → Littie
  - 10120 Florinda → Lavinia
  - 10500 Sonata → Florinda
  - 10318 Musick → Kamping

  Treat these as hints and confirm them on aerial photos.
- **Building outlines:** Microsoft's free Global ML Building Footprints (Feb 2026 release, `minedbuildings.z5.web.core.windows.net`, quadkey 023111311) are the most current and match the satellite at Wilderness Battle; they have no addresses. FEMA *USA Structures* (Esri Living Atlas, `services2.arcgis.com/FiaPA4ga0iQKduv3/.../USA_Structures_View/FeatureServer/0`). Each outline carries an address, and the imagery dates from 2012 to 2024.
  - 1,156 of our houses matched a building by address. The rest matched by location.
  - All 11 empty lots we removed have no building, which confirms the satellite checks.
  - Inside the boundaries, only 7 buildings have no house on our maps. Most are sheds or the backs of lots outside the boundary. One unaddressed 5,167 sq ft building off Arbor Park Ln is worth a quick look.
  - Many houses also have a small second outline labelled "single family" at the same address. These are detached garages, so don't count outlines as houses.
- **Elevation:** MSD 2-ft contours from 2018 (`Contours_2ft` in the county account). The area runs from about 458 to 656 ft.
  - The steepest walking is in the Tigers' Civil War streets. Wilderness Battle Cir north and Richmond Cavalry have short pitches of around 20%, and T3 / T5 climb about 50 ft.
  - Long Wolves streets (Fawnhaven, Patrina, Littie) climb 55–75 ft, but gradually.
  - These figures are estimates from the contours at each house front.
- **Driveways:** no public driveway or paved-area layer was found. Building outlines plus front walks cover most of what driveways would have told us.
- **How the data was reached:** the cloud workspace can't reach arcgis.com, so the layers were queried in the built-in browser on Jay's Mac and copied across.

## Lessons for next year

- Start from county address points, not OpenStreetMap.
- Balance by den size and age before drawing segments.
- Simple segment rules (one side per street) plus hand fixes from aerial photos worked better than automatic block splitting or one continuous "snake" route.
- Get sidewalk and stop-sign information from street-level photos early, because it changes routing on main roads.
- Have den leaders review their own page against the ground before printing.
