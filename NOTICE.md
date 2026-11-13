# Licences and credits

Copyright 2026 Jay Tuley and contributors.

## What's covered by what

| What | Licence |
|---|---|
| **Code**: `app/` (except `app/vendor/`), `planner/*.py`, `tools/`, `.github/` | [PolyForm Noncommercial 1.0.0](LICENSE) |
| **Writing**: `README.md`, `PLAN.md`, `CLAUDE.md`, `docs/` | [CC BY-NC 4.0](LICENSES/CC-BY-NC-4.0.txt) |
| **QR code library**: `app/vendor/qrcode-generator-2.0.4.js` | MIT, © 2009 Kazuhiko Arase (notice in the file; see [`app/vendor/README.md`](app/vendor/README.md)) |
| **Map data**: `data/sff-2026.json`, `planner/addr.txt`, `planner/streets.txt`, `planner/layers/ms.txt` | The terms of each source, below. Our own additions (segments, routes, colours, checklist lines) are under CC BY-NC 4.0. |

PolyForm Noncommercial lets anyone use, change and share the code for any noncommercial purpose. Charities, schools and government bodies may use it whatever the purpose, which covers other packs, councils and chartered organizations. It doesn't allow selling it or building a paid product on it.

## Map data sources

### St. Louis County GIS Service Center

House addresses (*Address Points*) and street lines (*County_Streets*), from the county's public ArcGIS layers. Credit: **St. Louis County GIS Service Center.** The county's terms for these layers are a disclaimer:

> St. Louis County makes no warranty for fitness of use for a particular purpose express or implied, with respect to this map product. Every reasonable effort has been made to assure the accuracy of the maps and data provided; nevertheless, some information may not be accurate. Any user of this map product accepts its faults and assumes all responsibility for the use thereof, and further agrees to hold St. Louis County Government harmless from and against any damage, loss or liability arising from any use of the map product. Do not make business decisions based on this data before validating your decision with the appropriate agency.

Contact details for data requests are on the layers' item pages in the county's ArcGIS account.

### Microsoft Global ML Building Footprints

House and building outlines (February 2026 release), licensed by Microsoft under the [Community Data License Agreement – Permissive 2.0](LICENSES/CDLA-Permissive-2.0.txt). Source: <https://github.com/microsoft/GlobalMLBuildingFootprints>. The licence grants no rights to Microsoft's names or trademarks.

### Not included

The planner also looked at MSD (Metropolitan St. Louis Sewer District) sidewalk and contour layers. Their terms don't allow sharing without consent, so none of that data is in this repo. Only notes made from looking at it are.

## Trademarks

Scouting America, Cub Scouts, Scouting for Food, and the den and rank names (Lion, Tiger, Wolf, Bear, Webelos, Arrow of Light) are names and marks of Scouting America. This is a volunteer project by Cub Scout Pack 721 (unit 3721). It isn't affiliated with, sponsored by or endorsed by Scouting America, and it doesn't use Scouting America's logos or emblems.

## No warranty

The map, the data and the app are provided as is, with no warranty. Check what matters on the ground: addresses, crossings and sidewalks.
