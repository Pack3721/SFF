# Plan: SFF day-of tracker (phone map)

A phone web page that shows a den's walking map for Scouting for Food, with a "you are here" GPS dot. It also has buttons that open a pre-written text to the dispatcher.

Families can use the paper map pack or this page. Both use the same segment IDs, colours, house numbers and text messages, so the dispatcher can't tell them apart.

Status: milestones 1 (map) and 2 (GPS dot) are built in `app/` and deploy to GitHub Pages. Texts and the QR flow come next.

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

1. **The dispatcher, the morning of each week,** opens the QR page, types their mobile number and picks Week 1 (bags) or Week 2 (pickup). The page prints one QR code for the whole pack.
2. **A parent** scans the pack's code and picks their den. The map opens zoomed to that den and remembers the choice. The first time, it also asks for the group letter (for "Wolf A"), the same as the "Your group" blank on page 1 of the paper pack.
   The den picker stays on the map, because the dispatcher may send a group that's finished to help another den's area. The picker also has a "Whole pack" view.
3. **On the walk,** the parent taps a segment to see its checklist lines (numbers, street and side, ⚠ warnings) and taps a button to text the dispatcher.

## Text messages

These match the wording printed on page 1 of the map pack:

| Button | Message |
|---|---|
| Done | `Wk1 Wolf A – W7 done` |
| Available for more | `Wk1 Wolf A available` |
| Need bags (Week 1 only) | `Wk1 Wolf A – W8 need bags` |
| Need help | `Wk1 Wolf A – W8 need help` |

The week (`Wk1` or `Wk2`) goes at the front, so the dispatcher can tell a late Week 1 text from a Week 2 one. The rest matches page 1.

`sms:` links work differently on each phone. iOS uses `sms:+1NUMBER&body=…`, and Android uses `sms:+1NUMBER?body=…`. Test both. `sms:+1NUMBER?&body=…` is known to work on both, but check it. Encode the body with `encodeURIComponent`.

## Dispatcher number

- **QR link format:** `https://<host>/#tel=3145550123&wk=1&den=W`. The `#` part (the fragment) is never sent to the web server, so it isn't in server logs and isn't in the Referer header.
- **When the page opens:** it reads the fragment, checks the number (10 digits, US), saves `tel`, `wk` and the group to `localStorage`, then clears the fragment with `history.replaceState`. That way the number doesn't travel if someone copies or screen-shares the link.
- **Opened with no number:** it asks the user to type one, or to scan the dispatcher's QR code. It never guesses.
- **A new QR code** overwrites the saved number and week, which covers a different dispatcher in Week 2.
- **Never commit a phone number** to this repo, in code, data or tests. Use `555-0100`-style test numbers.
- **No third-party scripts, fonts or analytics,** because they could read `location.hash`. Everything is inline in the page or served from the same host.

## Map rendering

- Read `data/sff-2026.json` (see the schema below). It's about 700 KB (about 155 KB gzipped, mostly background buildings), fetched once by the page.
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

GitHub Pages, deployed by `.github/workflows/pages.yml` on each push to `main` that touches `app/` or the data. The workflow copies `app/` plus the data file into the site. (`app/sff-2026.json` is a symlink to `data/` so local testing works.) One-time setup: Settings → Pages → Source: **GitHub Actions**.

The workflows are checked with [zizmor](https://docs.zizmor.sh/) (`.github/workflows/zizmor.yml`). Actions are pinned to commit SHAs, and Dependabot keeps them current. Run `zizmor .` locally before pushing workflow changes.

The page must work from a plain static host, with no build server needed. A small build step (for example, inlining the data) is fine if its output is committed.

## Data file: `data/sff-2026.json`

Generated by `planner/export_app_data.py` from `planner/build.py`. Don't hand-edit it; rerun the export instead.

```
{
  "event", "pack", "frozen": true, "coords": "[lon, lat] WGS84",
  "dens":     [{key, name, short, color, page, scouts, area, houses, segments:[ids]}],
  "segments": [{id, den, color, houses, main_road,
                lines:[{text, numbers, warning}],   // same text as the paper checklist and log
                label:[lon,lat],                    // where the PDF puts the segment ID tag
                route:[[lon,lat]...], route_parts:[[[lon,lat]...]...]}],
  "houses":   [{seg, num, street, lonlat, outline:[[lon,lat]...], outline_estimated}],
  "streets":  [{name, type, line}], "arterials": [{name, line}],
  "zones":    {C:[...], F:[...]}, "stops": [{label, lonlat}], "landmarks": [{name, lonlat}],
  "buildings": [[[lon,lat]...]...]   // faint background buildings not on any segment, near the walk
}
```

There are 79 segments and 1,183 houses. Den keys are L, T, W, B, WB (Webelos, whose segment IDs start with WE) and A. House outlines come from Microsoft Global ML Building Footprints (February 2026). Where `outline_estimated` is true, the house has a standard house-sized box (9 houses).

## Milestones

1. **Map only.** ✅ Render one den from the JSON and compare it against that den's page in the PDF. All six dens and a whole-pack view, with a den picker, pinch and zoom, and labels that give way to each other on a small screen.
2. **GPS dot.** Add location, accuracy and "centre on me". Test while walking a real segment. Built: the first tap asks for location, then the map follows you until you drag it. The dot goes grey after 30 s without a fix. GPS stops while the page is in the background and restarts on its own once allowed. Street names repeat along streets at walking zoom. **Still to do:** a walk on a real segment.
3. **Segment sheet and texts.** Tap a segment, see its lines, tap Done and get a pre-filled text. Test on iPhone and Android. Built so far: a Segments panel with two tabs, **Segments** (the den's, or every den's in the pack view) and **Mine**, ☆ to track the segments your group was given, and one **target** segment (the one you're on or heading to), shown in a banner. Tap a segment on the map or in the list for its card: all its lines, Track and Make target. Once you track any, the rest of the den fades. Segments tracked from another den are drawn on your den's map. The Mine tab has **Add by ID** for when the dispatcher sends a group elsewhere: type "B7" (or several, "B7, B8"), from any den, and the map jumps to it. All of it is saved on the phone. **Still to do:** the text buttons on the card.
4. **QR flow.** Build the dispatcher QR page, the fragment handling and `localStorage`, and clear the fragment after reading.
5. **Offline and polish.** Add caching, the sunlight check and the den picker.
6. **Dry run.** A den leader walks a segment with the page before Week 2.

## Decisions

- **One QR code for the whole pack,** with a den picker. Dens may need help, and the dispatcher sends free groups to other areas.
- **The week goes in the text:** `Wk1 Wolf A – W7 done`.
- **The dispatcher may be the same both weeks.** A new QR sheet is only needed if the number changes. The week can also be changed in settings.
- **Hosting:** GitHub Pages, with the workflows checked by zizmor.
- **iPhones: add to the Home Screen.** Safari tabs are often blocked from location by the phone's settings and never ask. The Home Screen app ("SFF Map") asks for itself, so the app suggests it when Safari is blocked. Worth saying on the QR sheet too.

## Later (2027 planner)

The planner side covers boundaries, county address pull, den balancing, auto-segments with hand editing, and printing the PDFs. It lives in `planner/` as Python scripts today. `docs/how-the-maps-were-made.md` has the method, data sources and lessons learned.
