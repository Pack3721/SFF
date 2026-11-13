# Plan: SFF day-of tracker (phone map)

A phone web page that shows a den's walking map for Scouting for Food, with a "you are here" GPS dot. It also has buttons that open a pre-written text to the dispatcher.

Families can use the paper map pack or this page. Both use the same segment IDs, colours, house numbers and text messages, so the dispatcher can't tell them apart.

Status: planning. Nothing is built yet.

## Goals

1. **Same map as the paper pack.** The page is drawn from our own data (`data/sff-2026.json`), not from Google or OpenStreetMap tiles. It shows the same streets, house shapes, coloured segment lines, segment IDs and end house numbers as the printed den pages.
2. **GPS dot.** It uses the phone's location so a walker can see where they are on their segment. The location stays on the phone and is never sent anywhere.
3. **Tap to text the dispatcher.** Each button opens the phone's own Messages app with the text already written, and the parent presses Send. The page never sends anything itself.
4. **No hard-coded phone number.** The dispatcher's number arrives in the QR code link, after the `#` (see "Dispatcher number" below).
5. **Paper or phone.** Families keep a choice, and nothing on the page needs a login.

## Not in version 1

- Accounts, logins, a database or a server.
- Live status back to the dispatcher (the dispatcher still gets texts and fills in the Google Sheet "SFF 2026 Pack 3721 Dispatcher Log").
- Editing segments. The 2026 segments are **frozen**: the maps are printed.
- Showing other people's locations.

## How people use it

1. **The dispatcher, the morning of each week,** opens the QR page, types their mobile number and picks Week 1 (bags) or Week 2 (pickup). The page prints one sheet with a QR code per den (Lions, Tigers, Wolves, Bears, Webelos, AOL), or one code for the whole pack.
2. **A parent** scans their den's code. The map opens zoomed to that den. The first time, it asks for the group letter (for "Wolf A"), the same as the "Your group" blank on page 1 of the paper pack.
3. **On the walk,** the parent taps a segment to see its checklist lines (numbers, street and side, ⚠ warnings) and taps a button to text the dispatcher.

## Text messages

These match the wording printed on page 1 of the map pack:

| Button | Message |
|---|---|
| Done | `Wolf A – W7 done` |
| Available for more | `Wolf A available` |
| Need bags (Week 1 only) | `Wolf A – W8 need bags` |
| Need help | `Wolf A – W8 need help` |

Add the week if the dispatcher would find it useful, for example `Wk1`. That's an open question.

`sms:` links work differently on each phone. iOS uses `sms:+1NUMBER&body=…`, and Android uses `sms:+1NUMBER?body=…`. Test both. `sms:+1NUMBER?&body=…` is known to work on both, but check it. Encode the body with `encodeURIComponent`.

## Dispatcher number

- **QR link format:** `https://<host>/#tel=3145550123&wk=1&den=W`. The `#` part (the fragment) is never sent to the web server, so it isn't in server logs and isn't in the Referer header.
- **When the page opens:** it reads the fragment, checks the number (10 digits, US), saves `tel`, `wk` and the group to `localStorage`, then clears the fragment with `history.replaceState`. That way the number doesn't travel if someone copies or screen-shares the link.
- **Opened with no number:** it asks the user to type one, or to scan the dispatcher's QR code. It never guesses.
- **A new QR code** overwrites the saved number and week, which covers a different dispatcher in Week 2.
- **Never commit a phone number** to this repo, in code, data or tests. Use `555-0100`-style test numbers.
- **No third-party scripts, fonts or analytics,** because they could read `location.hash`. Everything is inline in the page or served from the same host.

## Map rendering

- Read `data/sff-2026.json` (see the schema below). It's about 360 KB, so it can be inlined into the page or fetched once and cached.
- Draw with SVG or canvas in [lon, lat] projected to local metres. An equirectangular projection at latitude 38.53 is fine at this scale: x = lon × cos(38.53°).
- Layers, from bottom to top:
  1. zone outlines (dashed)
  2. streets (light grey, with names)
  3. arterials (Baptist Church Rd, Musick Rd, Lindbergh: wider and tan)
  4. other dens' houses (light grey)
  5. this den's houses (a pale tint of the segment colour)
  6. segment routes (the segment colour, dashed for ⚠ main-road segments)
  7. a start arrow on each route
  8. house numbers at both ends
  9. segment ID labels
  10. stop signs
  11. the GPS dot with an accuracy circle
- Pinch to zoom and pan. Add a "centre on me" button and a "whole den" button.
- Make it readable in sunlight: high contrast and big tap targets.
- Optional: rotate the map to the phone's heading. Leave it off by default.

## Offline

Once loaded, the page should keep working without a signal: map drawing, GPS and `sms:` links all work offline. The simplest way is a single HTML file with the data inlined and a small service worker or `Cache-Control`. Check how each host handles caching before choosing.

## Pages

1. **Map page** (`index.html`): den picker if there's no `den` in the link, the map, the segment sheet with checklist lines and text buttons, a settings sheet (group letter, dispatcher number, week), and a GPS permission prompt.
2. **QR page** (`dispatcher.html`, not linked from the map page): enter number and week, then print the QR codes. Generate them locally with an inlined QR library. **Don't use an online QR API**, because the number would be sent to it.

## Hosting

Any static host with https, which GPS requires. Some options:
- GitHub Pages from this repo. Settings → Pages → `main` / `/app`. This is the simplest.
- A Claude artifact shared by link.

The page must work from a plain static host, with no build server needed. A small build step (for example, inlining the data) is fine if its output is committed.

## Data file: `data/sff-2026.json`

Generated by `planner/export_app_data.py` from `planner/build.py`. Don't hand-edit it; rerun the export instead.

```
{
  "event", "pack", "frozen": true, "coords": "[lon, lat] WGS84",
  "dens":     [{key, name, short, color, page, scouts, area, houses, segments:[ids]}],
  "segments": [{id, den, color, houses, main_road,
                lines:[{text, numbers, warning}],   // same text as the paper checklist and log
                route:[[lon,lat]...], route_parts:[[[lon,lat]...]...]}],
  "houses":   [{seg, num, street, lonlat, outline:[[lon,lat]...], outline_estimated}],
  "streets":  [{name, type, line}], "arterials": [{name, line}],
  "zones":    {C:[...], F:[...]}, "stops": [{label, lonlat}], "landmarks": [{name, lonlat}]
}
```

There are 79 segments and 1,183 houses. Den keys are L, T, W, B, WB (Webelos, whose segment IDs start with WE) and A. House outlines come from Microsoft Global ML Building Footprints (February 2026). Where `outline_estimated` is true, the house has a standard house-sized box (9 houses).

## Milestones

1. **Map only.** Render one den from the JSON and compare it against that den's page in the PDF.
2. **GPS dot.** Add location, accuracy and "centre on me". Test while walking a real segment.
3. **Segment sheet and texts.** Tap a segment, see its lines, tap Done and get a pre-filled text. Test on iPhone and Android.
4. **QR flow.** Build the dispatcher QR page, the fragment handling and `localStorage`, and clear the fragment after reading.
5. **Offline and polish.** Add caching, the sunlight check and the den picker.
6. **Dry run.** A den leader walks a segment with the page before Week 2.

## Open questions for Jay

- One QR per den, or one for the whole pack with a den picker? (Both work. Per-den is friendlier.)
- Should the week (`Wk1` or `Wk2`) go in the text?
- Do Week 1 and Week 2 have different dispatchers? (If so, there will be a new QR sheet each week.)
- Where should it be hosted: GitHub Pages or an artifact link?

## Later (2027 planner)

The planner side covers boundaries, county address pull, den balancing, auto-segments with hand editing, and printing the PDFs. It lives in `planner/` as Python scripts today. `docs/how-the-maps-were-made.md` has the method, data sources and lessons learned.
