// SFF day-of tracker: a den's walking map from data/sff-2026.json, a GPS dot, and your segments.
// It draws the same layers as the den pages of the printed pack (planner/build.py, draw_den_map),
// with labels kept at a readable screen size as you pinch and zoom.
"use strict";

// ---------- projection: the same local units as planner/build.py (about 1.1 m each) ----------
const KX = 0.782;                       // cos(38.53°)
const M_PER_UNIT = 1.1132;              // 1e-5° of latitude
const X = (lon) => (lon + 90.4) * 1e5 * KX;
const Y = (lat) => -(lat - 38.49) * 1e5; // SVG y points down
const P = ([lon, lat]) => [X(lon), Y(lat)];

const ARTERIAL_STREETS = new Set(["BAPTIST CHURCH RD", "MUSICK AVE", "MUSICK RD", "S LINDBERGH BLVD",
  "LINDBERGH BLVD", "TESSON FERRY RD", "GRAVOIS RD"]);
const PEN_LIFT = 115;                   // a gap this long in a route is a walk, not a line
const PACK = "ALL";
const STORE_KEY = "sff.den";

// The version is the ?v= on this script's own URL: the git SHA once deployed (pages.yml), "dev" locally.
const BUILD = new URL(document.currentScript.src).searchParams.get("v") || "dev";
document.getElementById("build").textContent = BUILD === "dev" ? "dev" : BUILD.slice(0, 7);
if (new URLSearchParams(location.search).has("week")) document.getElementById("build").textContent += " \u2022 week " + new URLSearchParams(location.search).get("week") + " test";

// Updates: a Home Screen app can sit suspended for days and wake on old code. Whenever the page starts,
// comes back to the front, is restored, or gets a signal again, fetch index.html fresh (cache: "reload"
// also refreshes the browser's copy) and reload if it names a different build.
let checking = false;
function checkForUpdate() {
  if (BUILD === "dev" || checking || !navigator.onLine) return;
  checking = true;
  fetch(location.pathname, { cache: "reload" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((html) => {
      const m = html.match(/app\.js\?v=([0-9a-f]+)/);
      if (!m || m[1] === BUILD) return;
      let tried = null;
      try { tried = sessionStorage.getItem("sff.reloadedFor"); } catch (_) { /* ignore */ }
      if (tried === m[1]) return;        // already reloaded for this build once: don't loop
      try { sessionStorage.setItem("sff.reloadedFor", m[1]); } catch (_) { /* ignore */ }
      location.reload();
    })
    .catch(() => { /* no signal: try again next time */ })
    .finally(() => { checking = false; });
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });
window.addEventListener("pageshow", (e) => { if (e.persisted) checkForUpdate(); });   // restored from memory
window.addEventListener("online", checkForUpdate);
checkForUpdate();
// Android needs the web manifest to install the app. iPhones get their icon and full screen from the
// apple-* tags in index.html, and without a manifest they keep the page's own address (with #tel=…)
// for the Home Screen icon, so the dispatcher's number comes along.
if (!isIOS()) {
  const ln = document.createElement("link");
  ln.rel = "manifest"; ln.href = "manifest.webmanifest";
  document.head.appendChild(ln);
}
const svg = document.getElementById("map");
const wrap = document.getElementById("wrap");
const fx = document.getElementById("fx");          // a thin layer over the map for the target's moving dashes
const fxView = document.getElementById("fx-view");
const ants = document.getElementById("ants");
const view = document.getElementById("view");
const NS = "http://www.w3.org/2000/svg";

let DATA = null;
let denKey = null;
let bbox = null;                        // [x0, y0, x1, y1] of the current den, in map units
let k = 1, tx = 0, ty = 0;              // screen = map * k + t
let scaled = [];                        // labels drawn at screen size: {el, x, y, rot, fit}
let strokes = [];                       // lines drawn at screen width: {el, px, dash}, all in screen px

// ---------- small helpers ----------
function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const a in attrs) e.setAttribute(a, attrs[a]);
  if (parent) parent.appendChild(e);
  return e;
}
const f1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function lineD(pts, hop) {              // polyline -> path data, lifting the pen on long gaps
  let d = "";
  pts.forEach((p, i) => {
    const move = i === 0 || (hop && dist(pts[i - 1], p) > hop);
    d += (move ? "M" : "L") + f1(p[0]) + " " + f1(p[1]);
  });
  return d;
}
function ringD(pts) { return lineD(pts) + "Z"; }

function inkOn(hex) {                   // black or white text, whichever reads better on this colour
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#111" : "#fff";
}
function tint(hex, a) {                 // build.py _tint: mix with white
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(255 * (1 - a) + v * a));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function midOn(pts) {                   // point and angle half way along a polyline
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = dist(a, b);
    if (acc + d >= L / 2 && d > 0) {
      const t = (L / 2 - acc) / d;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ang: upright(a, b), L };
    }
    acc += d;
  }
  return { p: pts[0], ang: 0, L };
}
function alongLine(pts, d) {            // point and text angle at distance d along a polyline
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = dist(a, b);
    if (acc + l >= d && l > 0) {
      const t = (d - acc) / l;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ang: upright(a, b) };
    }
    acc += l;
  }
  const n = pts.length;
  return { p: pts[n - 1], ang: upright(pts[n - 2], pts[n - 1]) };
}
function upright(a, b) {                // text angle that never reads upside down
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  return ang;
}

// A group that stays the same size on screen at (x, y) whatever the zoom.
// prio 0 always shows (segment IDs, stops, arrows); higher numbers give way to lower ones when they overlap:
// 1 end house numbers, 2 main road names, 3 street names. `fit` is a street's length: its name hides if it's longer.
const ALWAYS = 0, NUMBER = 1, ROAD = 2, STREET = 3;
function screenGroup(parent, x, y, rot, prio, fit) {
  const g = el("g", {}, parent);
  scaled.push({ el: g, x, y, rot: rot || 0, prio, fit: fit || 0 });
  return g;
}
function screenStroke(e, px, dash) { strokes.push({ el: e, px, dash }); return e; }

// ---------- drawing ----------
// landmark badges, drawn on a 24-unit grid: a schoolhouse with a flag, and a firehouse with its garage door
const LANDMARK_ICONS = {
  school: { color: "#1f4e8c", d: "M12 1.5h4v2.5h-3v1.6l8 6.4h-2.5v9.5H5.5V12H3l8-6.4V1.5zM10 21.5v-5h4v5z" },
  fire: { color: "#c62828", labelLeft: true, d: "M3.5 9.5L12 3l8.5 6.5V21h-17zM7 12h10v9H7zM7 14.2h10v1.3H7zM7 17.2h10v1.3H7z" },   // a firehouse: a building with a big garage door
};
function draw() {
  view.textContent = "";
  scaled = []; strokes = []; placedK = 0;
  const D = DATA;
  const pack = denKey === PACK;
  const den = pack ? null : D.dens.find((d) => d.key === denKey);
  const mine = new Set(pack ? D.segments.map((s) => s.id) : den.segments);
  // also draw segments you track from other dens (when the dispatcher sends you to help)
  const shown = new Set(leader ? mine : [...mine, ...mySegs.tracked]);   // den leader: just this den
  const segs = D.segments.filter((s) => shown.has(s.id));
  segEls = {};
  const denColor = Object.fromEntries(D.dens.map((d) => [d.key, d.color]));
  const colorOf = (s) => (pack ? denColor[s.den] : s.color);

  // the den's box, as den_bbox in build.py (Lindbergh houses left out, 45 units of padding)
  const hs = D.houses.filter((h) => mine.has(h.seg) && (pack || h.street !== "LINDBERGH BLVD")).map((h) => P(h.lonlat));
  bbox = [Math.min(...hs.map((p) => p[0])) - 45, Math.min(...hs.map((p) => p[1])) - 45,
          Math.max(...hs.map((p) => p[0])) + 45, Math.max(...hs.map((p) => p[1])) + 45];

  const layer = (name) => el("g", { id: "l-" + name }, view);
  const Lstreet = layer("streets"), Lbld = layer("buildings"), Lzone = layer("zones"),
        Lslabel = layer("street-labels"), Lhalo = layer("halos"), Lroute = layer("routes"), Lhouse = layer("houses"),
        Larrow = layer("arrows"), Lnum = layer("numbers"), Lid = layer("ids"),
        Lalabel = layer("arterial-labels"), Lstop = layer("stops");

  // 1. streets: a grey casing and a near-white fill (type 3+ are the wider collectors). All casings go
  // under all fills so crossings look joined. Drawn in grid pieces (see gridPaths).
  const streets = D.streets.filter((s) => !ARTERIAL_STREETS.has(s.name.toUpperCase()));
  const round = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  for (const [part, wide] of [["casing", false], ["casing", true], ["fill", false], ["fill", true]]) {
    const attrs = part === "casing" ? { stroke: "#d4d4d4", "stroke-width": wide ? 15 : 10 }
                                    : { stroke: "#f7f7f7", "stroke-width": wide ? 11.3 : 6.3 };
    gridPaths(Lstreet, streets.filter((s) => (s.type >= 3) === wide).map((s) => s.line.map(P)), lineD, { ...round, ...attrs });
  }
  // arterials: wider and tan, run on past the data so they leave the edge of the map; one path each
  const arts = D.arterials.map((a) => ({ name: a.name, pts: extend(a.line.map(P), 4000) }));
  for (const a of arts) el("path", { d: lineD(a.pts), fill: "none", stroke: "#c8c8c8", "stroke-width": 18 }, Lstreet);
  for (const a of arts) el("path", { d: lineD(a.pts), fill: "none", stroke: "#fff6dc", "stroke-width": 14 }, Lstreet);

  // street names: along every piece of street, about every 300 units on long ones. Declutter keeps
  // copies of one name well apart on screen, and drops a name where the street is too short for it.
  for (const st of streets) {
    const pts = st.line.map(P);
    const L = midOn(pts).L;
    if (L < 60) continue;
    const n = Math.max(1, Math.round(L / 300));
    for (let i = 0; i < n; i++) {
      const at = alongLine(pts, L * (i + 0.5) / n);
      const g = screenGroup(Lslabel, at.p[0], at.p[1], at.ang, STREET, L / n);
      g.name = st.name;
      el("text", { class: "street", "text-anchor": "middle", "dominant-baseline": "central" }, g).textContent = st.name;
    }
  }
  // arterial names, repeated along the road
  const all = D.houses.map((h) => P(h.lonlat));
  const ext = [Math.min(...all.map((p) => p[0])) - 150, Math.min(...all.map((p) => p[1])) - 150,
               Math.max(...all.map((p) => p[0])) + 150, Math.max(...all.map((p) => p[1])) + 150];
  for (const a of arts) {
    let acc = 0, next = 120;
    for (let i = 1; i < a.pts.length; i++) {
      const p0 = a.pts[i - 1], p1 = a.pts[i], d = dist(p0, p1);
      while (acc + d >= next) {
        const t = (next - acc) / d, p = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
        if (p[0] > ext[0] && p[0] < ext[2] && p[1] > ext[1] && p[1] < ext[3]) {
          const g = screenGroup(Lalabel, p[0], p[1], upright(p0, p1), ROAD);
          el("text", { class: "artname", "text-anchor": "middle", "dominant-baseline": "central" }, g).textContent = a.name;
          next += 550;
        } else next += 40;
      }
      acc += d;
    }
  }

  // 2. buildings that aren't on any segment, then other dens' houses, both faint
  gridPaths(Lbld, D.buildings.map((r) => r.map(P)), ringD, { fill: "#efefef" });
  gridPaths(Lbld, D.houses.filter((h) => !shown.has(h.seg)).map((h) => h.outline.map(P)), ringD, { fill: "#dcdcdc" });

  // 3. zone outlines, dashed
  for (const z in D.zones) {
    const e = el("path", { d: ringD(D.zones[z].map(P)), fill: "none", stroke: "#222", opacity: 0.7 }, Lzone);
    screenStroke(e, 1.5, [6, 4]);
  }

  // 4. this den's segments
  const housesOf = {};
  for (const h of D.houses) (housesOf[h.seg] ||= []).push(h);
  for (const s of segs) {
    const c = colorOf(s);
    const routes = [s.route, ...s.route_parts].map((r) => r.map(P));
    const rd = routes.map((r) => lineD(r, PEN_LIFT)).join("");
    // a wide halo under the target and the selected segment (hidden until styleSegments shows it)
    const halo = el("path", { d: rd, fill: "none", stroke: "#111", "stroke-linecap": "round", "stroke-linejoin": "round" }, Lhalo);
    screenStroke(halo, 14, null);
    const re = el("path", { d: rd, fill: "none", stroke: c, opacity: 0.85,
                            "stroke-linecap": "round", "stroke-linejoin": "round" }, Lroute);
    screenStroke(re, 5, s.main_road ? [11, 6] : null);   // dash 2.2 and gap 1.2 line widths, as the PDF

    const hh = housesOf[s.id] || [];
    const he = el("path", { d: hh.map((h) => ringD(h.outline.map(P))).join(""), fill: tint(c, 0.45) }, Lhouse);
    segEls[s.id] = { seg: s, color: c, routes, houses: hh, halo, route: re, homes: he, extras: [], d: rd,
                     paint: [[re, "stroke", c, "#a9a9a9"], [he, "fill", tint(c, 0.45), "#d6d6d6"]] };
    const extra = (g, kind, part, attr) => {   // a label of this segment, and the part that takes its colour
      g.segId = s.id; g.kind = kind;
      segEls[s.id].extras.push(g);
      segEls[s.id].paint.push([part, attr, c, "#9a9a9a"]);
    };

    // start arrow: from the first route point toward the first point at least 12 units on
    const rt = routes[0];
    if (rt.length > 1) {
      let j = 1;
      while (j < rt.length - 1 && dist(rt[0], rt[j]) < 12) j++;
      const ang = Math.atan2(rt[j][1] - rt[0][1], rt[j][0] - rt[0][0]) * 180 / Math.PI;
      const g = screenGroup(Larrow, rt[j][0], rt[j][1], ang, ALWAYS);
      extra(g, "arrow", el("path", { d: "M2 0 L-12 -6.5 L-9 0 L-12 6.5 Z", fill: c, stroke: "#fff", "stroke-width": 1.2, "stroke-linejoin": "round" }, g), "fill");
    }

    // house numbers at the first and last house
    if (!pack && hh.length) {
      const ends = hh.length > 1 ? [hh[0], hh[hh.length - 1]] : [hh[0]];
      for (const h of ends) {
        const [x, y] = P(h.lonlat);
        const g = screenGroup(Lnum, x, y, 0, NUMBER);
        const t = el("text", { class: "endnum", fill: c, "text-anchor": "middle", y: -5 }, g);
        t.textContent = h.num;
        extra(g, "num", t, "fill");
      }
    }

    // segment ID tag, where the PDF puts it
    const [lx, ly] = P(s.label);
    const g = screenGroup(Lid, lx, ly, 0, pack ? NUMBER : ALWAYS);   // in the pack view IDs give way to each other
    segEls[s.id].tag = [lx, ly];
    const box = el("rect", { fill: c, stroke: s.main_road ? "#222" : "#fff", "stroke-width": 1.5, rx: 4 }, g);
    extra(g, "tag", box, "fill");
    const t = el("text", { class: "segid", "text-anchor": "middle", "dominant-baseline": "central" }, g);
    const label = s.id + (s.main_road ? " ⚠" : "");
    t.textContent = label + " \u2714\ufe0e";
    const wDone = t.getComputedTextLength() + 10;   // measured now, while it's on screen
    t.textContent = label;
    const w = t.getComputedTextLength() + 10;
    box.setAttribute("x", -w / 2); box.setAttribute("y", -11); box.setAttribute("width", w); box.setAttribute("height", 22);
    Object.assign(segEls[s.id], { tagText: t, tagBox: box, tagLabel: label, tagW: [w, wDone] });
  }

  // in the pack view, each den's name over the middle of its houses
  if (pack) {
    for (const d of D.dens) {
      const ps = D.houses.filter((h) => d.segments.includes(h.seg) && h.street !== "LINDBERGH BLVD").map((h) => P(h.lonlat));
      const cx = ps.reduce((a, p) => a + p[0], 0) / ps.length, cy = ps.reduce((a, p) => a + p[1], 0) / ps.length;
      const g = screenGroup(Lid, cx, cy, 0, ALWAYS);
      el("text", { class: "denname", fill: d.color, "text-anchor": "middle", "dominant-baseline": "central" }, g).textContent = d.short;
    }
  }

  // landmarks: Sappington Elementary (where we meet at the start) with a schoolhouse, and Fire
  // Station 5 (Week 2's bag drop-off) with a firehouse. A round badge and its name.
  for (const lm of D.landmarks) {
    const [x, y] = P(lm.lonlat);
    const g = screenGroup(Lstop, x, y, 0, ALWAYS);
    const icon = LANDMARK_ICONS[lm.icon];
    el("circle", { r: icon ? 12 : 7, fill: icon ? icon.color : "#1a1a1a", stroke: "#fff", "stroke-width": 2.5 }, g);
    if (icon) el("path", { d: icon.d, fill: "#fff", "fill-rule": "evenodd", transform: "translate(-8 -8) scale(.6667)" }, g);
    const left = icon && icon.labelLeft;   // the firehouse is at the map's east edge: name on its left
    el("text", { class: "landmark", x: left ? -17 : icon ? 17 : 12, "text-anchor": left ? "end" : "start", "dominant-baseline": "central" }, g)
      .textContent = lm.name;
  }

  // 5. stop signs
  for (const st of D.stops) {
    const [x, y] = P(st.lonlat);
    const g = screenGroup(Lstop, x, y, 0, ALWAYS);
    const oct = [];
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * Math.PI / 4;
      oct.push([10 * Math.cos(a), 10 * Math.sin(a)]);
    }
    el("path", { d: ringD(oct), fill: "#d0021b", stroke: "#fff", "stroke-width": 1.5 }, g);
    el("text", { class: "stoptext", "text-anchor": "middle", "dominant-baseline": "central" }, g).textContent = "STOP";
    el("text", { class: "stoplabel", x: 14, y: 20 }, g).textContent = st.label;
  }

  // header
  const info = document.getElementById("den-info");
  const color = pack ? "#333" : den.color;
  document.documentElement.style.setProperty("--den", color);
  info.textContent = pack
    ? `${D.houses.length} houses • ${D.segments.length} segments`
    : `Zone ${den.area} • ${den.houses} houses • ${den.segments.length} segments`;
  fxView.appendChild(me.g);             // the GPS dot sits on the top layer, above every label
  styleSegments();
  renderList();
}

// Many shapes as a grid of paths, ~300 units (330 m) a cell, instead of one giant path. The phone paints
// the map in tiles, and a tile only has to paint the pieces that touch it, so redraws after a zoom
// finish much sooner (fewer blank tiles if you pan straight away).
const GRID = 300;
function gridPaths(parent, shapes, toD, attrs) {
  const cells = new Map();
  for (const pts of shapes) {
    const key = Math.floor(pts[0][0] / GRID) + "," + Math.floor(pts[0][1] / GRID);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(toD(pts));
  }
  for (const ds of cells.values()) el("path", { ...attrs, d: ds.join("") }, parent);
}

function extend(pts, far) {             // build.py _ext: run a road on past both ends
  const [a, b] = pts, [c, d] = pts.slice(-2);
  const u = dist(a, b) || 1, v = dist(c, d) || 1;
  return [[a[0] + (a[0] - b[0]) / u * far, a[1] + (a[1] - b[1]) / u * far], ...pts,
          [d[0] + (d[0] - c[0]) / v * far, d[1] + (d[1] - c[1]) / v * far]];
}

// ---------- zoom and pan ----------
// Redrawing thousands of shapes on every finger move is slow on a phone. So while a finger is down,
// the whole SVG moves as one picture with a CSS transform (the GPU does it), and the real redraw,
// with labels resized and decluttered, happens once when the gesture ends ("commit").
let fitK = 1;
let mx = 0, my = 0;                     // the SVG's extra margin past each edge of the screen, in px
let k0 = 1, tx0 = 0, ty0 = 0;           // the view the SVG was last drawn at

function layout() {
  const r = wrap.getBoundingClientRect();
  mx = Math.round(r.width * 0.25); my = Math.round(r.height * 0.25);
  svg.style.left = -mx + "px"; svg.style.top = -my + "px";
  svg.style.width = r.width + 2 * mx + "px"; svg.style.height = r.height + 2 * my + "px";
  fx.style.left = svg.style.left; fx.style.top = svg.style.top;
  fx.style.width = svg.style.width; fx.style.height = svg.style.height;
}

function fit(instant) { fitBox(bbox, instant); }
function fitBox(box, instant) {
  stopGlide();
  follow(false);
  layout();
  const r = wrap.getBoundingClientRect();
  const side = dispatch && dispatchWide() ? dispatchPanel.getBoundingClientRect().width : 0;   // the dispatcher's side panel
  const cardH = leader ? leaderPanel.getBoundingClientRect().height
              : dispatch ? (side ? 0 : dispatchPanel.getBoundingClientRect().height)
              : card.classList.contains("open") ? card.getBoundingClientRect().height : 0;
  const below = setupStatus.hidden ? banner : setupStatus;
  const padTop = leader || dispatch ? 56 : below.getBoundingClientRect().bottom - r.top + 12, padSide = 12;           // room for the north arrow, banner,
  const padBottom = Math.max(60, cardH + 16);                      // scale, buttons and the segment card
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const W = r.width - 2 * padSide - side, H = r.height - padTop - padBottom;
  const nk = Math.min(W / bw, H / bh, 4);
  if (box === bbox) fitK = nk;
  goTo(nk, padSide + (W - bw * nk) / 2 - box[0] * nk, padTop + (H - bh * nk) / 2 - box[1] * nk, instant);
}

// Move the view to (nk, ntx, nty): a short glide that zooms and pans together (the map point under the
// middle of the screen slides, the zoom changes evenly), drawn with preview() and committed at the end.
const GLIDE_MS = 400;
let anim = 0;
function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
function goTo(nk, ntx, nty, instant) {
  stopGlide(); stopAnim();
  if (instant || calm) { k = nk; tx = ntx; ty = nty; commit(); return; }
  const r = wrap.getBoundingClientRect(), sx = r.width / 2, sy = r.height / 2;
  const lk0 = Math.log(k), lk1 = Math.log(nk);
  const c0 = [(sx - tx) / k, (sy - ty) / k], c1 = [(sx - ntx) / nk, (sy - nty) / nk];
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / GLIDE_MS);
    if (t >= 1) { anim = 0; k = nk; tx = ntx; ty = nty; commit(); return; }
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // ease in and out
    k = Math.exp(lk0 + (lk1 - lk0) * e);
    tx = sx - (c0[0] + (c1[0] - c0[0]) * e) * k;
    ty = sy - (c0[1] + (c1[1] - c0[1]) * e) * k;
    preview();
    anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function preview() {                    // cheap: move the picture drawn at (k0, tx0, ty0) to (k, tx, ty)
  const s = k / k0;
  // a plain pan nearing the edge of what's drawn: redraw now (only the offset changes) so no blank shows
  if (s === 1 && (Math.abs(tx - tx0) > mx * 0.6 || Math.abs(ty - ty0) > my * 0.6)) { commit(); return; }
  const dx = tx - tx0 * s + mx * (1 - s), dy = ty - ty0 * s + my * (1 - s);
  svg.style.transform = fx.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  scaleBar();
  edgeArrow();
}

let placedK = 0;
let printScale = 0;                       // while drawing a handout: how much smaller the ID tags are
function commit() {                     // the full redraw at the current view
  const panOnly = k === k0 && k === placedK;   // labels and line widths only depend on the zoom
  k0 = k; tx0 = tx; ty0 = ty;
  svg.style.transform = fx.style.transform = "";
  view.setAttribute("transform", `translate(${tx + mx} ${ty + my}) scale(${k})`);
  fxView.setAttribute("transform", view.getAttribute("transform"));
  sizeAnts();
  edgeArrow();
  drawMe();
  if (panOnly) return;
  const inv = 1 / k;
  const shrink = Math.min(Math.max(k / 0.8, 0.75), 1);   // labels a bit smaller when zoomed far out
  for (const s of scaled) {
    if (!s.box) measure(s);
    const sm = printScale && s.el.kind === "tag" ? printScale : 1;   // smaller ID tags on printed handouts
    s.el.setAttribute("transform", `translate(${f1(s.x)} ${f1(s.y)}) scale(${inv * shrink * sm}) rotate(${f1(s.rot)})`);
  }
  if (k !== placedK) { placedK = k; declutter(shrink); }  // panning doesn't change what overlaps
  syncFxCopies();
  for (const s of strokes) {
    s.el.setAttribute("stroke-width", s.px * inv);
    if (s.dash) s.el.setAttribute("stroke-dasharray", s.dash.map((v) => v * inv).join(" "));
  }
  scaleBar();
}

function scaleBar() {                   // the longest round number of metres that fits in 160 px
  const mPerPx = M_PER_UNIT / k;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
  // up to 160 px, but clear of the round buttons on narrow phones
  const room = document.getElementById("tools").getBoundingClientRect().left - document.getElementById("scale").getBoundingClientRect().left - 12;
  const most = Math.max(60, Math.min(160, room || 160));
  const m = steps.filter((v) => v / mPerPx <= most).pop() || 10;
  document.getElementById("scale-bar").style.width = Math.round(m / mPerPx) + "px";
  document.getElementById("scale-text").textContent = `${m} m (~${Math.round(m * 3.281 / 10) * 10} ft)`;
}

function measure(s) {                  // the label's screen box at scale 1, turned by its angle
  const b = s.el.getBBox(), a = s.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), n = Math.abs(Math.sin(a));
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  s.box = { dx: cx * Math.cos(a) - cy * Math.sin(a), dy: cx * Math.sin(a) + cy * Math.cos(a),
            hw: (b.width * c + b.height * n) / 2 + 1, hh: (b.width * n + b.height * c) / 2 + 1, w: b.width };
}
const GREY = 9;                          // labels of grey (untracked) segments: give way to everything
function declutter(shrink) {
  const placed = [];
  const prio = (s) => (s.el.segId && segEls[s.el.segId] && segEls[s.el.segId].faded ? GREY : s.prio);
  const order = scaled.slice().sort((a, b) => prio(a) - prio(b));
  for (const s of order) {
    const x = s.x * k + s.box.dx * shrink, y = s.y * k + s.box.dy * shrink;
    const hw = s.box.hw * shrink, hh = s.box.hh * shrink;
    let show = true;
    if (s.fit && s.fit * k < s.box.w * shrink + 16) show = false;   // street too short for its name
    if (prio(s) === GREY && s.el.kind !== "tag" && k < 1) show = false;   // grey arrows and numbers: walking zoom only
    if (show && prio(s) !== ALWAYS)
      show = !placed.some((p) => (Math.abs(p.x - x) < p.hw + hw && Math.abs(p.y - y) < p.hh + hh) ||
                                 (s.el.name && p.name === s.el.name && Math.hypot(p.x - x, p.y - y) < 250));
    s.el.style.display = show ? "" : "none";
    if (show && s.el.parentNode.id !== "l-arrows") placed.push({ x, y, hw, hh, name: s.el.name });
  }
}

function zoomAt(sx, sy, factor) {       // changes the view; the caller previews or commits it
  const nk = Math.min(Math.max(k * factor, fitK * 0.5), 12);
  const px = (sx - tx) / k, py = (sy - ty) / k;
  k = nk; tx = sx - px * k; ty = sy - py * k;
}

const pointers = new Map();
let last = null;                         // {x, y, d} of the previous move: center and finger spread
function gesture() {
  const ps = [...pointers.values()];
  if (ps.length === 1) return { x: ps[0].x, y: ps[0].y, d: 0 };
  const [a, b] = ps;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}
function local(e) {
  const r = wrap.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
// Fling: after a one-finger drag, the map keeps gliding at the finger's last speed and slows down,
// like other phone maps. `samples` holds recent finger positions to measure that speed.
let moved = false, samples = [], glide = 0;
const FRICTION_MS = 325;                 // speed falls to about a third every 325 ms
function stopGlide() { if (glide) { cancelAnimationFrame(glide); glide = 0; } }
function startGlide() {
  const now = performance.now();
  const recent = samples.filter((s) => now - s.t < 100);
  if (recent.length < 2 || now - recent[recent.length - 1].t > 50) return false;   // finger had stopped
  const a = recent[0], b = recent[recent.length - 1], dt = b.t - a.t || 1;
  let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;                                 // px per ms
  if (Math.hypot(vx, vy) < 0.25) return false;
  let prev = now;
  const step = (t) => {
    const dt = Math.min(t - prev, 50); prev = t;
    tx += vx * dt; ty += vy * dt;
    const f = Math.exp(-dt / FRICTION_MS); vx *= f; vy *= f;
    if (Math.hypot(vx, vy) < 0.02) { glide = 0; commit(); return; }
    preview();
    glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
  return true;
}

wrap.addEventListener("pointerdown", (e) => {
  if (glide || anim) { stopGlide(); stopAnim(); moved = true; }   // a touch catches a moving map; redraw when it lifts
  samples = [];
  wrap.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  last = gesture();
});
wrap.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, local(e));
  const g = gesture();
  if (last && pointers.size <= 2) {
    tx += g.x - last.x; ty += g.y - last.y;
    if (g.d && last.d) zoomAt(g.x, g.y, g.d / last.d);
    if (!moved) follow(false);           // moving the map yourself stops it following you
    moved = true;
    preview();
    if (pointers.size === 1) samples.push({ t: performance.now(), x: g.x, y: g.y });
    if (samples.length > 20) samples.shift();
  }
  last = g;
});
let lastTap = 0;
const lift = (e) => {
  if (!pointers.delete(e.pointerId)) return;
  last = pointers.size ? gesture() : null;
  if (pointers.size) { samples = []; return; }   // a finger count change isn't a fling
  if (moved) {
    moved = false; lastTap = 0;
    if (!(e.type === "pointerup" && startGlide())) commit();
    return;
  }
  const now = Date.now();                // double-tap to zoom in
  if (e.type === "pointerup" && now - lastTap >= 300) tapAt(local(e));   // one tap: pick the segment there
  if (e.type === "pointerup" && now - lastTap < 300) {
    const p = me.following ? myScreen() : local(e);   // while following, zoom in on yourself
    const from = [k, tx, ty];
    zoomAt(p.x, p.y, 2);
    const to = [k, tx, ty];
    [k, tx, ty] = from;
    goTo(...to); lastTap = 0;
  }
  else lastTap = now;
};
wrap.addEventListener("pointerup", lift);
wrap.addEventListener("pointercancel", lift);
let wheelTimer;
wrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  stopGlide(); stopAnim();
  follow(false);
  const p = local(e);
  zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  preview();
  clearTimeout(wheelTimer); wheelTimer = setTimeout(commit, 150);
}, { passive: false });
// Stop iOS zooming the page (the map has its own zoom). If the page does end up zoomed anyway, snap it
// back: briefly capping the viewport's scale at 1 makes iOS undo the zoom.
for (const ev of ["gesturestart", "gesturechange"]) document.addEventListener(ev, (e) => e.preventDefault());
const vp = document.getElementById("viewport");
let unzooming = false;
function unzoomPage() {
  if (unzooming || !window.visualViewport || visualViewport.scale <= 1.01) return;
  unzooming = true;
  const plain = vp.getAttribute("content");
  vp.setAttribute("content", plain + ", maximum-scale=1");
  setTimeout(() => { vp.setAttribute("content", plain); unzooming = false; }, 400);
}
if (window.visualViewport) visualViewport.addEventListener("resize", () => setTimeout(unzoomPage, 300));
document.addEventListener("visibilitychange", () => { if (!document.hidden) unzoomPage(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkWeek(); });   // woke up in a new week
window.addEventListener("pageshow", (e) => { if (e.persisted) checkWeek(); });

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const f = me.following; fit(true); if (f) centerOnMe(false); }, 150);
});

// ---------- GPS dot ----------
// The phone's location is only used to draw the dot. It is never stored or sent anywhere.
const WALK_K = 1.6;                      // "Center on me" zooms in to at least this: about 250 m across a phone
const STALE_MS = 30000;                  // no fix for this long: the dot goes grey
const GPS_KEY = "sff.gps";               // "1" once location has worked, so it can restart by itself
const me = { g: el("g", { id: "me" }), pos: null, acc: 0, lastFix: 0, watch: null, wanted: false,
             following: false, centerNext: false };
me.g.style.display = "none";
me.ring = el("circle", { class: "acc" }, me.g);
me.dot = el("g", {}, me.g);
// easy to spot: a pulsing ring, a white rim with a dark edge, a strong blue middle (all in screen px)
if (!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) {
  const pulse = el("circle", { r: 10, class: "pulse" }, me.dot);
  el("animate", { attributeName: "r", values: "10;28", dur: "1.6s", repeatCount: "indefinite" }, pulse);
  el("animate", { attributeName: "opacity", values: "0.45;0", dur: "1.6s", repeatCount: "indefinite" }, pulse);
}
me.beam = el("path", { d: "M0 0 L-19 -46 A50 50 0 0 1 19 -46 Z", class: "beam" }, me.dot);   // points north; rotated
me.beam.style.display = "none";
el("circle", { r: 12, fill: "#fff", stroke: "rgba(0,0,0,.45)", "stroke-width": 1, class: "halo" }, me.dot);
el("circle", { r: 8.5, class: "core" }, me.dot);
const meEdge = document.getElementById("me-edge");
meEdge.addEventListener("click", () => centerOnMe(true));

const meBtn = document.getElementById("me-btn");
const gpsStatus = document.getElementById("gps-status");
function status(text, bad) {
  gpsStatus.textContent = text || "";
  gpsStatus.hidden = !text;
  gpsStatus.classList.toggle("bad", !!bad);
}
gpsStatus.addEventListener("click", () => { gpsStatus.hidden = true; });   // tap to close a message
function remember(on) { try { on ? localStorage.setItem(GPS_KEY, "1") : localStorage.removeItem(GPS_KEY); } catch (_) { /* ignore */ } }

function myScreen() { return { x: me.pos[0] * k + tx, y: me.pos[1] * k + ty }; }

function drawMe() {
  if (!me.pos) return;
  const [x, y] = me.pos;
  me.ring.setAttribute("cx", f1(x)); me.ring.setAttribute("cy", f1(y));
  me.ring.setAttribute("r", Math.max(me.acc / M_PER_UNIT, 0));
  me.ring.setAttribute("stroke-width", 1.5 / k);
  me.dot.setAttribute("transform", `translate(${f1(x)} ${f1(y)}) scale(${1 / k})`);
  me.g.classList.toggle("stale", Date.now() - me.lastFix > STALE_MS);
  edgeArrow();
}
// When your dot is off the screen, an arrow at the edge points to it (tap to center on it). It stays
// in the clear part of the map: below the banner, above the buttons and notes at the bottom.
const meEdgeArrow = document.createElementNS(NS, "svg");
meEdgeArrow.setAttribute("viewBox", "-10 -10 20 20");
el("path", { d: "M8 0 L-6 -6.5 L-3 0 L-6 6.5 Z", fill: "#fff" }, meEdgeArrow);
meEdge.appendChild(meEdgeArrow);
const EDGE_ARROW = false;                 // on hold for now; set true to bring the edge arrow back
function edgeArrow() {
  if (!EDGE_ARROW || !me.pos || me.g.style.display === "none") { meEdge.hidden = true; return; }
  const r = wrap.getBoundingClientRect(), p = myScreen();
  if (p.x > 0 && p.x < r.width && p.y > 0 && p.y < r.height) { meEdge.hidden = true; return; }
  const above = setupStatus.hidden ? banner : setupStatus;
  const box = { l: 26, r: r.width - 26, t: above.getBoundingClientRect().bottom - r.top + 26, b: r.height - 150 };
  const cx = (box.l + box.r) / 2, cy = (box.t + box.b) / 2, dx = p.x - cx, dy = p.y - cy;
  const f = Math.min((box.r - cx) / Math.abs(dx || 1e-9), (box.b - cy) / Math.abs(dy || 1e-9));
  meEdge.hidden = false;
  meEdge.style.left = r.left + cx + dx * f + "px";
  meEdge.style.top = r.top + cy + dy * f + "px";
  meEdgeArrow.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
  meEdge.classList.toggle("stale", Date.now() - me.lastFix > STALE_MS);
}
setInterval(() => {
  if (!me.pos || !me.watch) return;
  drawMe();
  if (Date.now() - me.lastFix > STALE_MS) status("GPS lost – last known spot", true);
}, 5000);

function follow(on) {
  me.following = on;
  meBtn.classList.toggle("on", on);
  meBtn.setAttribute("aria-pressed", on);
}

function centerOnMe(zoomIn) {
  if (!me.pos) { me.centerNext = true; startGps(); return; }
  const r = wrap.getBoundingClientRect();
  const nk = zoomIn && k < WALK_K ? WALK_K : k;
  follow(true);
  goTo(nk, r.width / 2 - me.pos[0] * nk, r.height / 2 - me.pos[1] * nk);
}

function onFix(p) {
  const c = p.coords;
  // while walking, GPS gives a direction of travel: use it when there's no compass
  if (c.heading != null && !isNaN(c.heading) && (c.speed == null || c.speed > 0.5)) setHeading(c.heading, "gps");
  me.pos = P([c.longitude, c.latitude]);
  me.acc = c.accuracy;
  me.lastFix = Date.now();
  me.g.style.display = "";
  if (!DEMO) remember(true);
  const area = DATA && DATA.houses.map((h) => P(h.lonlat));
  const far = area && area.every((q) => dist(q, me.pos) > 900);   // ~1 km from every house on the walk
  status(DEMO ? "Demo location \u2013 not real GPS" : far ? "You're away from the walk area" : `GPS \u00b1${Math.round(c.accuracy)} m`);
  if (me.centerNext) { me.centerNext = false; centerOnMe(true); }
  else if (me.following) centerOnMe(false);
  else drawMe();
}

// iPhones refuse without asking when location is off for the browser, so say where to switch it on.
function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
function blockedHelp() {
  const ua = navigator.userAgent;
  const ios = isIOS();
  if (ios && /CriOS/.test(ua))
    return "Location is off for Chrome. iPhone Settings \u203a Privacy & Security \u203a Location Services \u203a Chrome \u203a While Using. Then reload.";
  if (ios && /FxiOS/.test(ua))
    return "Location is off for Firefox. iPhone Settings \u203a Privacy & Security \u203a Location Services \u203a Firefox \u203a While Using. Then reload.";
  if (ios && navigator.standalone)      // already opened from the Home Screen
    return "Location is blocked for SFF 721 Map. Check iPhone Settings \u203a Privacy & Security \u203a Location Services is on, then close and reopen SFF 721 Map and allow location when asked.";
  if (ios)                               // a Safari tab: the Home Screen app asks for itself, even when Safari can't
    return "Safari is blocking location. Add the map to your Home Screen instead: tap Share \u203a Add to Home Screen, open SFF 721 Map from there, and tap Allow when it asks for your location.";
  if (/Android/.test(ua))
    return "Location is blocked. Tap the icon left of the web address \u203a Permissions \u203a Location \u203a Allow, and check the phone's Location is on. Then reload.";
  return "Location is blocked. Allow it for this site in your browser's settings, then reload.";
}

function onError(e) {
  if (e.code === 1) {                    // PERMISSION_DENIED
    stopGps(); me.wanted = false; me.centerNext = false; remember(false); follow(false);
    status(blockedHelp(), true);
  } else if (e.code === 2) {             // POSITION_UNAVAILABLE
    status("Can't get a GPS fix yet. Try outside, away from buildings.", true);
  } else {                               // TIMEOUT: the watch keeps trying
    status(me.pos ? "GPS is slow – dot may be old" : "Still looking for GPS…", true);
  }
}

function startGps() {
  if (DEMO) { me.wanted = true; if (me.watch === null) me.watch = startDemo(); return; }
  if (!("geolocation" in navigator)) { status("This browser can't share location.", true); return; }
  me.wanted = true;
  if (me.watch !== null) return;
  startCompass(false);                   // Android: no asking needed; iPhone waits for the Center on me tap
  if (!me.pos) status("Finding you…");
  me.watch = navigator.geolocation.watchPosition(onFix, onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopGps() {
  if (me.watch !== null) { if (DEMO) clearInterval(me.watch); else navigator.geolocation.clearWatch(me.watch); }
  me.watch = null;
}

// Demo mode (open the page with ?demo): a pretend walker goes along your target segment (or your first
// tracked one, or the den's first) at walking pace, so the dot can be tried from anywhere. Nothing is saved.
const DEMO = new URLSearchParams(location.search).has("demo");
function startDemo() {
  const den = DATA.dens.find((d) => d.key === denKey);
  const s = segById(mySegs.target || mySegs.tracked[0] || (den ? den.segments[0] : "W2"));
  const pts = s.route;
  const m = (a, b) => Math.hypot((b[0] - a[0]) * 87000, (b[1] - a[1]) * 111000);   // degrees to metres here
  let i = 0, along = 0;
  const step = () => {
    along += 1.4;                          // metres a second
    while (i < pts.length - 1 && along > m(pts[i], pts[i + 1])) { along -= m(pts[i], pts[i + 1]); i++; }
    if (i >= pts.length - 1) { i = 0; along = 0; }
    const a = pts[i], b = pts[i + 1], t = along / (m(a, b) || 1);
    const course = (Math.atan2((b[0] - a[0]) * 87000, (b[1] - a[1]) * 111000) * 180 / Math.PI + 360) % 360;
    onFix({ coords: { longitude: a[0] + (b[0] - a[0]) * t, latitude: a[1] + (b[1] - a[1]) * t, accuracy: 8,
                      heading: course, speed: 1.4 } });
  };
  step();
  return setInterval(step, 1000);
}

// Center on me toggles: on = center and follow you; pressed again = stop following (the dot stays)
meBtn.addEventListener("click", () => {
  if (me.following) { follow(false); return; }
  startCompass(true); centerOnMe(true);
});

// ---------- compass: which way you're facing, as a beam on the dot ----------
// The map stays north-up (like the paper map); only the beam turns. iPhones ask permission for motion &
// orientation, so that's asked on the Center on me tap. Android's compass needs no asking. With no
// compass, the beam uses GPS's direction of travel while you walk. Off while the page is in the background.
let compassOn = false, heading = null, headingFrom = null, headingAt = 0;
function setHeading(deg, from) {
  if (from === "gps" && headingFrom === "compass" && Date.now() - headingAt < 3000) return;   // compass wins
  if (heading == null) heading = deg;
  else {                                  // smooth, the short way round
    const d = ((deg - heading + 540) % 360) - 180;
    heading = (heading + d * (from === "compass" ? 0.25 : 0.6) + 360) % 360;
  }
  headingFrom = from; headingAt = Date.now();
  me.beam.style.display = "";
  me.beam.setAttribute("transform", `rotate(${Math.round(heading)})`);
}
function onOrientation(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;              // iPhone: 0 = north, clockwise
  else if (e.absolute && e.alpha != null) {                                    // Android: alpha is anticlockwise
    const turn = (screen.orientation && screen.orientation.angle) || 0;
    h = (360 - e.alpha + turn) % 360;
  }
  if (h != null && !isNaN(h)) setHeading(h, "compass");
}
function startCompass(asked) {
  if (compassOn || DEMO) return;
  const listen = () => {
    compassOn = true;
    window.addEventListener("ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation", onOrientation);
  };
  const D = window.DeviceOrientationEvent;
  if (!D) return;
  if (typeof D.requestPermission === "function") {                           // iPhone: only from a tap
    if (!asked) return;
    D.requestPermission().then((r) => { if (r === "granted") listen(); }).catch(() => { /* no compass: GPS course */ });
  } else listen();
}
function stopCompass() {
  if (!compassOn) return;
  window.removeEventListener("deviceorientationabsolute", onOrientation);
  window.removeEventListener("deviceorientation", onOrientation);
  compassOn = false;
}
// hide the beam if nothing has said which way you face for a while
setInterval(() => { if (heading != null && Date.now() - headingAt > 15000) { me.beam.style.display = "none"; heading = null; } }, 5000);
// GPS off while the page is in the background, to save battery; back on when it returns.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stopGps(); stopCompass(); }
  else if (me.wanted) { startGps(); startCompass(false); }
});
// If location already worked here and is still allowed, start the dot without asking again.
function resumeGps() {
  let was = false;
  try { was = localStorage.getItem(GPS_KEY) === "1"; } catch (_) { /* ignore */ }
  if (!was || !navigator.permissions) return;
  navigator.permissions.query({ name: "geolocation" })
    .then((r) => { if (r.state === "granted") startGps(); })
    .catch(() => { /* no permissions API: wait for a tap */ });
}

// ---------- segments: your tracked ones, the current target, the list and the card ----------
// Tracked = the segments your group was given. Target = the one you're on or heading to.
// Both live only on this phone (localStorage).
const SEG_KEY = "sff.segments";
let mySegs = { tracked: [], target: null, done: [], covered: [] };   // covered: asked someone else to cover, this week   // done: segments you've texted Done for, this week
// Done is kept separately for each week (Week 2 starts with nothing done); tracked and target carry over.
let doneByWeek = {};                     // week -> ids, as saved; mySegs.done is this week's
// Second pass (Week 2): after all done, drive your segments again for bags put out late. The first pass's done
// marks are kept aside, done starts over, and a text goes only when a segment has new bags.
let pass2 = null;                        // {firstDone: [...], start: {id: bags at the start}} while on a second pass
let pass2ByWeek = {};
let coveredByWeek = {};                  // week -> ids crossed out after a "needs coverage" text
let bagsByWeek = {};                     // week -> {segment id: bags picked up}; Week 2's tally
let bags = {};                           // this week's tally
const tallying = () => week() === 2;     // bags are counted at pickup, not when they're handed out
let segWeek = null;                      // the week mySegs.done belongs to
let segEls = {};                         // id -> drawn pieces, rebuilt by draw()
let selected = null;                     // the segment shown in the card
const card = document.getElementById("card");
const sheet = document.getElementById("sheet");
const banner = document.getElementById("banner");

function loadSegs() {
  try {
    const v = JSON.parse(localStorage.getItem(SEG_KEY) || "{}");
    const ok = new Set(DATA.segments.map((s) => s.id));
    mySegs.tracked = (v.tracked || []).filter((id) => ok.has(id));
    mySegs.target = ok.has(v.target) ? v.target : null;
    // saves from before weeks were kept apart have a bare done list: that was Week 1
    doneByWeek = v.doneByWeek || (v.done ? { 1: v.done } : {});
    bagsByWeek = v.bagsByWeek || {};
    coveredByWeek = v.coveredByWeek || {};
    pass2ByWeek = v.pass2ByWeek || {};
  } catch (_) { /* nothing saved, or no storage */ }
  segWeek = weekKey();
  const ok = new Set(DATA.segments.map((s) => s.id));
  mySegs.done = (doneByWeek[segWeek] || []).filter((id) => ok.has(id));
  if (mySegs.done.includes(mySegs.target)) mySegs.target = null;
  mySegs.covered = (coveredByWeek[segWeek] || []).filter((id) => ok.has(id) && mySegs.tracked.includes(id));
  if (mySegs.covered.includes(mySegs.target)) mySegs.target = null;
  bags = {};
  for (const [id, n] of Object.entries(bagsByWeek[segWeek] || {})) if (ok.has(id) && n > 0) bags[id] = n;
  pass2 = pass2ByWeek[segWeek] || null;
}
// the date moved into another week while the page was open (or asleep): show that week's done marks
function checkWeek() {
  if (segWeek === null || segWeek === weekKey()) return;
  loadSegs(); autoTarget(); segmentsChanged(false);
}
function saveSegs() {
  doneByWeek[segWeek || weekKey()] = mySegs.done;
  bagsByWeek[segWeek || weekKey()] = bags;
  coveredByWeek[segWeek || weekKey()] = mySegs.covered;
  if (pass2) pass2ByWeek[segWeek || weekKey()] = pass2; else delete pass2ByWeek[segWeek || weekKey()];
  try { localStorage.setItem(SEG_KEY, JSON.stringify({ tracked: mySegs.tracked, target: mySegs.target, doneByWeek, bagsByWeek, coveredByWeek, pass2ByWeek })); }
  catch (_) { /* ignore */ }
}

const segById = (id) => DATA.segments.find((s) => s.id === id);
const denOf = (s) => DATA.dens.find((d) => d.key === s.den);
const segOrder = (a, b) => DATA.segments.indexOf(a) - DATA.segments.indexOf(b);
const isTracked = (id) => mySegs.tracked.includes(id);

// Tracking your first segment while looking at the whole pack switches the map to that segment's den
// (that's your den). Only the first: after that, segments from other dens are just added.
function joinDen(wasEmpty, id) {
  if (!wasEmpty || denKey !== PACK || !mySegs.tracked.length) return false;
  pick(segById(id).den);                 // redraws, relists and glides to the den
  renderBanner(); renderCard();
  return true;
}
// With just one unfinished segment of yours there's nothing to choose: make it the target. Done after
// tracking, untracking, Done, a restore and on start, but not after you clear the target yourself.
const stillToDo = (id) => !mySegs.done.includes(id) && !mySegs.covered.includes(id);   // not done, not handed off
function autoTarget() {
  if (mySegs.target) return;
  const left = mySegs.tracked.filter(stillToDo);
  if (left.length === 1) mySegs.target = left[0];
}
// After Done: with a recent GPS fix, the nearest unfinished segment of yours becomes the target. Which way
// you're facing (compass, or GPS direction of travel) counts a little: a segment behind you counts as up to
// half again as far. If it's wrong, a swipe changes it. Without GPS, nothing is picked (as before).
function nearestTarget() {
  if (mySegs.target || !me.pos || Date.now() - me.lastFix > 60000) return;
  const left = mySegs.tracked.filter(stillToDo).map(segById);
  if (left.length < 2) return;           // none, or autoTarget's one
  const facing = heading != null && Date.now() - headingAt < 15000 ? heading : null;
  let best = null, bestScore = Infinity;
  for (const s of left) {
    const pts = s.route.map(P);
    let d = Infinity, at = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const di = segDist(me.pos, pts[i - 1], pts[i]);
      if (di < d) { d = di; at = dist(me.pos, pts[i - 1]) < dist(me.pos, pts[i]) ? pts[i - 1] : pts[i]; }
    }
    let score = d;
    if (facing != null && d > 15) {      // right next to it, direction doesn't matter
      const bearing = Math.atan2(at[0] - me.pos[0], -(at[1] - me.pos[1])) * 180 / Math.PI;   // map y grows southward
      score *= 1 + 0.25 * (1 - Math.cos((bearing - facing) * Math.PI / 180));
    }
    if (score < bestScore) { bestScore = score; best = s.id; }
  }
  if (best) mySegs.target = best;
}
function setTracked(id, on) {
  if (!on && mySegs.done.includes(id)) return;   // done segments can't be removed (undo Done first)
  const wasEmpty = !mySegs.tracked.length;
  mySegs.tracked = mySegs.tracked.filter((x) => x !== id);
  if (on) mySegs.tracked.push(id);
  if (!on && mySegs.target === id) mySegs.target = null;
  autoTarget();
  saveSegs();
  if (on && joinDen(wasEmpty, id)) return;
  segmentsChanged(!on || !(id in segEls));
}
function setTarget(id) {
  const wasEmpty = !mySegs.tracked.length;
  if (mySegs.target !== id && !stillToDo(id)) return;   // a done (or handed-off) segment can't be the target
  mySegs.target = mySegs.target === id ? null : id;
  if (mySegs.target && !isTracked(id)) mySegs.tracked.push(id);   // your target is always one of yours
  saveSegs();
  if (mySegs.target && joinDen(wasEmpty, id)) return;
  segmentsChanged(!(id in segEls));
}
// a segment from another den has to be drawn (or removed) with a full redraw; otherwise just restyle
function segmentsChanged(redraw) {
  const outside = (id) => denKey !== PACK && !DATA.dens.find((d) => d.key === denKey).segments.includes(id);
  if (redraw && mySegs.tracked.concat(Object.keys(segEls)).some(outside)) { const keep = { k, tx, ty }; draw(); ({ k, tx, ty } = keep); commit(); }
  else { styleSegments(); renderList(); }
  renderBanner(); renderCard();
}

// map styling: once you track anything, the rest fades; the target and the selected segment get a halo
// once you track any segment, the others turn grey and their labels give way first (see declutter);
// tapping a grey segment shows it in colour while it's selected
function styleSegments() {
  if (leader) { leaderStyle(); return; }
  if (dispatch) { dispatchStyle(); return; }
  const any = mySegs.tracked.length > 0;
  for (const id in segEls) {
    const e = segEls[id];
    e.faded = any && !isTracked(id) && id !== selected;
    for (const [part, attr, colour, grey] of e.paint) part.setAttribute(attr, e.faded ? grey : colour);
    // done: faint line, houses and labels; the tag turns pale with dark text and a green ✔
    const crossed = mySegs.covered.includes(id);           // handed off: grey and crossed out
    if (crossed) for (const [part, attr, , grey] of e.paint) part.setAttribute(attr, grey);
    const done = mySegs.done.includes(id) || crossed;
    e.route.setAttribute("opacity", done ? 0.3 : e.faded ? 0.8 : 0.9);
    e.homes.setAttribute("opacity", done ? 0.35 : 1);
    for (const g of e.extras) g.setAttribute("opacity", done && g.kind !== "tag" ? 0.35 : 1);
    if (e.tagText) {
      const w = e.tagW[done && !crossed ? 1 : 0];
      e.tagText.textContent = e.tagLabel;
      e.tagText.style.fill = done ? "#333" : "";
      e.tagText.style.textDecoration = crossed ? "line-through" : "";
      if (crossed) e.tagBox.setAttribute("fill", "#e6e6e6");
      else if (done) {
        const tick = document.createElementNS(NS, "tspan");
        tick.textContent = " \u2714\ufe0e";
        tick.style.fill = "#1e7e34";
        e.tagText.appendChild(tick);
        e.tagBox.setAttribute("fill", tint(e.faded ? "#9a9a9a" : e.color, 0.3));
      }
      e.tagBox.setAttribute("x", -w / 2); e.tagBox.setAttribute("width", w);
    }
    const picked = cover && cover.has(id);                  // picked for "needs coverage": a strong dark glow
    const glow = picked || id === mySegs.target || id === selected;   // otherwise a soft glow in the segment's own colour
    e.halo.style.display = glow ? "" : "none";
    if (picked) { e.halo.setAttribute("stroke", "#111"); e.halo.setAttribute("stroke-opacity", 0.55); }
    else if (glow) { e.halo.setAttribute("stroke", e.color); e.halo.setAttribute("stroke-opacity", id === mySegs.target ? 0.45 : 0.3); }
  }
  const t = mySegs.target && segEls[mySegs.target];
  ants.style.display = t ? "" : "none";
  if (t) ants.setAttribute("d", t.d);
  // the ants layer is above the whole map, so copy the target's ID tag and start arrow on top of the dashes
  for (const [, copy] of fxCopies) copy.remove();
  fxCopies = t ? t.extras.filter((g) => g.kind === "tag" || g.kind === "arrow").map((g) => [g, fxView.insertBefore(g.cloneNode(true), me.g.parentNode === fxView ? me.g : null)]) : [];
  syncFxCopies();
  if (bbox) { placedK = 0; commit(); }   // relabel: which labels show depends on what's grey
}

function segBox(s) {
  const pts = DATA.houses.filter((h) => h.seg === s.id).map((h) => P(h.lonlat))
    .concat([s.route, ...s.route_parts].flat().map(P));
  return [Math.min(...pts.map((p) => p[0])) - 40, Math.min(...pts.map((p) => p[1])) - 40,
          Math.max(...pts.map((p) => p[0])) + 40, Math.max(...pts.map((p) => p[1])) + 40];
}

function select(id, zoom) {
  selected = id; place = null;
  const s = id && segById(id);
  if (s && !(id in segEls)) { pick(s.den); }      // on another den's map: switch to that den
  styleSegments(); renderCard();
  if (s && zoom) fitBox(segBox(s));
}

// The target's "marching ants": white dashes that step along its line in walking order. They live in
// their own SVG layer (#fx) so only that thin layer redraws, about 10 times a second.
const ANT_DASH = 6, ANT_GAP = 10, ANT_STEPS = 10;   // screen px; steps per second
const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const antAnim = calm ? null : el("animate", { attributeName: "stroke-dashoffset", dur: "1s",
  repeatCount: "indefinite", calcMode: "discrete" }, ants);
let fxCopies = [];                       // [original label, its copy on the ants layer]
function syncFxCopies() {
  for (const [g, copy] of fxCopies) {
    copy.setAttribute("transform", g.getAttribute("transform") || "");
    copy.style.display = g.style.display;
  }
}
function sizeAnts() {                    // dash sizes are in map units, so they follow the zoom
  const u = 1 / k, period = (ANT_DASH + ANT_GAP) * u;
  ants.setAttribute("stroke-width", 3 * u);
  ants.setAttribute("stroke-dasharray", `${ANT_DASH * u} ${ANT_GAP * u}`);
  if (antAnim) antAnim.setAttribute("values",
    Array.from({ length: ANT_STEPS }, (_, i) => f1(-period * i / ANT_STEPS * 100) / 100).join(";"));
}

// one tap on the map: the nearest segment line or ID tag within about 22 px
let place = null;                        // a landmark whose card is open (Sappington Elementary, Fire Station 5)
function tapAt(p) {
  const x = (p.x - tx) / k, y = (p.y - ty) / k, reach = 22 / k;
  // a landmark's badge (about 14 px round): its card, with the full name, address and directions
  if (!leader && !cover) {
    const lm = DATA.landmarks.find((m) => m.full && dist(P(m.lonlat), [x, y]) < 18 / k);
    if (lm) { selected = null; place = lm; styleSegments(); renderCard(); return; }
  }
  let best = null, bestD = reach;
  for (const id in segEls) {
    const e = segEls[id];
    if (e.tag && dist(e.tag, [x, y]) < bestD + 6 / k) { best = id; bestD = dist(e.tag, [x, y]) - 6 / k; }
    for (const r of e.routes) for (let i = 1; i < r.length; i++) {
      const d = segDist([x, y], r[i - 1], r[i]);
      if (d < bestD) { best = id; bestD = d; }
    }
  }
  if (leader) { if (best) assignGroup(best); return; }
  if (dispatch) { if (best) dispatchSelect(best, true); return; }
  if (cover) { if (best) { if (cover.has(best)) cover.delete(best); else cover.add(best); styleSegments(); renderCover(); } return; }
  if (best) select(best, false);
  else if (selected) select(null);
}
function segDist(p, a, b) {               // distance from p to the line piece a-b
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

// the two per-segment controls, the same in the list and on the card: a target radio on the left
// (only one segment is the target; tap it again to clear) and a track star on the right
function targetRadio(s, parent, before, label) {
  const on = mySegs.target === s.id;
  const b = h("button", "radio" + (on ? " on" : "") + (label ? " labeled" : ""), null, null);
  if (label) h("span", "", "Target", b);   // on the card a lone radio needs saying what it is
  b.type = "button";
  b.setAttribute("role", "radio"); b.setAttribute("aria-checked", on);
  b.setAttribute("aria-label", (on ? "Target: " : "Make target: ") + s.id);
  b.title = on ? "Your target \u2013 tap to clear" : "Make this your target";
  b.disabled = !on && !stillToDo(s.id);   // done: nothing left to walk there (undo Done first)
  parent.insertBefore(b, before || null);
  return b;
}
function trackStar(s, parent) {
  const on = isTracked(s.id);
  const b = h("button", "star" + (on ? " on" : ""), on ? "\u2605" : "\u2606", parent);
  b.type = "button";
  b.setAttribute("aria-label", (on ? "Stop tracking " : "Track ") + s.id);
  b.setAttribute("aria-pressed", on);
  if (on && mySegs.done.includes(s.id)) {   // a done segment stays yours (it counts in your progress)
    b.disabled = true;
    b.title = "Done segments stay in your list. Undo Done first to remove it.";
  }
  return b;
}

// small DOM helper for the list, card and banner
function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function chip(s, parent) {
  const c = h("span", "chip" + (s.main_road ? " main" : ""), s.id + (s.main_road ? " \u26a0" : ""), parent);
  c.style.background = (segEls[s.id] && segEls[s.id].color) || s.color;
  return c;
}
function linesOf(s, parent, all) {
  const box = h("div", "lines", null, parent);
  for (const ln of all ? s.lines : s.lines.filter((l) => !l.warning).slice(0, 2)) {
    const row = h("div", ln.warning ? "warn" : "", null, box);
    h("span", "street", ln.text, row);
    if (ln.numbers) h("span", "nums", " " + ln.numbers, row);
  }
  return box;
}

// Panels slide up from the bottom and back down (see .open in app.css). [hidden] is set once a panel
// has slid away, so it's gone for screen readers and taps; a panel reopened mid-slide just turns around.
function slideIn(panel) {
  if (panel.classList.contains("open")) return;
  panel.hidden = false;
  panel.getBoundingClientRect();         // lay it out off-screen first, so the slide has somewhere to start
  panel.classList.add("open");
}
function slideOut(panel) {
  if (!panel.classList.contains("open")) return;
  panel.classList.remove("open");
  const done = () => { if (!panel.classList.contains("open")) panel.hidden = true; };
  if (getComputedStyle(panel).transitionDuration === "0s") done();
  else panel.addEventListener("transitionend", done, { once: true });
}

// ---------- Week 2: a tally of bags for each segment, counted as you go ----------
const bagWord = (n) => n + (n === 1 ? " bag" : " bags");
function setBags(id, n) {
  n = Math.max(0, Math.min(999, Math.round(Number(n) || 0)));
  if (n) bags[id] = n; else delete bags[id];
  saveSegs(); renderBanner(); if (!sheet.hidden) renderList();
  return n;
}
// Bags  [ − ]  12  [ + ]   — the count can also be typed
function bagRow(s, parent) {
  const row = h("div", "bag-row", null, parent);
  h("span", "lbl", "Bags", row);
  const minus = h("button", "step", "\u2212", row); minus.type = "button"; minus.setAttribute("aria-label", "One bag fewer");
  const box = h("input", "bag-count", null, row);
  Object.assign(box, { type: "text", inputMode: "numeric", pattern: "[0-9]*", autocomplete: "off", value: String(bags[s.id] || 0) });
  box.setAttribute("aria-label", `Bags from ${s.id}`);
  const plus = h("button", "step", "+", row); plus.type = "button"; plus.setAttribute("aria-label", "One more bag");
  const show = (n) => { box.value = String(n); minus.disabled = n <= 0; };
  show(bags[s.id] || 0);
  minus.addEventListener("click", () => show(setBags(s.id, (bags[s.id] || 0) - 1)));
  plus.addEventListener("click", () => show(setBags(s.id, (bags[s.id] || 0) + 1)));
  box.addEventListener("focus", () => box.select());
  box.addEventListener("change", () => show(setBags(s.id, box.value.replace(/\D/g, ""))));
}
// Done with no tally: ask roughly how many bags before texting. A number box, and Skip.
function askBags(id) {
  availPanel.textContent = "";
  const top = h("div", "card-top", null, availPanel);
  h("h2", "", `${id} done`, top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Cancel");
  x.addEventListener("click", () => slideOut(availPanel));
  h("p", "avail-q", "About how many bags of food?", availPanel);
  const row = h("div", "card-texts", null, availPanel);
  const box = h("input", "bag-ask", null, row);
  Object.assign(box, { type: "text", inputMode: "numeric", pattern: "[0-9]*", autocomplete: "off", placeholder: "0" });
  box.setAttribute("aria-label", "About how many bags of food");
  const send = h("button", "", "Send", row); send.type = "button"; msgIcon(send);
  const skip = h("button", "", "Skip", row); skip.type = "button"; msgIcon(skip);
  const go = (n) => { slideOut(availPanel); if (n) setBags(id, n); finishSegment(id); };
  send.addEventListener("click", () => go(box.value.replace(/\D/g, "")));
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") go(box.value.replace(/\D/g, "")); });
  skip.addEventListener("click", () => go(0));
  closeSheet();
  slideIn(availPanel);
}
function finishSegment(id) {             // marks done either way; texts too when texting is set up
  if (pass2) {                           // second pass: a text only when there are new bags
    const more = (bags[id] || 0) - (pass2.start[id] || 0);
    if (more > 0 && textsReady()) sendText("pass2", id, more);
    markDone(id, true);
    return;
  }
  if (textsReady()) sendText("done", id);
  markDone(id, true);
}
function startPass2() {
  pass2 = { firstDone: mySegs.done.slice(), start: { ...bags } };
  mySegs.done = []; mySegs.target = null;
  autoTarget(); nearestTarget();
  if (!mySegs.target) mySegs.target = cycleList().length ? cycleList()[0].id : null;
  saveSegs(); slideOut(availPanel); segmentsChanged(false);
  if (mySegs.target && !me.following) fitBox(segBox(segById(mySegs.target)));
}

// a landmark's card: full name, address and a Directions link
function renderPlace() {
  slideIn(card);
  card.textContent = "";
  const top = h("div", "card-top place-top", null, card);
  h("h2", "place-name", place.full, top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => { place = null; renderCard(); });
  if (place.note) h("p", "place-note", place.note, card);
  const row = h("div", "card-den", place.address, card);
  const go = h("a", "directions", "Directions \u203a", row);
  directionsTo(go, place.address || place.lonlat);
  go.setAttribute("aria-label", "Driving directions to " + place.full);
  document.body.style.setProperty("--card-h", card.getBoundingClientRect().height + "px");
}
// the card for one segment: all its lines and the Track / Target buttons
function renderCard() {
  const s = selected && segById(selected);
  document.body.classList.toggle("card-open", !!(s || place));
  if (!s && place) { renderPlace(); return; }
  if (!s) { slideOut(card); return; }    // keep its content while it slides away
  slideIn(card);
  card.textContent = "";
  // top row, like a row of the segment list: target radio, ID, then the track star and close
  const top = h("div", "card-top", null, card);
  const rd = targetRadio(s, top);
  rd.addEventListener("click", () => setTarget(s.id));
  chip(s, top);
  h("span", "card-gap", null, top);
  const st = trackStar(s, top);
  st.addEventListener("click", () => setTracked(s.id, !isTracked(s.id)));
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => select(null));
  linesOf(s, card, true);
  const cd = h("div", "card-den", `${denOf(s).short} \u2022 ${s.houses} houses`, card);
  // Directions to where the walk starts, in the phone's own maps app (for a far-off segment, or the first one)
  const go = h("a", "directions", "Directions \u203a", cd);
  directionsTo(go, s.route[0]);
  go.setAttribute("aria-label", `Driving directions to the start of ${s.id}`);
  // texts to the dispatcher about this segment. Done is offered on your target (and Undo on a done one);
  // Needs coverage and Need bags only work once texting is set up, so they're greyed out until then.
  if (mySegs.covered.includes(s.id)) {   // handed off with a "needs coverage" text: put it back if plans change
    const row = h("div", "covered-row", null, card);
    h("span", "", "Coverage asked \u2013 someone else is doing this one.", row);
    const back = h("button", "share-btn", "We\u2019ll do it after all", row); back.type = "button";
    back.addEventListener("click", () => {
      mySegs.covered = mySegs.covered.filter((x) => x !== s.id);
      autoTarget(); saveSegs(); segmentsChanged(false);
    });
    document.body.style.setProperty("--card-h", card.getBoundingClientRect().height + "px");
    return;
  }
  if (tallying()) bagRow(s, card);
  const texts = h("div", "card-texts", null, card);
  const isDone = mySegs.done.includes(s.id);
  if (isDone || mySegs.target === s.id) {
    const auto = settings.autoText;      // off: Done only marks it, and Text done sends the text
    const dn = h("button", "done" + (isDone ? " on" : ""), isDone ? "\u2714\ufe0e Done \u2013 undo" : "\u2714\ufe0e Done", texts);
    dn.type = "button";
    if (!isDone && auto) msgIcon(dn);
    dn.addEventListener("click", () => {
      if (isDone) markDone(s.id, false);   // undo: no text
      else if (!auto) markDone(s.id, true);
      else if (tallying() && textsReady() && !bags[s.id] && !pass2) askBags(s.id);   // no tally: ask roughly how many
      else finishSegment(s.id);
    });
    if (!auto) {
      const td = h("button", "", "Text done", texts); td.type = "button"; msgIcon(td);
      td.disabled = !textsReady();
      td.addEventListener("click", () => {
        if (isDone) sendText("done", s.id);                                  // already marked: just the text
        else if (tallying() && !bags[s.id] && !pass2) askBags(s.id);
        else finishSegment(s.id);
      });
    }
  }
  const textBtn = (label, kind, cls) => {
    const b = h("button", cls || "", label, texts); b.type = "button"; msgIcon(b);
    b.disabled = !textsReady();
    b.addEventListener("click", () => sendText(kind, s.id));
  };
  if (week() !== 2) textBtn("Need bags", "bags");   // bags only go out in Week 1
  document.body.style.setProperty("--card-h", card.getBoundingClientRect().height + "px");
}

// the banner: your target segment, tap to go to it
// the banner: your target segment (tap to go to it), or a faint prompt to pick one (tap to open the list)
function renderBanner() {
  const s = mySegs.target && segById(mySegs.target);
  banner.hidden = false;
  banner.classList.toggle("empty", !s);
  banner.classList.remove("alldone");
  banner.textContent = "";
  const box = h("span", "content", null, banner);   // slides sideways on a swipe; the frame and dots stay put
  const row = h("span", "row", null, box);
  if (s) {
    h("span", "label", pass2 ? "2nd pass" : "Target", row);
    chip(s, row);
    const first = s.lines.find((l) => !l.warning);
    h("span", "what", first ? first.text : "", row);
    const n = h("span", "hses", "\u25c9 " + s.houses, row);           // ◉ the target's houses
    n.setAttribute("aria-label", s.houses + (s.houses === 1 ? " house" : " houses") + " on target");
  } else if (allDone()) {
    banner.classList.add("alldone");
    if (week() === 2) h("span", "what", pass2 ? "\u2714\ufe0e 2nd pass done \u2013 tap for drop-off" : "\u2714\ufe0e All done \u2013 tap for drop-off", row);
    else { h("span", "what", "\u2714\ufe0e All done \u2013 tap to text \u201cavailable\u201d", row); msgIcon(row); }
  } else {
    h("span", "what", "No target \u2013 tap to pick one", row);
  }
  // progress: houses on your tracked segments that are done, out of all your tracked houses
  const mine = mySegs.tracked.filter((id) => !mySegs.covered.includes(id)).map(segById);   // handed-off ones don't count
  if (!mine.length) return;
  const total = mine.reduce((t, x) => t + x.houses, 0);
  const done = mine.filter((x) => mySegs.done.includes(x.id)).reduce((t, x) => t + x.houses, 0);
  const prog = h("span", "progress", null, box);
  const bar = h("span", "bar", null, prog);
  const fill = h("span", "fill", null, bar);
  fill.style.width = (total ? (100 * done) / total : 0) + "%";
  if (s) {
    const col = (segEls[s.id] && segEls[s.id].color) || s.color;
    fill.style.background = col;
    if (isTracked(s.id) && !mySegs.done.includes(s.id)) {   // the target's share, pale, just after what's done
      const next = h("span", "next", null, bar);
      next.style.width = (100 * s.houses) / total + "%";
      next.style.background = tint(col, 0.35);
    }
  }
  const count = h("span", "count", `\u2714\ufe0e ${done} of ${total}`, prog);   // ✔ heavy check, as text, not an emoji
  const bagTotal = tallying() ? mine.reduce((t, x) => t + (bags[x.id] || 0), 0) : 0;
  if (bagTotal) h("span", "bag-total", bagWord(bagTotal), prog);
  count.setAttribute("aria-label", `${done} of ${total} houses done`);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", 0); bar.setAttribute("aria-valuemax", total); bar.setAttribute("aria-valuenow", done);
  // a dot per unfinished segment of yours, in its colour; the target's dot is bigger. Swipe to change.
  const left = cycleList();
  if (left.length > 1) {
    const dots = h("span", "dots", null, banner);
    dots.setAttribute("aria-hidden", "true");
    for (const x of left) {
      const d = h("span", "dot" + (x.id === mySegs.target ? " on" : ""), null, dots);
      d.style.background = (segEls[x.id] && segEls[x.id].color) || x.color;
    }
  }
}

// ---------- swipe the banner to change target ----------
// Left = next of your unfinished segments, right = previous (wrapping). Inside the banner's frame the
// content follows your finger, slides out, and the new target slides in from the other side (the dots stay
// put). An open card follows the new target; the map glides to it unless Center on me is following you.
// Swipe order: around the shortest loop through your segments, so each swipe goes to a neighbour on the ground
// (and wrapping from the last back to the first does too). Worked out once for all your tracked segments, done
// ones included, so it doesn't reshuffle as you go; done ones are skipped. Starts at your lowest-numbered one.
let loopCache = { key: "", order: [] };
function loopOrder() {
  const key = mySegs.tracked.slice().sort().join(",");
  if (loopCache.key === key) return loopCache.order;
  const segs = mySegs.tracked.map(segById).sort(segOrder), n = segs.length;
  const pts = segs.map((s) => s.route.map(P));
  const D = segs.map((_, i) => segs.map((_, j) => {              // closest approach of the two streets
    if (i === j) return 0;
    let m = Infinity;
    for (const p of pts[i]) for (const q of pts[j]) { const d = dist(p, q); if (d < m) m = d; }
    return m;
  }));
  // nearest neighbour from the first, then 2-opt: reverse a stretch while that shortens the loop
  const tour = [0], left = new Set(segs.map((_, i) => i).slice(1));
  while (left.size) {
    const cur = tour[tour.length - 1]; let nb = -1, bd = Infinity;
    for (const j of left) if (D[cur][j] < bd) { bd = D[cur][j]; nb = j; }
    tour.push(nb); left.delete(nb);
  }
  for (let improved = true, pass = 0; improved && pass < 50 && n > 3; pass++) {
    improved = false;
    for (let a = 0; a < n - 1; a++) for (let b = a + 2; b < n; b++) {
      const a2 = tour[a + 1], b2 = tour[(b + 1) % n];
      if (b2 === tour[a]) continue;
      if (D[tour[a]][tour[b]] + D[a2][b2] < D[tour[a]][a2] + D[tour[b]][b2] - 1e-6) {
        tour.splice(a + 1, b - a, ...tour.slice(a + 1, b + 1).reverse()); improved = true;
      }
    }
  }
  loopCache = { key, order: tour.map((i) => segs[i].id) };
  return loopCache.order;
}
const cycleList = () => loopOrder().map(segById).filter((x) => stillToDo(x.id));
let swipe = null, swiped = false;
const bannerBox = () => banner.querySelector(".content");
function cycleTarget(dir) {
  const left = cycleList();
  if (!left.length) return;
  const i = left.findIndex((x) => x.id === mySegs.target);
  const next = left[i < 0 ? (dir > 0 ? 0 : left.length - 1) : (i + dir + left.length) % left.length];
  mySegs.target = next.id; saveSegs();
  if (selected) select(next.id, false);  // the open card moves with the target
  segmentsChanged(false);
  const box = bannerBox();               // the new content comes in from the side it's swiped from
  if (box && !calm) {
    box.style.transition = "none";
    box.style.transform = `translateX(${dir > 0 ? 100 : -100}%)`;
    void box.offsetWidth;
    box.style.transition = "transform .2s ease-out";
    box.style.transform = "";
  }
  if (!me.following) fitBox(segBox(next));
}
{
  banner.addEventListener("pointerdown", (e) => { swipe = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false }; swiped = false; });
  banner.addEventListener("pointermove", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.on && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) { swipe.on = true; banner.setPointerCapture(e.pointerId); }
    const box = bannerBox();
    if (swipe.on && box) { box.style.transition = "none"; box.style.transform = `translateX(${dx}px)`; }
  });
  const end = (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, on = swipe.on, box = bannerBox();
    swipe = null;
    if (!on) return;
    swiped = true;
    if (Math.abs(dx) > 50 && cycleList().length > 1) {
      const dir = dx < 0 ? 1 : -1;
      if (box && !calm) {                // finish sliding the old one out, then bring the new one in
        box.style.transition = "transform .12s ease-in";
        box.style.transform = `translateX(${dir > 0 ? -100 : 100}%)`;
        setTimeout(() => cycleTarget(dir), 120);
      } else cycleTarget(dir);
    } else if (box) {                    // not far enough: spring back
      box.style.transition = "transform .15s ease-out";
      box.style.transform = "";
    }
  };
  banner.addEventListener("pointerup", end);
  banner.addEventListener("pointercancel", end);
}
banner.addEventListener("click", () => {
  if (swiped) { swiped = false; return; }   // the end of a swipe isn't a tap
  if (mySegs.target) select(mySegs.target, true);
  else if (allDone()) askAvailable();
  else openSheet();
});
// "available for more": you've finished, so let go of the last segment (close its card, no target)
function sendAvailable(extra) {
  if (!sendText("available", null, extra)) return;
  mySegs.target = null; saveSegs();
  closeSheet(); slideOut(availPanel);
  if (selected) select(null); else segmentsChanged(false);
}
// In Week 1 (bags) the dispatcher also needs to know how many bags you have left, so "available" asks
// first: none, a few or plenty. In Week 2 (pickup) it texts straight away.
const availPanel = document.getElementById("avail");
function askAvailable() {
  if (week() !== 1) { allDoneWeek2(); return; }
  if (!textsReady()) { sendText("available"); return; }   // opens Settings to fill in what's missing
  availPanel.textContent = "";
  const top = h("div", "card-top", null, availPanel);
  h("h2", "", "You\u2019re all done!", top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => slideOut(availPanel));
  h("p", "avail-q", "Text the dispatcher you\u2019re available. How many bags do you have left?", availPanel);
  const row = h("div", "card-texts", null, availPanel);
  for (const [label, extra] of [["None", "no bags left"], ["A few", "a few bags left"], ["Plenty", "plenty of bags left"]]) {
    const b = h("button", "", label, row); b.type = "button"; msgIcon(b);
    b.addEventListener("click", () => sendAvailable(extra));
  }
  closeSheet();
  slideIn(availPanel);
}
// ---------- needs coverage: tap segments on the map, then one text ----------
// From the dispatcher panel. While it's open, a tap on the map picks or unpicks a segment instead of opening
// its card; the picked ones get a dark glow. The text reads "Wk2: Wolf A – W9, W11 need coverage".
let cover = null;                        // a Set of picked segment ids while picking
const coverPanel = document.getElementById("cover");
function startCover() {
  slideOut(contactPanel); closeSheet(); slideOut(availPanel);
  if (selected) select(null);
  cover = new Set();
  document.body.classList.add("covering");
  styleSegments(); renderCover();
  slideIn(coverPanel);
}
function endCover() {
  cover = null;
  document.body.classList.remove("covering");
  slideOut(coverPanel); styleSegments();
}
function renderCover() {
  coverPanel.textContent = "";
  const top = h("div", "card-top", null, coverPanel);
  h("h2", "", "Needs coverage", top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Cancel");
  x.addEventListener("click", endCover);
  h("p", "hint", "Tap the segments on the map your group can\u2019t get to. Tap one again to unpick it. Once texted, they\u2019re crossed out on your list.", coverPanel);
  const ids = [...cover].sort((a, b) => segOrder(segById(a), segById(b)));
  const picked = h("p", "cov-picked", null, coverPanel);
  if (ids.length) for (const id of ids) chip(segById(id), picked);
  else picked.textContent = "None picked yet.";
  const send = h("button", "cov-send", ids.length ? `Text: ${ids.join(", ")} ${ids.length > 1 ? "need" : "needs"} coverage` : "Text \u201cneeds coverage\u201d", coverPanel);
  send.type = "button"; msgIcon(send);
  send.disabled = !ids.length;
  send.addEventListener("click", () => {
    if (!sendText("coverage", ids.join(", "))) return;
    // someone else will cover them: crossed out on your list (not ones already done), and put back from their card
    const asked = ids.filter((id) => isTracked(id) && !mySegs.done.includes(id) && !mySegs.covered.includes(id));
    if (asked.length) {
      mySegs.covered.push(...asked);
      if (asked.includes(mySegs.target)) { mySegs.target = null; autoTarget(); nearestTarget(); }
      saveSegs(); segmentsChanged(false);
    }
    endCover();
  });
}

// Driving directions in the phone's own maps app: Apple Maps on iPhone, Google Maps elsewhere.
// Only the place (coordinates or a landmark's address) goes in the link, with no referrer, so the #tel=…
// fragment never leaves the page.
function directionsTo(a, to) {           // to: [lon, lat], or a street address
  const dest = typeof to === "string" ? encodeURIComponent(to) : `${to[1]},${to[0]}`;
  a.href = isIOS() ? `https://maps.apple.com/?daddr=${dest}&dirflg=d`
                   : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  a.rel = "noreferrer"; a.target = "_blank";
}
// Week 2, all done: take the bags to Fire Station 5 (directions), and text that you're available to help.
let headingSent = false;                 // "heading to Fire Station 5" texted this visit: Directions just opens maps
function allDoneWeek2() {
  const fire = DATA.landmarks.find((lm) => lm.icon === "fire");
  availPanel.textContent = "";
  const top = h("div", "card-top", null, availPanel);
  h("h2", "", pass2 ? "Second pass done!" : "You\u2019re all done!", top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => slideOut(availPanel));
  h("p", "avail-q", "Offer to help with more segments, or take the bags of food to Fire Station 5 when you\u2019re finished, or whenever the car fills up.", availPanel);
  if (!pass2) {                          // first, optionally: drive your segments again for bags put out late
    const p2 = h("button", "pass2-btn", "Optional second pass: drive your segments again", availPanel); p2.type = "button";
    p2.addEventListener("click", startPass2);
  }
  const row = h("div", "card-texts", null, availPanel);
  // heading to the drop-off texts the dispatcher too, like Done: with auto-text on, one tap texts first and then
  // offers the directions (a phone can't open Messages and Maps from one tap); off, two buttons
  const go = h("a", "dir-btn", headingSent ? "Open directions \u203a" : "Directions \u203a", row);
  directionsTo(go, fire.address || fire.lonlat);
  go.setAttribute("aria-label", "Driving directions to Fire Station 5");
  if (settings.autoText && !headingSent && textsReady()) {
    msgIcon(go);
    go.addEventListener("click", (e) => {
      e.preventDefault();
      sendText("heading"); headingSent = true;
      allDoneWeek2();                    // back from Messages: the button opens the directions
    });
  } else if (!settings.autoText) {
    const hd = h("button", "", "Text heading there", row); hd.type = "button"; msgIcon(hd);
    hd.disabled = !textsReady();
    hd.addEventListener("click", () => sendText("heading"));
  }
  const tx = h("button", "", "Available to help", row); tx.type = "button"; msgIcon(tx);
  tx.addEventListener("click", () => sendAvailable());   // opens Settings if texting isn't set up yet
  closeSheet();
  slideIn(availPanel);
}
// ---------- the dispatcher: a general text or a call ----------
// The round button with a speech bubble and handset. A text starts with "Wk1: Wolf A – " so the
// dispatcher knows who it is; the parent types the rest. Calling is for anything urgent.
const callBtn = document.getElementById("call-btn");
const contactPanel = document.getElementById("contact");
const BUBBLE = "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z";
const HANDSET = "M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z";
function icon(paths, size) {
  const svgEl = document.createElementNS(NS, "svg");
  for (const [k_, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true" })) svgEl.setAttribute(k_, v);
  for (const p of paths) el("path", p, svgEl);
  return svgEl;
}
function renderCallBtn() {
  callBtn.textContent = "";
  const on = !!settings.tel;
  callBtn.classList.toggle("off", !on);
  const paths = [{ d: BUBBLE, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" },
                 { d: HANDSET, fill: "currentColor", transform: "translate(7.2 6.2) scale(.42)" }];
  if (!on) paths.push({ d: "M3 3l18 18", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round" });
  callBtn.appendChild(icon(paths, 28));
  callBtn.title = on ? "Text or call the dispatcher" : "Add the dispatcher\u2019s number in Settings to text or call";
}
function openContact() {
  if (!settings.tel) { openSettings("To text or call the dispatcher, add their number."); return; }
  contactPanel.textContent = "";
  const top = h("div", "card-top", null, contactPanel);
  h("h2", "", "Dispatcher", top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => slideOut(contactPanel));
  h("p", "contact-tel", showTel(settings.tel), contactPanel);
  const row = h("div", "contact-row", null, contactPanel);
  const tx = h("button", "text", null, row); tx.type = "button";
  tx.appendChild(icon([{ d: BUBBLE, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" }], 22));
  h("span", "", "Text", tx);
  tx.addEventListener("click", () => {
    const who = `Wk${week()}:` + (settings.group ? ` ${settings.group} \u2013 ` : " ");
    slideOut(contactPanel); openSms(smsHref(who));
  });
  const cl = h("button", "call", null, row); cl.type = "button";
  cl.appendChild(icon([{ d: HANDSET, fill: "currentColor" }], 22));
  h("span", "", "Call", cl);
  cl.addEventListener("click", () => { slideOut(contactPanel); openSms("tel:" + settings.tel); });
  // Needs coverage: a panel that has you tap the segments on the map, then texts them in one go
  const cov = h("button", "cov-open", "Needs coverage\u2026", contactPanel); cov.type = "button"; msgIcon(cov);
  cov.addEventListener("click", startCover);
  closeSheet(); slideOut(availPanel);
  slideIn(contactPanel);
}
callBtn.addEventListener("click", openContact);

const allDone = () => mySegs.tracked.some((id) => mySegs.done.includes(id)) && !mySegs.tracked.some(stillToDo);

// the list: yours first, then the den's (or every den's, in the whole-pack view)
// the list has two tabs: Segments (the den's, or every den's in the pack view) and Mine (tracked ones)
let listTab = null;                      // "all" or "mine"; null until the panel is first opened
let listAnchor = null;                   // {id, top}: the row just tapped, kept still on screen
function renderList() {
  const body = document.getElementById("sheet-body");
  const keepScroll = body.scrollTop;
  body.textContent = "";
  const pack = denKey === PACK;
  const den = !pack && DATA.dens.find((d) => d.key === denKey);
  const tabAll = document.getElementById("tab-all"), tabMine = document.getElementById("tab-mine");
  tabAll.textContent = "Segments";
  tabMine.textContent = `Mine (${mySegs.tracked.length})`;
  for (const [b, on] of [[tabAll, listTab !== "mine"], [tabMine, listTab === "mine"]]) {
    b.classList.toggle("on", on); b.setAttribute("aria-selected", on);
  }
  const groups = [];
  if (listTab === "mine") {
    addForm(body);
    const mine = mySegs.tracked.map(segById).sort(segOrder);
    if (!mine.length) {
      h("p", "empty", "No segments yet. On the Segments tab, tap \u2606 on the ones your group was given.", body);
    } else {                             // the total for your group
      const n = mine.reduce((t, x) => t + x.houses, 0);
      const b = tallying() ? mine.reduce((t, x) => t + (bags[x.id] || 0), 0) : 0;
      h("p", "total", `${mine.length} segment${mine.length === 1 ? "" : "s"} \u2022 ${n} house${n === 1 ? "" : "s"}` +
        (b ? ` \u2022 ${bagWord(b)}` : ""), body);
      // "available for more" is for when you've finished: greyed out until every tracked segment is done
      const wk2 = week() === 2;   // Week 2: the drop-off and "available to help" panel
      const av = h("button", "available", wk2 ? "Bag drop-off & \u201cavailable to help\u201d" : "Text \u201cavailable for more\u201d", body);
      av.type = "button"; if (!wk2) msgIcon(av);
      av.disabled = !allDone() || (!wk2 && !textsReady());
      av.addEventListener("click", askAvailable);
      if (!allDone()) h("p", "available-note", "Once all your segments are done", body);
    }
    groups.push(["", mine]);
  } else if (pack) for (const d of DATA.dens) groups.push([d.short, d.segments.map(segById)]);
  else groups.push(["", den.segments.map(segById)]);
  for (const [title, list] of groups) {
    if (title) h("h3", "", title, body);
    for (const s of list) {
      const row = h("div", "seg-row" + (mySegs.target === s.id ? " is-target" : ""), null, body);
      row.dataset.id = s.id;
      const main = h("button", "seg-main", null, row); main.type = "button";
      chip(s, main);
      linesOf(s, main, false);
      const meta = h("span", "meta", s.houses + (s.houses === 1 ? " house" : " houses"), main);
      if (s.den !== denKey && denKey !== PACK) meta.textContent += " \u2022 " + denOf(s).short;
      if (tallying() && bags[s.id]) meta.textContent += " \u2022 " + bagWord(bags[s.id]);
      if (mySegs.target === s.id) h("span", "badge", "Target", meta);
      if (mySegs.done.includes(s.id)) { row.classList.add("is-done"); h("span", "badge done", "\u2714\ufe0e Done", meta); }
      else if (mySegs.covered.includes(s.id)) { row.classList.add("is-covered"); h("span", "badge covered", "Coverage asked", meta); }
      main.addEventListener("click", () => { closeSheet(); select(s.id, true); });
      const radio = targetRadio(s, row, main);
      radio.addEventListener("click", () => {
        listAnchor = { id: s.id, top: row.getBoundingClientRect().top };
        setTarget(s.id);
      });
      const star = trackStar(s, row);
      star.addEventListener("click", () => {
        listAnchor = { id: s.id, top: row.getBoundingClientRect().top };
        setTracked(s.id, !isTracked(s.id));
      });
    }
  }
  body.scrollTop = keepScroll;           // a redraw keeps your place; the starred row stays where it was
  if (listAnchor) {
    const a = listAnchor; listAnchor = null;
    const same = body.querySelector(`.seg-row[data-id="${a.id}"]`);
    if (same) body.scrollTop += same.getBoundingClientRect().top - a.top;
  }
}
// "Add by ID": type the segment(s) the dispatcher sends you to, from any den
let addMsg = "";
function addForm(body) {
  const f = h("form", "add", null, body);
  const label = h("label", "", null, f);
  h("span", "add-label", "Add by ID", label);
  const input = h("input", "", null, label);
  Object.assign(input, { type: "text", placeholder: "e.g. B7 or B7, B8", autocomplete: "off", spellcheck: false });
  input.setAttribute("autocapitalize", "characters"); input.setAttribute("enterkeyhint", "done");
  const go = h("button", "", "Add", f); go.type = "submit";
  if (addMsg) h("p", "add-msg", addMsg, f);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const ids = [], bad = [];
    for (const raw of input.value.toUpperCase().split(/[\s,;]+/).filter(Boolean)) {
      const id = raw.replace(/^(M?)WB(?=\d)/, "$1WE");   // Webelos: people may type WB3 for WE3
      (segById(id) ? ids : bad).push(segById(id) ? id : raw);
    }
    addMsg = bad.length ? `No segment ${bad.join(", ")}` : "";
    if (!ids.length) { renderList(); return; }
    const wasEmpty = !mySegs.tracked.length;
    for (const id of ids) if (!isTracked(id)) mySegs.tracked.push(id);
    saveSegs();
    if (ids.length === 1 && !bad.length) {  // one segment: go straight to it on the map
      closeSheet();
      if (!joinDen(wasEmpty, ids[0])) segmentsChanged(true);
      select(ids[0], true);
    } else if (!joinDen(wasEmpty, ids[0])) { segmentsChanged(true); }
  });
}

function showTab(tab) {
  listTab = tab;
  try { sessionStorage.setItem("sff.listTab", tab); } catch (_) { /* ignore */ }
  document.getElementById("sheet-body").scrollTop = 0;
  renderList();
}
document.getElementById("tab-all").addEventListener("click", () => showTab("all"));
document.getElementById("tab-mine").addEventListener("click", () => showTab("mine"));
function openSheet() {
  if (!listTab) {                        // first time: the tab used last, else Mine if you have any
    try { listTab = sessionStorage.getItem("sff.listTab"); } catch (_) { /* ignore */ }
    if (!listTab) listTab = mySegs.tracked.length ? "mine" : "all";
  }
  slideIn(sheet);
  renderList();
}
function closeSheet() { slideOut(sheet); }
document.getElementById("segs-btn").addEventListener("click", openSheet);   // the list button, in the corner (the one you hit most)
document.getElementById("sheet-close").addEventListener("click", closeSheet);

// ---------- texts to the dispatcher ----------
// Each button opens the phone's own Messages app with the text written; the parent presses Send.
// Wording matches page 1 of the paper pack, with the week in front: "Wk1 Wolf A – W7 done".
const SINGULAR = { L: "Lion", T: "Tiger", W: "Wolf", B: "Bear", WB: "Webelos", A: "AOL" };
const SET_KEY = "sff.settings";
let settings = { tel: "", group: "", autoText: true };   // group: typed as people say it, e.g. "Wolf A"; autoText: Done texts too

// The 2026 walk: Week 1 (bags) is Saturday Nov 14, Week 2 (pickup) is Saturday Nov 21. The week comes
// from the date: Week 1 up to Nov 14, Week 2 after.
const WEEK_DAYS = { 1: "2026-11-14", 2: "2026-11-21" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// ?week=1 or ?week=2 in the address forces the week, for trying Week 2 early. A forced week keeps its done
// marks and bag tally apart ("test2"), so trying things out doesn't carry into the real week.
const WEEK_TEST = (() => { const v = new URLSearchParams(location.search).get("week"); return v === "1" || v === "2" ? Number(v) : null; })();
const week = () => WEEK_TEST || (today() <= WEEK_DAYS[1] ? 1 : 2);
const weekKey = () => (WEEK_TEST ? "test" + WEEK_TEST : week());   // where this week's done marks and bags are saved
function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
    if (!v.group && v.groupDen) v.group = SINGULAR[v.groupDen] + (v.letter ? " " + v.letter : "");   // older den + letter
    settings = { tel: v.tel || "", group: v.group || "", autoText: v.autoText !== false };
  } catch (_) { /* ignore */ }
}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ }
  syncLink();
}
// Keep the address in step with the saved number (…#tel=…), so Add to Home Screen from this page carries
// it even when it was typed in Settings rather than scanned. replaceState: no reload, no Back step.
function syncLink() {
  // the address keeps the number and a den QR code's den; a setup link's other parts are applied, then dropped
  const q = new URLSearchParams();
  if (settings.tel) q.set("tel", settings.tel.slice(2));
  const den = new URLSearchParams(location.hash.slice(1)).get("den");
  if (den) q.set("den", den);
  const frag = q.toString();
  if (frag === location.hash.slice(1)) return;
  history.replaceState(history.state, "", location.pathname + location.search + (frag ? "#" + frag : ""));
}
// a US mobile number as +1 and 10 digits, or null
function normTel(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? "+1" + d : null;
}
const showTel = (t) => t ? `(${t.slice(2, 5)}) ${t.slice(5, 8)}-${t.slice(8)}` : "";
const textsReady = () => !!(settings.tel && settings.group);

// The dispatcher's QR code opens the map with their number after the # (…/SFF/#tel=3145550123). The part
// after # never goes to the web server. The number is saved and left in the address on purpose, so a
// Home Screen icon added from this page keeps it (an iPhone Home Screen app doesn't share Safari's storage).
function readLink() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.has("lead")) {                   // a den leader's split, sent to Safari to print
    const t = normTel(q.get("tel"));
    if (t) { settings.tel = t; saveSettings(); }
    applyLeaderLink(q);
    return;
  }
  if (q.has("seg") || q.has("g")) { applySetup(q); return; }
  linkDen(q.get("den"));
  const t = normTel(q.get("tel"));
  if (!t || t === settings.tel) return;
  settings.tel = t;
  saveSettings();
}
// A den's QR code (…#tel=…&den=W) opens the map on that den. It only switches when the link names a den
// it hasn't switched to before, so re-opening a Home Screen icon doesn't undo a den picked since.
function linkDen(den) {
  if (!den || !(den === PACK || DATA.dens.some((d) => d.key === den))) return false;
  let last = null;
  try { last = localStorage.getItem("sff.linkDen"); } catch (_) { /* ignore */ }
  if (last === den) return false;
  try { localStorage.setItem("sff.linkDen", den); localStorage.setItem(STORE_KEY, den); } catch (_) { /* ignore */ }
  return true;
}
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  const full = /(^|&)(seg|g)=/.test(h);
  let before = null;
  try { before = localStorage.getItem("sff.linkDen"); } catch (_) { /* ignore */ }
  readLink();
  if (pendingLeader) { enterLeader(pendingLeader); pendingLeader = null; return; }
  let after = null;
  try { after = localStorage.getItem("sff.linkDen"); } catch (_) { /* ignore */ }
  if (full || after !== before) pick(localStorage.getItem(STORE_KEY) || denKey);   // a new den or a whole setup: redraw
  textingChanged();
});

// "Move my setup": everything this phone knows (number, group, den, segments, target, done) as one map
// link. Copy it here, paste it in the iPhone Home Screen app (which can't see Safari's storage) or send
// it to the other parent in your group. It never goes in the shared "Share the map" link.
function setupLink() {
  const q = new URLSearchParams();
  if (settings.tel) q.set("tel", settings.tel.slice(2));
  if (settings.group) q.set("g", settings.group);
  if (denKey) q.set("den", denKey);
  q.set("seg", mySegs.tracked.join(","));
  if (mySegs.target) q.set("t", mySegs.target);
  if (mySegs.done.length) { q.set("d", mySegs.done.join(",")); q.set("w", week()); }   // done marks belong to a week
  return new URL("./", location.href).href + "#" + q.toString().replace(/%2C/g, ",");
}
function applySetup(q) {                  // q: the parts after # of a setup link
  const ok = new Set(DATA.segments.map((s) => s.id));
  const ids = (v) => (v || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => ok.has(x));
  const t = normTel(q.get("tel"));
  if (t) settings.tel = t;
  if (q.has("g")) settings.group = q.get("g").trim().replace(/\s+/g, " ").slice(0, 24);
  saveSettings();
  if (q.has("seg")) {
    mySegs.tracked = ids(q.get("seg"));
    mySegs.target = mySegs.tracked.includes((q.get("t") || "").toUpperCase()) ? q.get("t").toUpperCase() : null;
    // done marks only count in the week they were made (links from before "w" existed were Week 1)
    const sameWeek = Number(q.get("w") || 1) === week();
    mySegs.done = sameWeek ? ids(q.get("d")).filter((x) => mySegs.tracked.includes(x)) : [];
    pass2 = null;                        // a new setup starts on a first pass
    autoTarget();
    saveSegs();
  }
  const den = q.get("den");
  if (den && (den === PACK || DATA.dens.some((d) => d.key === den))) {
    try { localStorage.setItem(STORE_KEY, den); } catch (_) { /* ignore */ }
  }
  return mySegs.tracked.length;
}
function textBody(kind, id, extra) {     // each text is built only when asked for (some have no segment)
  const who = `Wk${week()}: ${settings.group}`;
  const texts = {
    done: () => `${who} \u2013 ${id} done` + (tallying() && bags[id] ? `, ${bagWord(bags[id])}` : ""),
    coverage: () => `${who} \u2013 ${id} ${String(id).includes(",") ? "need" : "needs"} coverage`,
    bags: () => `${who} \u2013 send bags to ${id}${bagsWhere(id)}`,
    heading: () => `${who} heading to Fire Station 5`,
    pass2: () => `${who} \u2013 ${id} second pass, ${extra} more bag${extra === 1 ? "" : "s"}`,
    available: () => `${who} available` + (week() === 2 ? " to help" : "") + (extra ? ` \u2013 ${extra}` : ""),
  };
  return texts[kind]();
}
// iPhones want sms:NUMBER&body=…, Android sms:NUMBER?body=…
const smsHref = (body) => `sms:${settings.tel}${isIOS() ? "&" : "?"}body=${encodeURIComponent(body)}`;
// where bags should go: the segment's first street line, e.g. ", Fawnhaven Dr, N side"
function bagsWhere(id) {
  const s = id && segById(id);
  const line = s && s.lines.find((l) => !l.warning);
  return line ? ", " + line.text : "";
}
function sendText(kind, id, extra) {
  if (!textsReady()) {
    openSettings(settings.group ? "To text the dispatcher, add their number." : settings.tel ? "To text the dispatcher, add your group\u2019s name."
                                                                                 : "To text the dispatcher, add their number and your group\u2019s name.");
    return false;
  }
  openSms(smsHref(textBody(kind, id, extra)));
  return true;
}
function openSms(href) { location.href = href; }   // its own function so tests can catch it

// A speech bubble on every button that sends a text: plain when texting is set up, crossed out when it
// isn't (Done still marks the segment; the others open Settings).
function msgIcon(btn) {
  const on = textsReady();
  const svgEl = document.createElementNS(NS, "svg");
  for (const [k_, v] of Object.entries({ viewBox: "0 0 24 24", width: 18, height: 18, class: "msg-icon" + (on ? "" : " off"), "aria-hidden": "true" }))
    svgEl.setAttribute(k_, v);
  el("path", { d: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
               fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" }, svgEl);
  if (!on) el("path", { d: "M3 3l18 18", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round" }, svgEl);
  btn.appendChild(svgEl);
  btn.title = on ? "Sends a text to the dispatcher" : "Texting is off \u2013 add the dispatcher\u2019s number and your group in Settings";
}

// A status line under the banner while texting isn't set up; tap it to fill in what's missing.
const setupStatus = document.getElementById("setup-status");
const bannerH = () => document.documentElement.style.setProperty("--banner-h", banner.offsetHeight + "px");
if (window.ResizeObserver) new ResizeObserver(bannerH).observe(banner);
function renderSetupStatus() {
  bannerH();
  const say = !settings.tel && !settings.group ? "tap to set up" : !settings.tel ? "add dispatcher\u2019s number"
            : !settings.group ? "add your group\u2019s name" : "";
  setupStatus.hidden = !say;
  setupStatus.textContent = "";
  if (!say) return;
  msgIcon(setupStatus);
  h("span", "", `Texting off \u2013 ${say}`, setupStatus);
}
setupStatus.addEventListener("click", () => openSettings());
function textingChanged() { renderCallBtn(); renderSetupStatus(); renderCard(); renderBanner(); if (!sheet.hidden) renderList(); }

// Done marks the segment: faint on the map with a ✔ on its tag, ✔ in the list, the progress bar fills,
// and if it was your target, the target is cleared.
function markDone(id, on) {
  mySegs.done = mySegs.done.filter((x) => x !== id);
  let next = null;
  if (on) {
    mySegs.done.push(id);
    if (mySegs.target === id || allDone()) mySegs.target = null;   // done with it: the next one, if we can tell
    autoTarget();                                                 // only one left: that one
    nearestTarget();                                              // or, with GPS, the nearest
    next = mySegs.target && mySegs.target !== id ? mySegs.target : null;
  }
  saveSegs();
  segmentsChanged(false);
  // the last one became the target: the open card and the map move to it, as when swiping
  if (next && selected === id) {
    select(next, false);
    if (!me.following) fitBox(segBox(segById(next)));
  }
}

// ---------- settings: dispatcher's number, week and your group ----------
// Milestone 4's QR code will fill these in; until then they're typed here. Saved only on this phone.
const setPanel = document.getElementById("settings");
let setNote = "";
function openSettings(note) {
  setNote = note || "";
  if (setNote) setTab = "texting";        // sent here to fill something in: show the boxes
  renderSettings();
  closeSheet();
  slideIn(setPanel);
}
function closeSettings() { slideOut(setPanel); }
// Settings has four tabs, so it isn't one long scroll: Texting (number, group, auto-text), Share map,
// Group setup, and About (credits)
let setTab = "texting";
function renderSettings() {
  const body = document.getElementById("settings-body");
  body.textContent = "";
  const tabs = h("div", "tabs set-tabs", null, body);
  tabs.setAttribute("role", "tablist");
  for (const [key, label] of [["texting", "Texting"], ["map", "Share map"], ["group", "Group"], ["about", "About"]]) {
    const b = h("button", key === setTab ? "on" : "", label, tabs); b.type = "button";
    b.setAttribute("role", "tab"); b.setAttribute("aria-selected", key === setTab);
    b.addEventListener("click", () => { setTab = key; setNote = ""; renderSettings(); body.scrollTop = 0; });
  }
  if (setTab !== "texting") {
    const pane = h("section", "share", null, body);
    if (setTab === "map") mapPane(pane);
    else if (setTab === "group") groupPane(pane);
    else about(pane);
    return;
  }
  if (setNote) h("p", "note", setNote, body);
  const f = h("form", "", null, body);

  const telL = h("label", "field", null, f);
  h("span", "field-label", "Dispatcher\u2019s mobile number", telL);
  const telBox = h("span", "inputbox", null, telL);
  const tel = h("input", "", null, telBox);
  Object.assign(tel, { type: "tel", value: showTel(settings.tel), placeholder: "10 digits", autocomplete: "off" });
  tel.setAttribute("inputmode", "tel");
  const telMark = h("span", "mark", null, telBox);
  const err = h("span", "err", null, telL);

  const gL = h("label", "field", null, f);
  h("span", "field-label", "Your group", gL);
  const groupBox = h("span", "inputbox", null, gL);
  const group = h("input", "", null, groupBox);
  // the example follows your den: the den of your first segment, or the den on screen
  const first = mySegs.tracked[0] && segById(mySegs.tracked[0]);
  const guess = SINGULAR[first ? first.den : denKey !== PACK ? denKey : "W"];
  Object.assign(group, { type: "text", value: settings.group, placeholder: `e.g. ${guess} A`, autocomplete: "off", maxLength: 24 });
  group.setAttribute("autocapitalize", "words");
  const groupMark = h("span", "mark", null, groupBox);
  h("span", "hint", "The name your group goes by, the same as the dispatcher has it.", gL);

  const preview = h("p", "preview", null, f);

  function paint() {
    preview.textContent = `Texts will read: Wk${week()}: ${group.value.trim() || "\u2026"} \u2013 ${mySegs.target || "W7"} done`;
  }
  paint();
  // Not every phone in a group needs to text: one parent can be the texter. Off: Done just marks the
  // segment, and a separate "Text done" button sends the text.
  const atL = h("label", "field check", null, f);
  const at = h("input", "", null, atL);
  Object.assign(at, { type: "checkbox", checked: settings.autoText });
  h("span", "field-label", "Text the dispatcher when I tap Done", atL);
  h("span", "hint", "Turn off if someone else in your group sends the texts. Done then just marks the segment, with a separate Text done button.", atL);
  at.addEventListener("change", () => { settings.autoText = at.checked; saveSettings(); renderCard(); });

  // Saves as you fill it in: the group as you type; the number once it's a good 10 digits (or cleared).
  // A number that doesn't look right is never saved (the last good one stays); you're told when you leave it.
  // each box has its own mark: ✔ once what's in it is saved, ✗ for a number that doesn't look right
  function mark(el, state) {
    el.textContent = state === "ok" ? "\u2714\ufe0e" : state === "bad" ? "\u2716\ufe0e" : "";
    el.className = "mark" + (state ? " " + state : "");
    el.setAttribute("aria-label", state === "ok" ? "Saved" : state === "bad" ? "Not saved" : "");
  }
  function marks(telBad) {
    mark(groupMark, settings.group ? "ok" : "");
    const typed = tel.value.trim();
    mark(telMark, telBad ? "bad" : typed && normTel(typed) && normTel(typed) === settings.tel ? "ok" : "");
  }
  marks(false);
  function store() { saveSettings(); textingChanged(); marks(false); }
  group.addEventListener("input", () => {
    paint();
    settings.group = group.value.trim().replace(/\s+/g, " ");
    store();
  });
  tel.addEventListener("input", () => {
    const typed = tel.value.trim(), t = normTel(typed);
    if (t || !typed) { err.textContent = ""; if (settings.tel !== (t || "")) { settings.tel = t || ""; store(); } else marks(false); }
    else if (telMark.classList.contains("ok")) marks(false);   // editing a saved number: no ✔ until it's good again
  });
  tel.addEventListener("blur", () => {
    const typed = tel.value.trim();
    const bad = typed && !normTel(typed);
    err.textContent = bad ? "Needs 10 digits, like (314) 555-0100. Not saved." : "";
    if (normTel(typed)) tel.value = showTel(normTel(typed));   // tidy it up
    marks(bad);
  });
  f.addEventListener("submit", (e) => { e.preventDefault(); document.activeElement.blur(); });   // Return on the keyboard: done typing
}
// credits and licences (the map data's sources ask for them; NOTICE.md on GitHub has the full terms)
function about(body) {
  // the den leader guides: plain pages on this site
  const g = h("div", "guides", null, body);
  h("h3", "", "Den leader guides", g);
  const row = h("div", "guide-links", null, g);
  for (const [href, label] of [["guide/week1.html", "Week 1 (bags)"], ["guide/week2.html", "Week 2 (pickup)"]]) {
    const a = h("a", "share-btn", label + " \u203a", row); a.href = href;
  }
  const ack = h("div", "guides", null, body);
  h("h3", "", "Acknowledgments", ack);
  const p = h("p", "about", null, ack);
  p.append("Map data: St. Louis County GIS Service Center. Building outlines: Microsoft Global ML Building Footprints (CDLA-Permissive-2.0). " +
           "App \u00a9 2026 Jay Tuley and contributors, PolyForm Noncommercial 1.0.0. Made by Pack 721 volunteers; not an official Scouting America product. ");
  const a = h("a", "", "Licences & credits", p);
  a.href = "https://github.com/Pack3721/SFF/blob/main/NOTICE.md";
  a.target = "_blank"; a.rel = "noopener noreferrer";
}

// "Share the map": a QR code another parent can scan off this screen, and the phone's own share sheet.
// The link carries the dispatcher's number (when this phone has it), never your group or segments.
function shareLink() {
  const base = new URL("./", location.href).href;
  return settings.tel ? base + "#tel=" + settings.tel.slice(2) : base;
}
function loadQr() {                       // the QR library loads only when it's needed
  if (window.qrcode) return Promise.resolve();
  return new Promise((ok, fail) => {
    const sc = document.createElement("script");
    sc.src = "vendor/qrcode-generator-2.0.4.js?v=" + BUILD;
    sc.onload = ok; sc.onerror = fail;
    document.head.appendChild(sc);
  });
}
function qrSvg(text) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 4, size = n + quiet * 2;
  const svgEl = el("svg", { viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": "QR code for the map", "shape-rendering": "crispEdges" });
  el("rect", { width: size, height: size, fill: "#fff" }, svgEl);
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  el("path", { d, fill: "#000" }, svgEl);
  return svgEl;
}
// Share: two tabs, both a link shown as a QR code to scan off this screen, or sent from the phone.
//  Map & dispatcher: for any parent; the map and the dispatcher's number only.
//  Group setup: for a parent in your group or your own Home Screen app; group, den, segments and number
//  (only offered once there's a group name; Restore from paste is always there).
function qrBox(parent, link) {
  const box = h("div", "share-qr", null, parent);
  loadQr().then(() => { box.textContent = ""; box.appendChild(qrSvg(link)); })
          .catch(() => { box.textContent = "QR code needs a signal the first time."; });
}
function mapPane(pane) {
  h("p", "hint", settings.tel
    ? `For any parent: opens the map with texts going to the dispatcher, ${showTel(settings.tel)}. Doesn\u2019t include your group or segments.`
    : "For any parent: opens the map. (This phone doesn\u2019t have the dispatcher\u2019s number yet.)", pane);
  const link = shareLink();
  qrBox(pane, link);
  const row = h("div", "move-row", null, pane);
  const btn = iconBtn(navigator.share ? "share" : "copy", navigator.share ? "Share map link\u2026" : "Copy map link", row);
  btn.addEventListener("click", () => {
    if (navigator.share) navigator.share({ title: "SFF 721 Map", text: "Scouting for Food walking map", url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => { btn.say("\u2714\ufe0e Copied"); });
  });
}
function groupPane(pane) {
  // With no group name yet there's nothing worth sharing: only offer to restore from someone else's copy.
  const has = !!settings.group;
  h("p", "hint", has
    ? `For a parent in your group, or your own Home Screen app: \u201c${settings.group}\u201d, den, segments and the dispatcher\u2019s number. Scan it with the other phone, or Copy settings and Restore from paste.`
    : "Got your group\u2019s QR code, or settings copied from someone in your group? Tap Scan QR code or Restore from paste. To share yours, add your group name on the Texting tab.", pane);
  const link = has ? setupLink() : null;
  if (has) qrBox(pane, link);
  const row = h("div", "move-row", null, pane);
  const say = h("p", "move-msg", null, pane);
  if (has) {
    const copy = iconBtn("copy", "Copy settings", row);
    copy.addEventListener("click", () => {
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(() => { say.textContent = "\u2714\ufe0e Copied. On the other phone or app, tap Restore from paste."; })
        .catch(() => { say.textContent = link; });   // no clipboard: show it to copy by hand
    });
  }
  const paste = iconBtn("paste", "Restore from paste", row);
  paste.addEventListener("click", () => {
    if (!navigator.clipboard || !navigator.clipboard.readText) { say.textContent = "This browser can\u2019t paste here. Paste the link into the address bar instead."; return; }
    navigator.clipboard.readText().then((text) => {
      if (!useLinkText(text)) say.textContent = "That isn\u2019t copied settings. Tap Copy settings on the other phone first.";
    }).catch(() => { say.textContent = "Couldn\u2019t read the clipboard. Allow Paste when asked, then try again."; });
  });
  // the Home Screen app can't be reached by the phone's camera app (that opens the browser), so it scans itself
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const scan = iconBtn("scan", "Scan QR code", row);
    scan.addEventListener("click", openScanner);
  }
}
// Settings from a copied or scanned link: a group setup link (name, den, segments, number) or the
// dispatcher's (number, den). Anything else is turned down. Returns false if it wasn't one of ours.
function linkLooksOurs(text) {
  text = (text || "").trim();
  if (/^https?:/i.test(text)) {
    try { const u = new URL(text); if (u.host !== location.host && u.host !== "pack3721.github.io") return false; } catch (_) { return false; }
  }
  const at = text.indexOf("#");
  const q = new URLSearchParams(at >= 0 ? text.slice(at + 1) : "");
  return q.has("seg") || q.has("g") || q.has("tel");
}
function useLinkText(text) {
  if (!linkLooksOurs(text)) return false;
  text = text.trim();
  const at = text.indexOf("#");
  const q = new URLSearchParams(at >= 0 ? text.slice(at + 1) : "");
  const n = applySetup(q);
  pick(localStorage.getItem(STORE_KEY) || denKey);
  textingChanged();
  renderSettings();
  const msg = document.querySelector("#settings .move-msg");
  if (msg) msg.textContent = q.has("seg") || q.has("g")
    ? `\u2714\ufe0e Restored: ${settings.group || "no group"}, ${n} segment${n === 1 ? "" : "s"}${settings.tel ? ", dispatcher\u2019s number" : ""}.`
    : "\u2714\ufe0e Got the dispatcher\u2019s number.";
  return true;
}

// ---------- the QR scanner (Settings > Share > Group setup) ----------
// The camera picture is read on the phone by jsQR (vendored; Safari has no built-in QR reader), and a
// group or dispatcher QR code is applied like Restore from paste. The camera is off whenever the panel is.
const scanPanel = document.getElementById("scan");
let scanStop = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((ok, fail) => {
    const sc = document.createElement("script");
    sc.src = "vendor/jsQR-1.4.0.js?v=" + BUILD;
    sc.onload = ok; sc.onerror = fail;
    document.head.appendChild(sc);
  });
}
function closeScanner() { if (scanStop) scanStop(); slideOut(scanPanel); }
// Focus: an iPhone Pro's main camera can't focus closer than about 20 cm, so a code held close stays
// blurry. So ask for a sharp picture, zoom 2x where the camera allows it, and read the middle of the
// picture at full detail: the code reads from farther away, where it's sharp. (As in sound-box-crosswords.)
// Found: the frame it was read from stays, the code outlined in green, with "Got it!", for a moment
// before it's applied, so it's plain what happened.
function openScanner() {
  if (scanStop) scanStop();
  scanPanel.textContent = "";
  const top = h("div", "card-top", null, scanPanel);
  h("h2", "", "Scan a QR code", top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", closeScanner);
  const view = h("div", "scan-view", null, scanPanel);
  const v = h("video", "scan-video", null, view);
  v.muted = true; v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
  h("span", "scan-got", "\u2714\ufe0e Got it!", view);
  const say = h("p", "scan-say", "Point the camera at your group\u2019s QR code (or the dispatcher\u2019s).", scanPanel);
  say.setAttribute("role", "status");
  slideIn(scanPanel);
  let stream = null, timer = 0, stopped = false;
  const camOff = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; v.srcObject = null; };
  scanStop = () => { stopped = true; clearTimeout(timer); camOff(); scanStop = null; };
  Promise.all([loadJsQR(), navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })])
    .then(async ([, s]) => {
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const track = s.getVideoTracks()[0];
      try {
        const zoom = track.getCapabilities && track.getCapabilities().zoom;
        if (zoom && zoom.max >= 2) await track.applyConstraints({ advanced: [{ zoom: Math.max(zoom.min, 2) }] });
      } catch (_) { /* not every camera or browser can zoom */ }
      v.srcObject = s;
      await v.play();
      const c = document.createElement("canvas"), ctx = c.getContext("2d", { willReadFrequently: true });
      const look = () => {
        if (stopped) return;
        const vw = v.videoWidth, vh = v.videoHeight;
        if (vw) {
          // the middle square, at most 800 pixels across: full detail where the code is held
          const side = Math.min(vw, vh) * 0.8, w = Math.min(800, Math.round(side));
          c.width = w; c.height = w;
          ctx.drawImage(v, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, w, w);
          const code = jsQR(ctx.getImageData(0, 0, w, w).data, w, w, { inversionAttempts: "dontInvert" });
          if (code && code.data) {
            if (linkLooksOurs(code.data)) { found(code, vw, vh, side, w); return; }
            say.textContent = "That QR code isn\u2019t for the SFF 721 Map. Try your group\u2019s code.";
          }
        }
        timer = setTimeout(look, 200);   // 5 a second is plenty, and spares the battery
      };
      // keep the frame, outline the code, say "Got it!", then apply it and close
      const found = (code, vw, vh, side, w) => {
        const k = Math.min(1, 960 / vw), still = document.createElement("canvas");
        still.width = Math.round(vw * k); still.height = Math.round(vh * k);
        const sc = still.getContext("2d");
        sc.drawImage(v, 0, 0, still.width, still.height);
        const at = (p) => [((vw - side) / 2 + p.x * side / w) * k, ((vh - side) / 2 + p.y * side / w) * k];
        const L = code.location;
        sc.beginPath();
        [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].forEach((p, i) => {
          const [px, py] = at(p); if (i) sc.lineTo(px, py); else sc.moveTo(px, py);
        });
        sc.closePath(); sc.lineJoin = "round"; sc.lineWidth = Math.max(4, still.width / 80); sc.strokeStyle = "#1e7e34"; sc.stroke();
        still.className = "scan-still"; still.setAttribute("aria-hidden", "true");
        view.insertBefore(still, view.querySelector(".scan-got"));
        view.classList.add("found");
        say.textContent = "";
        camOff();
        timer = setTimeout(() => { if (stopped) return; useLinkText(code.data); closeScanner(); }, 1100);
      };
      look();
    })
    .catch((e) => {
      if (stopped) return;
      say.textContent = e && e.name === "NotAllowedError"
        ? "The camera is blocked. Allow the camera for this app in the phone\u2019s settings, then try again."
        : "Couldn\u2019t start the camera.";
    });
}
document.addEventListener("visibilitychange", () => { if (document.hidden && scanStop) closeScanner(); });   // never leave the camera on
document.getElementById("settings-btn").addEventListener("click", () => openSettings());
document.getElementById("settings-close").addEventListener("click", closeSettings);

// ---------- den leader: split a den into walking groups ----------
// Picked from the den drop-down. No targets or tracking here: the den's segments are coloured by group, a
// panel sets how many groups and their names, the first split keeps each group's segments close together
// with about even houses, and tapping a segment moves it into the selected group. Each group gets a QR
// code / link that sets a parent's phone up with that group's name and segments. Saved per den, on this phone.
const LEADER = "LEADER";
const GROUP_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#e377c2", "#8c564b"];
const LEADER_KEY = "sff.leader";
let leader = null;                       // {den, n, names, assign: {segId: group}, active} while in this mode
const leaderPanel = document.getElementById("leader");
const groupPanel = document.getElementById("gqr");

function leaderStore(den, value) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LEADER_KEY) || "{}") || {}; } catch (_) { /* ignore */ }
  if (value === undefined) return all[den];
  all[den] = value;
  try { localStorage.setItem(LEADER_KEY, JSON.stringify(all)); } catch (_) { /* ignore */ }
}
const saveLeader = () => leaderStore(leader.den, { n: leader.n, names: leader.names, assign: leader.assign, edited: leader.edited, mode: leader.mode });
function groupNames() {                  // fill in default names: Wolf A, Wolf B, …
  for (let i = 0; i < leader.n; i++) if (!leader.names[i]) leader.names[i] = `${SINGULAR[leader.den]} ${"ABCDEFGH"[i]}`;
  leader.names.length = leader.n;
}

function enterLeader(den) {
  den = den || (denKey && denKey !== PACK && denKey !== LEADER ? denKey : DATA.dens[0].key);
  const saved = leaderStore(den);
  const segIds = DATA.dens.find((d) => d.key === den).segments;
  const ok = saved && saved.assign && segIds.every((id) => id in saved.assign);
  leader = { den, n: (saved && saved.n) || 2, names: (saved && saved.names) || [], assign: ok ? saved.assign : null, active: 0,
             edited: ok && saved.edited !== false, mode: (ok && saved.mode) || "walk" };   // older saves were walking splits   // moved by hand since the last auto split (older saves: assume so)
  groupNames();
  if (!leader.assign) splitGroups();
  selected = null; renderCard(); closeSheet(); slideOut(availPanel); slideOut(contactPanel);
  document.body.classList.add("leader");
  denKey = den;
  draw();
  picker.value = LEADER;
  renderLeader();
  slideIn(leaderPanel);
  fit();
}
function exitLeader(quiet) {
  const den = leader.den;
  leader = null;
  document.body.classList.remove("leader");
  slideOut(leaderPanel); slideOut(groupPanel);
  if (!quiet) pick(den);
}

// The first split: walk the den's segments in one sweep (nearest next segment each time), cut the sweep
// into groups of about equal houses, and keep the sweep, over every starting segment, whose groups are
// most compact and most even. Contiguous pieces of a sweep stay close together.
// Week 2 (pickup, by car) splits into car loops instead: wedges around the middle of the den, each a run of
// segments a car can drive out along one side and back along the other. Main roads don't matter by car.
const splitMode = () => (week() === 2 ? "drive" : "walk");
function splitGroups(mode) {
  mode = mode || splitMode();
  if (mode === "drive") { leader.assign = splitLoops(leader.den, leader.n); leader.edited = false; leader.mode = mode; saveLeader(); return; }
  const segs = DATA.dens.find((d) => d.key === leader.den).segments.map(segById);
  const n = Math.min(leader.n, segs.length);
  const ids = segs.map((s) => s.id), cen = {}, w = {};
  for (const s of segs) {
    const pts = DATA.houses.filter((h) => h.seg === s.id).map((h) => P(h.lonlat));
    cen[s.id] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    w[s.id] = s.houses;
  }
  // which side of each main road a segment is on, so groups can stay on one side (cross only at the stop)
  const roads = DATA.arterials.map((a) => a.line.map(P));
  const side = (pt, line) => {
    let bi = 1, bd = Infinity;
    for (let q = 1; q < line.length; q++) { const d = segDist(pt, line[q - 1], line[q]); if (d < bd) { bd = d; bi = q; } }
    const [a, b] = [line[bi - 1], line[bi]];
    return bd > 600 ? 0 : Math.sign((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]));   // 0: too far to matter
  };
  const sides = {};
  for (const id of ids) sides[id] = roads.map((line) => side(cen[id], line));
  const total = ids.reduce((a, id) => a + w[id], 0);
  // cost of a split: spread (house-weighted squared distance to the group's middle), unevenness, and main-road
  // straddling (houses on the smaller side of a road, per group)
  function cost(assign) {
    let c = 0;
    for (let g = 0; g < n; g++) {
      const mine = ids.filter((id) => assign[id] === g);
      if (!mine.length) { c += 1e9; continue; }
      const hs = mine.reduce((a, id) => a + w[id], 0);
      const m = [mine.reduce((a, id) => a + cen[id][0] * w[id], 0) / hs, mine.reduce((a, id) => a + cen[id][1] * w[id], 0) / hs];
      c += mine.reduce((a, id) => a + dist(cen[id], m) ** 2 / 150 * w[id], 0);   // squared: one far-off segment costs a lot
      c += Math.abs(hs - total / n) * 400;
      roads.forEach((_, r) => {
        let pos = 0, neg = 0;
        for (const id of mine) { if (sides[id][r] > 0) pos += w[id]; else if (sides[id][r] < 0) neg += w[id]; }
        c += Math.min(pos, neg) * 600;
      });
    }
    return c;
  }
  let best = null, bestCost = Infinity;
  for (const start of ids) {
    // 1. one sweep through the den (nearest next segment), cut into n runs of about equal houses
    const left = new Set(ids); let cur = start; const tour = [cur]; left.delete(cur);
    while (left.size) {
      let nb = null, bd = Infinity;
      for (const id of left) { const d = dist(cen[cur], cen[id]); if (d < bd) { bd = d; nb = id; } }
      tour.push(nb); left.delete(nb); cur = nb;
    }
    const assign = {}; let acc = 0, g = 0, inGroup = 0;
    tour.forEach((id, t) => {
      if (g < n - 1 && inGroup > 0 && (acc + w[id] / 2 > total * (g + 1) / n || tour.length - t < n - g)) { g++; inGroup = 0; }
      assign[id] = g; acc += w[id]; inGroup++;
    });
    // 2. tidy up: move single segments to another group while that lowers the cost
    let c = cost(assign);
    for (let pass = 0, moved = true; moved && pass < 30; pass++) {
      moved = false;
      for (const id of ids) for (let to = 0; to < n; to++) {
        const from = assign[id];
        if (to === from) continue;
        assign[id] = to;
        const c2 = cost(assign);
        if (c2 < c - 1e-6) { c = c2; moved = true; } else assign[id] = from;
      }
    }
    if (c < bestCost) { bestCost = c; best = { ...assign }; }
  }
  leader.assign = best; leader.edited = false; leader.mode = mode;
  saveLeader();
}
function splitLoops(denKey_, n) {
  const ANG_W = 800, EVEN_W = 1500, PAIR_W = 3000;   // wedge shape, even houses, both sides of a street together
  const segs = DATA.dens.find((d) => d.key === denKey_).segments.map(segById);
  n = Math.min(n, segs.length);
  const ids = segs.map((s) => s.id), cen = {}, w = {};
  for (const s of segs) {
    const pts = DATA.houses.filter((h) => h.seg === s.id).map((h) => P(h.lonlat));
    cen[s.id] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    w[s.id] = s.houses;
  }
  // both sides of a street: segments on the same street whose houses face each other are partners, so one car
  // can drive the street once and pick up both sides
  const housesOn = {};                   // segment -> street -> house points
  for (const s of segs) {
    housesOn[s.id] = {};
    for (const hh of DATA.houses) if (hh.seg === s.id) (housesOn[s.id][hh.street] = housesOn[s.id][hh.street] || []).push(P(hh.lonlat));
  }
  const partners = {};
  for (const id of ids) partners[id] = [];
  const near = (X, Y) => X.filter((p) => Y.some((q) => dist(p, q) < 52)).length;   // a house across the street, ~45 m
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i].id, B = segs[j].id;
    // facing: on a street they share (at least 3 houses each), most houses have one across from them
    const facing = Object.keys(housesOn[A]).some((st) => {
      const X = housesOn[A][st], Y = housesOn[B][st];
      return Y && X.length >= 3 && Y.length >= 3 && Math.max(near(X, Y) / X.length, near(Y, X) / Y.length) >= 0.5;
    });
    if (facing) { partners[A].push(B); partners[B].push(A); }
  }
  const total = ids.reduce((a, id) => a + w[id], 0);
  const mid = [ids.reduce((a, id) => a + cen[id][0] * w[id], 0) / total, ids.reduce((a, id) => a + cen[id][1] * w[id], 0) / total];
  const ang = {}, rad = {};
  for (const id of ids) { ang[id] = Math.atan2(cen[id][1] - mid[1], cen[id][0] - mid[0]); rad[id] = dist(cen[id], mid); }
  const rmax = Math.max(...ids.map((id) => rad[id])) || 1;
  // cost: each segment's angle away from its group's direction (counts more the farther out it is, since
  // segments near the middle fit any wedge), a little spread, and unevenness
  function cost(assign) {
    let c = 0;
    for (let g = 0; g < n; g++) {
      const mine = ids.filter((id) => assign[id] === g);
      if (!mine.length) { c += 1e9; continue; }
      const hs = mine.reduce((a, id) => a + w[id], 0);
      const sx = mine.reduce((a, id) => a + Math.cos(ang[id]) * w[id] * rad[id], 0), sy = mine.reduce((a, id) => a + Math.sin(ang[id]) * w[id] * rad[id], 0);
      const dir = Math.atan2(sy, sx);
      const m = [mine.reduce((a, id) => a + cen[id][0] * w[id], 0) / hs, mine.reduce((a, id) => a + cen[id][1] * w[id], 0) / hs];
      for (const id of mine) {
        const da = Math.abs(((ang[id] - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        c += w[id] * da * da * (rad[id] / rmax) * ANG_W;
        c += dist(cen[id], m) ** 2 / 600 * w[id];
      }
      c += Math.abs(hs - total / n) * EVEN_W;
    }
    for (const id of ids) for (const p of partners[id]) if (id < p && assign[id] !== assign[p]) c += Math.min(w[id], w[p]) * PAIR_W;
    return c;
  }
  const order = ids.slice().sort((a, b) => ang[a] - ang[b]);
  let best = null, bestCost = Infinity;
  for (let r = 0; r < order.length; r++) {
    // 1. go round the middle starting at segment r, cutting into n wedges of about equal houses
    const tour = order.slice(r).concat(order.slice(0, r));
    const assign = {}; let acc = 0, g = 0, inGroup = 0;
    tour.forEach((id, t) => {
      if (g < n - 1 && inGroup > 0 && (acc + w[id] / 2 > total * (g + 1) / n || tour.length - t < n - g)) { g++; inGroup = 0; }
      assign[id] = g; acc += w[id]; inGroup++;
    });
    // 2. tidy up: move single segments while that lowers the cost
    let c = cost(assign);
    for (let pass = 0, moved = true; moved && pass < 30; pass++) {
      moved = false;
      for (const id of ids) for (let to = 0; to < n; to++) {
        // move a segment alone, or with its other side of the street
        for (const group of [[id], [id, ...partners[id]]]) {
          const from = group.map((x) => assign[x]);
          if (from.every((f) => f === to)) continue;
          group.forEach((x) => { assign[x] = to; });
          const c2 = cost(assign);
          if (c2 < c - 1e-6) { c = c2; moved = true; } else group.forEach((x, k) => { assign[x] = from[k]; });
          if (!partners[id].length) break;
        }
      }
    }
    if (c < bestCost) { bestCost = c; best = { ...assign }; }
  }
  return best;
}

function assignGroup(id) {
  if (leader.assign[id] === leader.active) return;
  leader.assign[id] = leader.active; leader.edited = true;
  saveLeader();
  styleSegments();
  renderLeader();
}
function leaderStyle() {                 // segments in their group's colour (grey if in none)
  for (const id in segEls) {
    const e = segEls[id];
    const g = leader.assign[id];
    const col = g != null && g < leader.n ? GROUP_COLORS[g] : "#9a9a9a";
    e.faded = false;
    for (const [part, attr] of e.paint) part.setAttribute(attr, part === e.homes ? tint(col, 0.45) : col);
    e.route.setAttribute("opacity", 0.9); e.homes.setAttribute("opacity", 1);
    for (const x of e.extras) x.setAttribute("opacity", 1);
    if (e.tagText) {
      e.tagText.textContent = e.tagLabel; e.tagText.style.fill = "";
      e.tagBox.setAttribute("x", -e.tagW[0] / 2); e.tagBox.setAttribute("width", e.tagW[0]);
    }
    e.halo.style.display = "none";
  }
  ants.style.display = "none";
  for (const [, copy] of fxCopies) copy.remove();
  fxCopies = [];
  if (bbox) { placedK = 0; commit(); }
}
const groupSegs = (i) => DATA.dens.find((d) => d.key === leader.den).segments.filter((id) => leader.assign[id] === i);

function renderLeader() {
  leaderPanel.textContent = "";
  const top = h("div", "card-top", null, leaderPanel);
  h("h2", "", "Den leader", top);
  const den = h("select", "leader-den", null, top);
  den.setAttribute("aria-label", "Den");
  for (const d of DATA.dens) { const o = h("option", "", d.short, den); o.value = d.key; }
  den.value = leader.den;
  den.addEventListener("change", () => enterLeader(den.value));
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Leave den leader");
  x.addEventListener("click", () => exitLeader());

  const row = h("div", "leader-count", null, leaderPanel);
  h("span", "lbl", "Groups", row);
  const minus = h("button", "step", "\u2212", row); minus.type = "button"; minus.setAttribute("aria-label", "Fewer groups");
  h("b", "", String(leader.n), row);
  const plus = h("button", "step", "+", row); plus.type = "button"; plus.setAttribute("aria-label", "More groups");
  const again = h("button", "share-btn", "Auto re-split", row); again.type = "button";
  // greyed out when it would come out the same: nothing moved by hand, and already this week's kind of split
  again.disabled = !leader.edited && leader.mode === splitMode();
  const setN = (n) => {
    leader.n = Math.max(1, Math.min(8, n)); leader.active = Math.min(leader.active, leader.n - 1);
    groupNames(); splitGroups(); styleSegments(); renderLeader();
  };
  minus.disabled = leader.n <= 1; plus.disabled = leader.n >= 8;
  minus.addEventListener("click", () => setN(leader.n - 1));
  plus.addEventListener("click", () => setN(leader.n + 1));
  again.addEventListener("click", () => { splitGroups(); styleSegments(); renderLeader(); });

  h("p", "hint", "Pick a group below by tapping its colour, then tap a segment on the map to put that segment in the group.", leaderPanel);
  if (splitMode() === "drive") h("p", "hint", leader.mode === "drive" ? "Week 2: these groups are car loops."
    : "Week 2: keep last week\u2019s groups, or tap Auto re-split for car loops.", leaderPanel);
  h("p", "leader-warn", "Hand out QR codes after the groups are final. Phones that already scanned one keep the old segments, so moving segments later means new QR codes.", leaderPanel);
  const list = h("div", "groups", null, leaderPanel);
  for (let i = 0; i < leader.n; i++) {
    const ids = groupSegs(i), hs = ids.reduce((a, id) => a + segById(id).houses, 0);
    const g = h("div", "group" + (i === leader.active ? " on" : ""), null, list);
    g.style.setProperty("--g", GROUP_COLORS[i]);
    const pickBtn = h("button", "group-pick", null, g); pickBtn.type = "button";
    pickBtn.setAttribute("aria-label", "Move tapped segments to " + leader.names[i]);
    pickBtn.setAttribute("aria-pressed", i === leader.active);
    pickBtn.addEventListener("click", () => { leader.active = i; renderLeader(); });
    const name = h("input", "group-name", null, g);
    Object.assign(name, { type: "text", value: leader.names[i], maxLength: 24, autocomplete: "off" });
    name.setAttribute("aria-label", "Group name");
    name.addEventListener("focus", () => { if (leader.active !== i) { leader.active = i; for (const el2 of list.children) el2.classList.toggle("on", el2 === g); } });
    name.addEventListener("input", () => { leader.names[i] = name.value.trim() || leader.names[i]; saveLeader(); });
    const st = h("span", "group-stats", null, g);
    h("b", "", String(hs), st); h("small", "", "houses", st);
    const ls = h("button", "share-btn group-qr", null, g); ls.type = "button";
    ls.appendChild(listIcon());
    ls.setAttribute("aria-label", "Segment list for " + leader.names[i]);
    ls.disabled = !ids.length;
    ls.addEventListener("click", () => showGroupList(i));
    const qr = h("button", "share-btn group-qr", null, g); qr.type = "button";
    qr.appendChild(qrIcon());
    qr.setAttribute("aria-label", "QR code for " + leader.names[i]);
    qr.disabled = !ids.length;
    qr.addEventListener("click", () => showGroupQr(i));
  }
  const pa = h("button", "share-btn print-all", null, leaderPanel); pa.type = "button";
  pa.appendChild(printIcon()); h("span", "", "Print handouts for all groups\u2026", pa);
  pa.addEventListener("click", () => printHandouts(null));
  document.body.style.setProperty("--leader-h", leaderPanel.getBoundingClientRect().height + "px");
}

function qrIcon() {                      // a small QR-code picture: three corner squares and some dots
  const svgEl = document.createElementNS(NS, "svg");
  for (const [k_, v] of Object.entries({ viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": "true" })) svgEl.setAttribute(k_, v);
  const d = "M3 3h7v7H3zM5 5v3h3V5zM14 3h7v7h-7zM16 5v3h3V5zM3 14h7v7H3zM5 16v3h3v-3z" +
            "M14 14h3v3h-3zM18 14h3v2h-3zM14 18h2v3h-2zM17 18h4v3h-4z";
  el("path", { d, fill: "currentColor", "fill-rule": "evenodd" }, svgEl);
  return svgEl;
}
function groupLink(i) {                  // a group setup link: name, den, segments and the number if known
  const q = new URLSearchParams();
  if (settings.tel) q.set("tel", settings.tel.slice(2));
  q.set("g", leader.names[i]);
  q.set("den", leader.den);
  q.set("seg", groupSegs(i).join(","));
  return new URL("./", location.href).href + "#" + q.toString().replace(/%2C/g, ",");
}
function listIcon() {                    // same picture as the segments-list button
  const svgEl = document.createElementNS(NS, "svg");
  for (const [k_, v] of Object.entries({ viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": "true" })) svgEl.setAttribute(k_, v);
  for (const cy of [6.5, 12, 17.5]) el("circle", { cx: 5, cy, r: 1.8, fill: "currentColor" }, svgEl);
  el("path", { d: "M9.5 6.5h11M9.5 12h11M9.5 17.5h11", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round" }, svgEl);
  return svgEl;
}

// ---------- button icons: share, copy, paste ----------
const BTN_ICONS = {
  upload: "M12 15V3M7.5 7.5 12 3l4.5 4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17",   // arrow up out of a tray
  download: "M12 3v12M7.5 10.5 12 15l4.5-4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17",   // arrow down into a tray
  share: "M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v8.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V11",       // box with an arrow up
  copy: "M9 9h10.5A1.5 1.5 0 0 1 21 10.5V20a1.5 1.5 0 0 1-1.5 1.5H10.5A1.5 1.5 0 0 1 9 20zM15 9V4.5A1.5 1.5 0 0 0 13.5 3H4.5A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H9",   // two sheets
  scan: "M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M3 12h18",   // corner brackets with a scan line
  paste: "M9 4H6.5A1.5 1.5 0 0 0 5 5.5v14A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-14A1.5 1.5 0 0 0 17.5 4H15M9 2.5h6v3H9zM9 11h6M9 15h6",   // clipboard
};
// a button with an icon before its label; btn.say(text) changes the label and keeps the icon
function iconBtn(kind, text, parent) {
  const b = h("button", "share-btn", null, parent); b.type = "button";
  const svgEl = document.createElementNS(NS, "svg");
  for (const [k_, v] of Object.entries({ viewBox: "0 0 24 24", width: 20, height: 20, class: "print-icon", "aria-hidden": "true" })) svgEl.setAttribute(k_, v);
  el("path", { d: BTN_ICONS[kind], fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svgEl);
  b.appendChild(svgEl);
  const label = h("span", "", text, b);
  b.say = (t) => { label.textContent = t; };
  return b;
}

// ---------- printed handouts (den leader mode) ----------
function printIcon() {                   // a small printer: paper in, body, paper out
  const svgEl = document.createElementNS(NS, "svg");
  for (const [k_, v] of Object.entries({ viewBox: "0 0 24 24", width: 20, height: 20, class: "print-icon", "aria-hidden": "true" })) svgEl.setAttribute(k_, v);
  el("path", { d: "M7 9V3h10v6M7 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v7H7z",
               fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" }, svgEl);
  return svgEl;
}
// One letter page per group: the whole den map (coverage can send anyone anywhere), with the group's own
// segments marked with a star and the rest a little lighter; the den's segment list with the group's first;
// and the group's QR code. The map is drawn at page size off to the side, copied, and the view put back.
function printStyle(g) {
  for (const id in segEls) {
    const e = segEls[id], mine = leader.assign[id] === g;
    e.faded = false;
    for (const [part, attr, colour] of e.paint) part.setAttribute(attr, mine ? colour : tint(colour, 0.55));
    e.route.setAttribute("opacity", mine ? 1 : 0.6); e.homes.setAttribute("opacity", mine ? 1 : 0.5);
    for (const x of e.extras) x.setAttribute("opacity", mine || x.kind === "tag" ? 1 : 0.5);
    if (e.tagText) {
      e.tagText.textContent = e.tagLabel + (mine ? " \u2605" : ""); e.tagText.style.fill = "";   // star in the tag's text colour
      const w = e.tagW[mine ? 1 : 0];
      e.tagBox.setAttribute("x", -w / 2); e.tagBox.setAttribute("width", w);
      e.tagBox.setAttribute("stroke", mine ? "#111" : "none"); e.tagBox.setAttribute("stroke-width", mine ? 2 : 0);
    }
    e.halo.style.display = "none";
  }
  ants.style.display = "none";
}
function printHandouts(only) {
  if (isIOS() && navigator.standalone) { printFromSafari(); return; }   // a Home Screen app can't print on iPhone
  const groups = (only == null ? [...Array(leader.n).keys()] : [only]).filter((i) => groupSegs(i).length);
  if (!groups.length) return;
  const out = document.getElementById("print");
  out.textContent = "";
  const den = DATA.dens.find((d) => d.key === leader.den);
  // 1. the pages without their maps: header, a box for the map, the segment list, QR and texting help
  const boxes = [];
  for (const g of groups) {
    const ids = groupSegs(g), houses = ids.reduce((a, id) => a + segById(id).houses, 0);
    const page = h("section", "print-page", null, out);
    const head = h("div", "print-head", null, page);
    const t = h("h1", "", leader.names[g], head); t.style.color = GROUP_COLORS[g];
    h("p", "", `${den.name} \u2022 Week ${week()} \u2022 \u2605 ${ids.length} segment${ids.length === 1 ? "" : "s"}, ${houses} houses`, head);
    h("span", "print-ver", BUILD === "dev" ? "dev" : BUILD.slice(0, 7), head);   // which version printed it
    boxes.push([g, h("div", "print-mapbox", null, page)]);
    const foot = h("div", "print-foot", null, page);
    // two plain columns, the first half then the second (Safari's print layout gets a grid's row heights wrong)
    const cols = h("div", "print-cols", null, foot);
    const lists = [h("ol", "print-segs", null, cols), h("ol", "print-segs", null, cols)];
    const order = den.segments.map(segById).sort((a, b) => (leader.assign[b.id] === g) - (leader.assign[a.id] === g) || segOrder(a, b));
    const half = Math.ceil(order.length / 2);
    for (const [n, sg] of order.entries()) {
      const mine = leader.assign[sg.id] === g;
      const li = h("li", mine ? "mine" : "", null, lists[n < half ? 0 : 1]);
      h("span", week() === 1 ? "print-tick" : "print-tally", "", li);   // next to the ID: Week 1 a box to tick, Week 2 room for tally marks
      const idb = h("b", "", null, li);                                   // the ID in its map colour, like the tag
      if (mine) h("span", "print-star", "\u2605", idb);
      const tag = h("span", "print-id", sg.id + (sg.main_road ? " \u26a0" : ""), idb);
      tag.style.background = mine ? sg.color : tint(sg.color, 0.55);   // the same shade as its tag on the map
      // every street line in full (the addresses matter on paper), wrapping onto a second line if needed
      h("span", "", sg.lines.filter((l) => !l.warning).map((l) => l.text + (l.numbers ? " " + l.numbers : "")).join("; "), li);
      h("i", "", String(sg.houses), li);
    }
    const qr = h("div", "print-qr", null);   // goes beside the texting help, below, so the list gets the full width
    qr.dataset.group = g;
    h("div", "qr-slot", null, qr).style.cssText = "flex:none;width:1in;height:1in";   // the QR code goes here
    h("p", "", "Scan to set up your phone for " + leader.names[g] + ".", qr);
    // texting the dispatcher from the paper, written out for this group and this week
    const name = leader.names[g], wk = `Wk${week()}: ${name}`, ex = ids[0] || "W7";
    const help = h("div", "print-help", null, page);
    const tips = h("div", "print-texts", null, help);
    help.appendChild(qr);
    const th = h("b", "", "Texting the dispatcher \u2013 ", tips);
    if (settings.tel) th.append(showTel(settings.tel) + ":");
    else { h("span", "print-blank", "", th); th.append(":"); }   // no number on this phone: a line to write it on
    const tl = h("ul", "", null, tips);
    const tip = (when, text) => { const li = h("li", "", when + " ", tl); h("q", "", text, li); };
    if (week() === 1) {
      tip("Finished a segment:", `${wk} \u2013 ${ex} done`);
      tip("Out of bags:", `${wk} \u2013 send bags to ${ex}`);
      tip("Can\u2019t get to some:", `${wk} \u2013 ${ids.slice(0, 2).join(", ") || ex} need coverage`);
      tip("All done:", `${wk} available \u2013 a few bags left`);
    } else {
      h("li", "", "Tally the bags of food on the line by each segment as you pick them up.", tl);
      tip("Finished a segment, with its tally:", `${wk} \u2013 ${ex} done, 5 bags`);
      tip("Can\u2019t get to some:", `${wk} \u2013 ${ids.slice(0, 2).join(", ") || ex} need coverage`);
      tip("All done, and room for more:", `${wk} available to help`);
      tip("Optional second pass for late bags (only if there are new ones):", `${wk} \u2013 ${ex} second pass, 2 more bags`);
      tip("Taking the bags of food to Fire Station 5 (11020 Mueller Rd) when you\u2019re finished, or whenever the car fills up:", `${wk} heading to Fire Station 5`);
    }
  }
  // 2. each page's map, drawn in exactly the space its list and help leave (pages sit off screen, so they measure)
  const keep = { k, tx, ty };
  document.body.classList.add("printing");
  for (const [g, box] of boxes) {
    // leave about an inch spare: Safari on iPhone wraps the list and texting help onto more lines than measured here
    const W = Math.floor(box.clientWidth), H = Math.floor(box.clientHeight) - 96;
    if (W < 50 || H < 50) continue;
    box.style.flex = "none"; box.style.height = H + "px";
    document.body.style.setProperty("--print-w", W + "px"); document.body.style.setProperty("--print-h", H + "px");
    layout();
    const pad = 12, bw = bbox[2] - bbox[0], bh = bbox[3] - bbox[1];
    k = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    tx = (W - bw * k) / 2 - bbox[0] * k; ty = (H - bh * k) / 2 - bbox[1] * k;
    printStyle(g); printScale = 0.72; placedK = 0; commit(); printScale = 0;
    const map = svg.cloneNode(true);
    map.removeAttribute("id"); map.removeAttribute("style"); map.classList.add("print-map");
    map.setAttribute("viewBox", `${mx} ${my} ${W} ${H}`);
    // no fixed size: if the printer lays the list out taller than measured, the map shrinks instead of overlapping
    map.setAttribute("aria-label", `${den.name} map, ${leader.names[g]}'s segments starred`);
    box.appendChild(map);
  }
  // put the screen back the way it was
  document.body.classList.remove("printing");
  layout(); leaderStyle(); ({ k, tx, ty } = keep); placedK = 0; commit();
  for (const id in segEls) if (segEls[id].tagBox) segEls[id].tagBox.setAttribute("stroke", "none");
  loadQr().then(() => {
    for (const box of out.querySelectorAll(".print-qr")) box.querySelector(".qr-slot").appendChild(qrSvg(groupLink(Number(box.dataset.group))));
  }).catch(() => { /* no QR without the library: the page still prints */ }).then(() => window.print());
}

// The iPhone Home Screen app can't print, and Safari keeps its own storage, so hand over the split as a link:
// pasted into Safari it opens den leader mode with the same groups, ready to print.
function leaderLink() {
  const den = DATA.dens.find((d) => d.key === leader.den);
  const q = new URLSearchParams();
  if (settings.tel) q.set("tel", settings.tel.slice(2));
  q.set("lead", leader.den); q.set("n", leader.n);
  q.set("ln", leader.names.join("|"));
  q.set("la", den.segments.map((id) => leader.assign[id]).join(""));   // each segment's group, in den order
  return location.origin + location.pathname + location.search + "#" + q.toString();
}
function printFromSafari() {
  const link = leaderLink();
  groupPanel.textContent = "";
  const top = h("div", "card-top", null, groupPanel);
  h("h2", "", "Print from Safari", top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => slideOut(groupPanel));
  h("p", "hint", "The Home Screen app can\u2019t print on iPhone. Copy this link, paste it into Safari\u2019s address bar, then tap Print there. Your groups come with it.", groupPanel);
  const row = h("div", "move-row", null, groupPanel);
  const cp = iconBtn("copy", "Copy link", row);
  cp.addEventListener("click", () => {
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => { cp.say("\u2714\ufe0e Copied"); }).catch(() => { cp.say("Couldn\u2019t copy"); });
  });
  if (navigator.share) {
    const sh = iconBtn("share", "Share\u2026", row);
    sh.addEventListener("click", () => navigator.share({ title: "SFF 721 Map \u2013 den leader", url: link }).catch(() => {}));
  }
  slideIn(groupPanel);
}
// a den leader link (#lead=W&n=3&ln=Wolf A|Wolf B|Wolf C&la=0011…): save that split, then open den leader mode
let pendingLeader = null;
function applyLeaderLink(q) {
  const den = DATA.dens.find((d) => d.key === q.get("lead"));
  const n = Number(q.get("n")), la = q.get("la") || "";
  if (!den || !(n >= 1 && n <= 8) || la.length !== den.segments.length || !/^[0-7]+$/.test(la)) return false;
  const assign = {};
  den.segments.forEach((id, i) => { assign[id] = Math.min(Number(la[i]), n - 1); });
  const names = (q.get("ln") || "").split("|").map((x) => x.trim().slice(0, 24)).slice(0, n);
  leaderStore(den.key, { n, names, assign, edited: true, mode: splitMode() });
  pendingLeader = den.key;
  return true;
}

// A group's segments written out, for families walking from the paper map.
function showGroupList(i) {
  const ids = groupSegs(i);
  groupPanel.textContent = "";
  const top = h("div", "card-top", null, groupPanel);
  const t = h("h2", "", leader.names[i], top); t.style.color = GROUP_COLORS[i];
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => slideOut(groupPanel));
  const segList = h("ol", "gqr-segs", null, groupPanel);
  let total = 0;
  const text = [leader.names[i]];
  for (const id of ids) {
    const sg = segById(id); total += sg.houses;
    const li = h("li", "", null, segList);
    const head = h("div", "gqr-seg", null, li);
    h("b", "", (sg.main_road ? "\u26a0 " : "") + id, head); h("span", "", sg.houses + " houses", head);
    text.push(`${id} (${sg.houses} houses)`);
    for (const ln of sg.lines) {
      const line = ln.text + (ln.numbers ? " " + ln.numbers : "");
      h("div", "gqr-line", line, li); text.push("  " + line);
    }
  }
  const tot = h("li", "gqr-total", null, segList);
  h("b", "", "Total", tot); h("span", "", total + " houses", tot);
  text.push(`Total: ${total} houses`);
  const row = h("div", "move-row", null, groupPanel);
  const body = text.join("\n");
  if (navigator.share) {
    const sh = iconBtn("share", "Share list\u2026", row);
    sh.addEventListener("click", () => navigator.share({ title: leader.names[i], text: body }).catch(() => {}));
  }
  const pr = h("button", "share-btn", null, row); pr.type = "button";
  pr.appendChild(printIcon()); h("span", "", "Print\u2026", pr);
  pr.addEventListener("click", () => printHandouts(i));
  const cp = iconBtn("copy", "Copy list", row);
  cp.addEventListener("click", () => {
    (navigator.clipboard ? navigator.clipboard.writeText(body) : Promise.reject())
      .then(() => { cp.say("\u2714\ufe0e Copied"); }).catch(() => { cp.say("Couldn\u2019t copy"); });
  });
  slideIn(groupPanel);
}

function showGroupQr(i) {
  const link = groupLink(i);
  groupPanel.textContent = "";
  const top = h("div", "card-top", null, groupPanel);
  const t = h("h2", "", leader.names[i], top); t.style.color = GROUP_COLORS[i];
  h("span", "card-gap", null, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => slideOut(groupPanel));
  h("p", "hint", `${groupSegs(i).join(", ")}. A parent scans this to set up their phone for this group` +
    (settings.tel ? ", with the dispatcher\u2019s number." : ". (Add the dispatcher\u2019s number in settings to include it.)"), groupPanel);
  const box = h("div", "share-qr", null, groupPanel);
  loadQr().then(() => { box.textContent = ""; box.appendChild(qrSvg(link)); })
          .catch(() => { box.textContent = "QR code needs a signal the first time."; });
  const row = h("div", "move-row", null, groupPanel);
  if (navigator.share) {
    const sh = iconBtn("share", "Share link\u2026", row);
    sh.addEventListener("click", () => navigator.share({ title: "SFF 721 Map \u2013 " + leader.names[i], url: link }).catch(() => {}));
  }
  const cp = iconBtn("copy", "Copy link", row);
  cp.addEventListener("click", () => {
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
      .then(() => { cp.say("\u2714\ufe0e Copied"); }).catch(() => { cp.say("Couldn\u2019t copy"); });
  });
  slideIn(groupPanel);
}

// ---------- dispatcher: the walk's board, on one computer ----------
// Picked from the den drop-down, like Den leader. The whole pack's map, and a panel (beside the map on a
// computer, below it on a phone) where the dispatcher records what the texts say: a quick box by segment code
// (W6, W6 5, W6 +3, W6!, W6 #Wolf B, W6 u), a grid to edit, a passive list of groups from the names typed
// in, and exports. Saved on this computer only (localStorage, per week), with a backup file.
const DISPATCH = "DISPATCH";
const BOARD_KEY = "sff.board";
let dispatch = null;                     // {tab, sel, den, status, msg, undo} while in this mode
let board = {};                          // segment id -> {done, at, bags, bags2, cov, group}, this week
const dispatchPanel = document.getElementById("dispatch");
const dispatchWide = () => window.matchMedia("(min-width: 900px)").matches;

function boardAll() { try { return JSON.parse(localStorage.getItem(BOARD_KEY) || "{}") || {}; } catch (_) { return {}; } }
function loadBoard() { board = boardAll()[weekKey()] || {}; wasAllDone = DATA.segments.every((s) => (board[s.id] || {}).done); }
function saveBoard() {
  const all = boardAll(); all[weekKey()] = board;
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(all)); } catch (_) { /* ignore */ }
  // the last segment just got done: celebrate (once each time it goes from not-all-done to all done)
  const nowAll = DATA.segments.every((s) => segStatus(s.id) === "done");
  if (nowAll && wasAllDone === false && dispatch) setTimeout(celebrate, 300);
  wasAllDone = nowAll;
}
let wasAllDone = null;                    // null until first checked, so opening a finished board doesn't fire it
// "All done!": confetti in the den colours over the map, and a banner with the totals. Tap to close.
function celebrate() {
  const old = document.getElementById("celebrate"); if (old) old.remove();
  const t = totals();
  const box = document.createElement("div"); box.id = "celebrate";
  const cv = document.createElement("canvas"); box.appendChild(cv);
  const card2 = h("div", "cel-card", null, box);
  h("div", "cel-big", "All done!", card2);
  h("div", "cel-sub", week() === 2 ? `${t.bags.toLocaleString()} bags of food • ${t.houses.toLocaleString()} houses` : `Every one of ${t.houses.toLocaleString()} houses`, card2);
  h("div", "cel-thanks", "Thank you, Pack 721!", card2);
  const share = h("button", "share-btn", "Share the picture", card2); share.type = "button";
  share.addEventListener("click", (e) => { e.stopPropagation(); close(); dispatch.tab = "export"; dispatch.picMode = "done"; renderDispatch(); });
  document.body.appendChild(box);
  const close = () => { stop = true; box.classList.add("bye"); setTimeout(() => box.remove(), 400); };
  box.addEventListener("click", close);
  let stop = false;
  if (calm) return;                       // reduced motion: just the banner
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  const g = cv.getContext("2d"), cols = DATA.dens.map((d) => d.color).concat(["#ffffff", "#ffd21f"]);
  const bits = Array.from({ length: 220 }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.8, vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: (6 + Math.random() * 7) * dpr, hh: (4 + Math.random() * 5) * dpr,
    c: cols[Math.floor(Math.random() * cols.length)], wob: Math.random() * 6 }));
  const start = performance.now();
  const step = (now) => {
    if (stop) return;
    g.clearRect(0, 0, W, H);
    const fade = Math.max(0, Math.min(1, (9000 - (now - start)) / 1500));
    for (const b of bits) {
      b.x += b.vx + Math.sin((now / 400) + b.wob) * dpr; b.y += b.vy; b.r += b.vr;
      if (b.y > H + 20 && now - start < 6000) { b.y = -20; b.x = Math.random() * W; }
      g.save(); g.globalAlpha = fade; g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c;
      g.fillRect(-b.w / 2, -b.hh / 2, b.w, b.hh * Math.abs(Math.cos(b.r * 2)) + 1); g.restore();
    }
    if (fade > 0) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const rec = (id) => board[id] || {};
const segStatus = (id) => (rec(id).done ? "done" : rec(id).cov ? "cov" : "todo");
const bagsOf = (id) => (rec(id).bags || 0) + (rec(id).bags2 || 0);
// group names aren't case sensitive: "wolf b" is Wolf B. A name already on the board keeps its spelling.
const groupKey = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();
function knownGroups() {                  // every group name on the board, one spelling each
  const seen = new Map();
  for (const r of Object.values(board)) if (r.group && !seen.has(groupKey(r.group))) seen.set(groupKey(r.group), r.group);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
function groupName(n) {
  n = String(n || "").trim().replace(/\s+/g, " ");
  for (const r of Object.values(board)) if (r.group && groupKey(r.group) === groupKey(n)) return r.group;
  return n.replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase());   // a new name: "wolf a" -> "Wolf A"
}

function enterDispatch() {
  loadBoard();
  dispatch = { tab: "board", sel: null, den: "", status: "", msg: [], undo: null };
  selected = null; renderCard(); closeSheet(); slideOut(availPanel); slideOut(contactPanel);
  document.body.classList.add("dispatch");
  try { localStorage.setItem(STORE_KEY, DISPATCH); } catch (_) { /* ignore */ }
  denKey = PACK;
  draw();
  picker.value = DISPATCH;
  renderDispatch();
  slideIn(dispatchPanel);
  fit();
}
function exitDispatch(quiet) {
  dispatch = null;
  document.body.classList.remove("dispatch");
  slideOut(dispatchPanel);
  ants.style.display = "none";
  if (!quiet) pick(PACK);
}

// the map: grey until done, the den's colour when done (bags on the tag); "needs coverage" with no group yet
// gets the marching ants, so unassigned coverage stands out until someone takes it
function dispatchStyle() {
  const antsD = [];
  for (const id in segEls) {
    const e = segEls[id], st = segStatus(id), r = rec(id);
    e.faded = st === "todo";
    for (const [part, attr, colour, grey] of e.paint) part.setAttribute(attr, st === "todo" ? grey : colour);
    e.route.setAttribute("opacity", st === "done" ? 1 : 0.8); e.homes.setAttribute("opacity", 1);
    for (const x of e.extras) x.setAttribute("opacity", 1);
    if (e.tagText) {
      const n = bagsOf(id);
      e.tagText.textContent = e.tagLabel + (st === "done" ? " ✔︎" : "") + (n ? ` ${n}` : "");
      e.tagText.style.fill = "";
      const w = e.tagW[st === "done" ? 1 : 0] + (n ? String(n).length * 9 + 4 : 0);
      e.tagBox.setAttribute("x", -w / 2); e.tagBox.setAttribute("width", w);
      e.tagBox.setAttribute("stroke", st === "cov" ? "#d0021b" : e.seg.main_road ? "#222" : "#fff");
    }
    const sel = dispatch && dispatch.sel === id;
    e.halo.style.display = sel ? "" : "none";
    if (sel) { e.halo.setAttribute("stroke", "#111"); e.halo.setAttribute("stroke-opacity", 0.45); }
    if (st === "cov" && !r.group) antsD.push(e.d);
  }
  ants.style.display = antsD.length ? "" : "none";
  if (antsD.length) ants.setAttribute("d", antsD.join(""));
  for (const [, copy] of fxCopies) copy.remove();
  fxCopies = [];
  if (bbox) { placedK = 0; commit(); }
}

// ---- quick entry: "W6", "W6 5", "W6 +3", "W6!", "W6 5 #Wolf B", "W6 u"; several with commas ----
function parseQuick(text) {
  // each part: a segment code, then any of: a bag count (12), more bags (+3), ! (needs coverage), u (clear),
  // and #<group name> last. "W6 5 #Wolf A" = done with 5 bags, group Wolf A.
  const out = [];
  for (const part of text.split(/[,;\n]+/)) {
    if (!part.trim()) continue;
    const m = part.trim().match(/^([A-Za-z]+\s?\d+)\s*(.*)$/);
    if (!m) { out.push({ error: `Didn’t understand “${part.trim()}”. Start with a segment code, like W6.` }); continue; }
    const id = m[1].replace(/\s/g, "").toUpperCase();
    let rest = m[2].trim();
    if (!segById(id)) { out.push({ error: `There’s no segment ${id}.` }); continue; }
    const cmds = [];
    const g = rest.match(/(?:^|\s)#\s*(\S.*)$/);   // "#Wolf A"
    if (g) { cmds.push({ id, kind: "group", name: g[1].trim().slice(0, 24) }); rest = rest.slice(0, g.index).trim(); }
    let bad = null;
    for (const tok of rest ? rest.replace(/!/g, " ! ").trim().split(/\s+/) : []) {
      if (/^\d+$/.test(tok)) cmds.unshift({ id, kind: "bags", n: Number(tok) });
      else if (/^\+\d+$/.test(tok)) cmds.unshift({ id, kind: "more", n: Number(tok.slice(1)) });
      else if (tok === "!") cmds.unshift({ id, kind: "cov" });   // W9! = needs coverage
      else if (/^(u|undo|clear)$/i.test(tok)) cmds.unshift({ id, kind: "clear" });
      else { bad = tok; break; }
    }
    if (bad) { out.push({ error: `Didn’t understand “${bad}” after ${id}. Try W6 5, W6 +3, W6! or W6 #Wolf A.` }); continue; }
    if (!cmds.some((c) => c.kind !== "group")) cmds.unshift({ id, kind: cmds.length ? "group-only" : "done" });
    out.push(...cmds.filter((c) => c.kind !== "group-only"));
  }
  return out;
}
// what a command would overwrite, if anything (asked about before it changes)
function conflictOf(c) {
  const r = rec(c.id);
  if (c.kind === "bags" && (r.bags || 0) > 0 && r.bags !== c.n) return `${c.id} already has ${r.bags} bags.`;
  if (c.kind === "done" && r.done) return `${c.id} is already done.`;
  if (c.kind === "group" && r.group && groupKey(r.group) !== groupKey(c.name)) return `${c.id} is already with ${r.group}.`;
  return null;
}
function applyCmd(c, how) {               // how: "replace" | "add" for a conflict
  const r = { ...rec(c.id) }, now = Date.now();
  if (c.kind === "done") { r.done = true; r.cov = false; r.at = now; }
  else if (c.kind === "bags") { r.bags = how === "add" ? (r.bags || 0) + c.n : c.n; r.done = true; r.cov = false; r.at = now; }
  else if (c.kind === "more") { r.bags2 = (r.bags2 || 0) + c.n; r.at2 = now; }
  else if (c.kind === "cov") { r.cov = true; r.done = false; r.covAt = now; }
  else if (c.kind === "group") { r.group = groupName(c.name); r.groupAt = now; }
  else if (c.kind === "clear") { delete board[c.id]; return; }
  board[c.id] = r;
}
const describe = (c) => ({
  done: `${c.id} done`, bags: `${c.id} done, ${c.n} bag${c.n === 1 ? "" : "s"}`, more: `${c.id} +${c.n} second pass`,
  cov: `${c.id} needs coverage`, group: `${c.id} → ${rec(c.id).group || c.name}`, clear: `${c.id} cleared` }[c.kind]);
// A text from the app pasted in ("Wk2: Wolf A – W6 done, 5 bags") works too, as a quiet convenience:
// it becomes the same quick entries (done, bags, group, coverage, second pass). Other texts just get a note.
function textToQuick(line) {
  const m = line.trim().match(/^Wk\s*([12])\s*:\s*(.+?)\s+[–—-]\s+(.+)$/i) || line.trim().match(/^Wk\s*([12])\s*:\s*(.+?)\s+(available.*|heading to .*)$/i);
  if (!m) return null;
  const wk = Number(m[1]), group = m[2].trim().slice(0, 24), rest = m[3].trim();
  const note = (t) => ({ quick: "", notes: [t] });
  if (wk !== week()) return note(`That text is from Week ${wk}; this board is Week ${week()}.`);
  let r;
  if ((r = rest.match(/^([A-Za-z]+\d+) done(?:,\s*(\d+) bags?)?$/i))) return { quick: `${r[1]}${r[2] ? " " + r[2] : ""} #${group}`, notes: [] };
  if ((r = rest.match(/^([A-Za-z]+\d+) second pass,\s*(\d+) more bags?$/i))) return { quick: `${r[1]} +${r[2]} #${group}`, notes: [] };
  if ((r = rest.match(/^((?:[A-Za-z]+\d+)(?:\s*,\s*[A-Za-z]+\d+)*) needs? coverage$/i))) return { quick: r[1].split(/\s*,\s*/).map((id) => `${id}!`).join(", "), notes: [] };
  if (/^send bags to/i.test(rest)) return note(`${group} needs bags (${rest.replace(/^send bags to\s*/i, "")}).`);
  if (/^available/i.test(rest) || /^heading to/i.test(rest)) return note(`${group} is ${rest}.`);
  return note(`Couldn’t read that text: “${line.trim()}”.`);
}
function runQuick(text) {
  const notes = [];
  text = text.split(/\n+/).map((l) => { const t = textToQuick(l); if (!t) return l; notes.push(...t.notes); return t.quick; })
    .filter((l) => l.trim()).join(", ");
  const cmds = parseQuick(text);
  const before = {};                       // for one-step undo
  const done = [], asks = [], errors = [];
  for (const c of cmds) {
    if (c.error) { errors.push(c.error); continue; }
    if (!(c.id in before)) before[c.id] = board[c.id] ? { ...board[c.id] } : null;
    const clash = conflictOf(c);
    if (clash) { asks.push({ c, clash }); continue; }
    applyCmd(c); done.push(describe(c));
  }
  if (done.length) dispatch.undo = before;
  dispatch.msg = [...notes.map((t) => ({ note: t })), ...done.map((t) => ({ ok: t })), ...errors.map((t) => ({ err: t })), ...asks.map((a) => ({ ask: a }))];
  if (cmds.length && !errors.length && !asks.length) dispatch.sel = cmds[cmds.length - 1].id;
  saveBoard(); styleSegments(); renderDispatch();
  return !errors.length && !asks.length;
}
function dispatchSelect(id, fromMap) {
  dispatch.sel = id; dispatch.tab = "board";
  styleSegments(); renderDispatch();
  const q = dispatchPanel.querySelector(".dq-input");
  if (q && fromMap) { q.value = id + " "; q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  const row = dispatchPanel.querySelector(`tr[data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

function renderDispatch() {
  const keepScroll = dispatchPanel.querySelector(".dp-body") ? dispatchPanel.querySelector(".dp-body").scrollTop : 0;
  dispatchPanel.textContent = "";
  const top = h("div", "card-top", null, dispatchPanel);
  h("h2", "", `Dispatcher • Week ${week()}`, top);
  h("span", "card-gap", null, top);
  const x = h("button", "close", "✕", top); x.type = "button"; x.setAttribute("aria-label", "Leave dispatcher");
  x.addEventListener("click", () => exitDispatch());
  const tabs = h("div", "tabs dp-tabs", null, dispatchPanel);
  for (const [key, label] of [["board", "Board"], ["groups", "Groups"], ["export", "Export"]]) {
    const b = h("button", key === dispatch.tab ? "on" : "", label, tabs); b.type = "button";
    b.addEventListener("click", () => { dispatch.tab = key; renderDispatch(); });
  }
  totalsBar(dispatchPanel);
  const body = h("div", "dp-body", null, dispatchPanel);
  if (dispatch.tab === "board") boardTab(body);
  else if (dispatch.tab === "groups") groupsTab(body);
  else exportTab(body);
  body.scrollTop = keepScroll;
  if (!dispatchWide()) document.body.style.setProperty("--dispatch-h", dispatchPanel.getBoundingClientRect().height + "px");
}
function totals() {
  const ids = DATA.segments.map((s) => s.id);
  const done = ids.filter((id) => segStatus(id) === "done");
  return { segs: ids.length, done: done.length, houses: DATA.houses.length,
           housesDone: done.reduce((a, id) => a + segById(id).houses, 0),
           bags: ids.reduce((a, id) => a + bagsOf(id), 0), cov: ids.filter((id) => segStatus(id) === "cov").length };
}
function totalsBar(parent) {
  const t = totals();
  const bar = h("div", "dp-totals", null, parent);
  const cell = (big, small) => { const c = h("div", "", null, bar); h("b", "", big, c); h("span", "", small, c); };
  cell(`${t.housesDone.toLocaleString()} / ${t.houses.toLocaleString()}`, "houses done");
  cell(`${t.done} / ${t.segs}`, "segments");
  if (week() === 2) cell(t.bags.toLocaleString(), "bags of food");
  cell(String(t.cov), "need coverage");
}
function boardTab(body) {
  const qf = h("form", "dq", null, body);
  const q = h("input", "dq-input", null, qf);
  Object.assign(q, { type: "text", autocomplete: "off", spellcheck: false, placeholder: week() === 2 ? "W6 5 #Wolf B" : "W6 #Wolf B" });
  q.setAttribute("aria-label", "Quick entry by segment code");
  q.autocapitalize = "characters";
  // group names complete as you type "W6 g wo": a hint shows the match, Tab (or tapping it) fills it in; a new
  // name just keeps typing
  const hints = h("div", "dq-hints", null, body); hints.hidden = true;   // tappable matches, under the box
  const matches = () => {
    const m = q.value.match(/(?:^|,)\s*[A-Za-z]+\s?\d+[^,#]*#\s*([^,]*)$/);
    if (!m || !m[1].trim()) return null;
    const pre = groupKey(m[1]);
    const hits = knownGroups().filter((n) => groupKey(n).startsWith(pre) && groupKey(n) !== pre);
    return hits.length ? { hits, from: q.value.length - m[1].length } : null;
  };
  const fill = (name) => { const m = matches(); if (!m) return; q.value = q.value.slice(0, m.from) + name; showHints(); q.focus(); };
  const showHints = () => {
    const m = matches(); hints.hidden = !m; hints.textContent = "";
    if (!m) return;
    m.hits.slice(0, 6).forEach((n, i) => {
      const b = h("button", "dq-hint", n + (i === 0 ? "  \u21e5" : ""), hints); b.type = "button"; b.tabIndex = -1;
      b.addEventListener("mousedown", (e) => e.preventDefault());   // keep the box focused
      b.addEventListener("click", () => fill(n));
    });
  };
  q.addEventListener("input", showHints);
  q.addEventListener("keydown", (e) => { if (e.key === "Tab" && !e.shiftKey) { const m = matches(); if (m) { e.preventDefault(); fill(m.hits[0]); } } });
  q.addEventListener("paste", (e) => {   // several pasted texts: keep each on its own line
    const t = (e.clipboardData || window.clipboardData).getData("text");
    if (!/\n/.test(t)) return;
    e.preventDefault();
    runQuick(t);
  });
  const go = h("button", "share-btn", "Enter", qf); go.type = "submit";
  qf.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!q.value.trim()) return;
    if (runQuick(q.value)) { const n = dispatchPanel.querySelector(".dq-input"); if (n) { n.value = ""; n.focus(); } }
    else { const n = dispatchPanel.querySelector(".dq-input"); if (n) { n.value = q.value; n.focus(); } }
  });
  // the codes in a typewriter font, each with what it means
  const help = h("div", "dq-help", null, body);
  const items = week() === 2
    ? [["W6", "done"], ["W6 5", "done, 5 bags"], ["W6 +2", "2 more (second pass)"], ["W6!", "needs coverage"], ["#Wolf B", "group, after any of them"], ["W6 u", "clear"], [",", "several at once"]]
    : [["W6", "done"], ["W6!", "needs coverage"], ["#Wolf B", "group, after either"], ["W6 u", "clear"], [",", "several at once"]];
  for (const [code, what] of items) { const it = h("span", "", null, help); h("code", "", code, it); it.append(" " + what); }
  // what the last entry did, and anything to decide
  if (dispatch.msg.length || dispatch.undo) {
    const box = h("div", "dq-msg", null, body);
    for (const m of dispatch.msg) {
      if (m.note) h("p", "note", m.note, box);
      else if (m.ok) h("p", "ok", "✔︎ " + m.ok, box);
      else if (m.err) h("p", "err", m.err, box);
      else {
        const { c, clash } = m.ask;
        const p = h("p", "ask", clash + " ", box);
        const btn = (label, how) => {
          const b = h("button", "share-btn", label, p); b.type = "button";
          b.addEventListener("click", () => {
            if (how) { applyCmd(c, how); saveBoard(); }
            dispatch.msg = dispatch.msg.filter((x) => x !== m).concat(how ? [{ ok: describe(c) + (how === "add" ? " (added)" : "") }] : []);
            styleSegments(); renderDispatch();
          });
        };
        if (c.kind === "bags") { btn(`Replace with ${c.n}`, "replace"); btn(`Add ${c.n}`, "add"); }
        else if (c.kind === "group") btn(`Move to ${c.name}`, "replace");
        btn(c.kind === "done" ? "OK" : "Cancel", null);
      }
    }
    if (dispatch.undo) {
      const u = h("button", "dq-undo", "Undo last entry", box); u.type = "button";
      u.addEventListener("click", () => {
        for (const [id, r] of Object.entries(dispatch.undo)) { if (r) board[id] = r; else delete board[id]; }
        dispatch.undo = null; dispatch.msg = [{ ok: "Undone." }];
        saveBoard(); styleSegments(); renderDispatch();
      });
    }
  }
  // filters
  const f = h("div", "dp-filters", null, body);
  const den = h("select", "", null, f); den.setAttribute("aria-label", "Den");
  for (const [v, l] of [["", "All dens"], ...DATA.dens.map((d) => [d.key, d.short])]) { const o = h("option", "", l, den); o.value = v; }
  den.value = dispatch.den;
  den.addEventListener("change", () => { dispatch.den = den.value; renderDispatch(); });
  const stat = h("select", "", null, f); stat.setAttribute("aria-label", "Status");
  for (const [v, l] of [["", "Any status"], ["todo", "To do"], ["done", "Done"], ["cov", "Needs coverage"]]) { const o = h("option", "", l, stat); o.value = v; }
  stat.value = dispatch.status;
  stat.addEventListener("change", () => { dispatch.status = stat.value; renderDispatch(); });
  // the names already used, offered as you type in a Group cell
  const dl = h("datalist", "", null, body); dl.id = "dp-groups-list";
  for (const n of knownGroups()) { const op = h("option", "", null, dl); op.value = n; }
  // the grid
  const wk2 = week() === 2;
  const table = h("table", "dp-grid", null, body);
  const hr = h("tr", "", null, h("thead", "", null, table));
  for (const l of ["Seg", "Status", ...(wk2 ? ["Bags", "2nd"] : []), "Group", "Street", "Hses"]) h("th", "", l, hr);   // inputs next to the ID
  const tb = h("tbody", "", null, table);
  for (const d of DATA.dens) {
    if (dispatch.den && d.key !== dispatch.den) continue;
    const ids = d.segments.filter((id) => !dispatch.status || segStatus(id) === dispatch.status);
    if (!ids.length) continue;
    const sub = h("tr", "dp-den", null, tb);
    const dd = d.segments.filter((id) => segStatus(id) === "done");
    const subBags = d.segments.reduce((a, id) => a + bagsOf(id), 0);
    const sc = h("td", "", `${d.short}: ${dd.length} of ${d.segments.length} done` + (wk2 ? ` • ${subBags} bags` : ""), sub);
    sc.colSpan = wk2 ? 7 : 5; sc.style.borderLeftColor = d.color;
    for (const id of ids) {
      const sg = segById(id), r = rec(id), st = segStatus(id);
      const tr = h("tr", "st-" + st + (dispatch.sel === id ? " sel" : ""), null, tb);
      tr.dataset.id = id;
      if (r.at || r.covAt) tr.title = "Entered " + new Date(r.at || r.covAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const idc = h("td", "", null, tr); chip(sg, idc);
      idc.addEventListener("click", () => dispatchSelect(id, false));
      const sc2 = h("td", "", null, tr);
      const ss = h("select", "", null, sc2); ss.setAttribute("aria-label", `Status of ${id}`);
      for (const [v, l] of [["todo", "–"], ["done", "Done"], ["cov", "Coverage"]]) { const o = h("option", "", l, ss); o.value = v; }
      ss.value = st;
      ss.addEventListener("change", () => {
        dispatch.undo = { [id]: board[id] ? { ...board[id] } : null };
        const nr = { ...rec(id), done: ss.value === "done", cov: ss.value === "cov" };
        if (ss.value === "done") nr.at = Date.now(); if (ss.value === "cov") nr.covAt = Date.now();
        board[id] = nr; dispatch.msg = [{ ok: `${id}: ${ss.options[ss.selectedIndex].text}` }];
        saveBoard(); styleSegments(); renderDispatch();
      });
      const numCell = (key) => {
        const c = h("td", "", null, tr);
        const inp = h("input", "num-in", null, c);
        Object.assign(inp, { type: "text", inputMode: "numeric", value: r[key] ? String(r[key]) : "" });
        inp.setAttribute("aria-label", `${key === "bags" ? "Bags" : "Second pass bags"} for ${id}`);
        inp.addEventListener("change", () => {
          dispatch.undo = { [id]: board[id] ? { ...board[id] } : null };
          const n = Number(inp.value.replace(/\D/g, "")) || 0, nr = { ...rec(id) };
          nr[key] = n; if (key === "bags" && n && !nr.done) { nr.done = true; nr.cov = false; nr.at = Date.now(); }
          board[id] = nr; dispatch.msg = [{ ok: `${id} ${key === "bags" ? "bags" : "second pass"}: ${n}` }];
          saveBoard(); styleSegments(); renderDispatch();
        });
      };
      if (wk2) { numCell("bags"); numCell("bags2"); }
      const gc = h("td", "", null, tr);
      const gi = h("input", "grp-in", null, gc);
      Object.assign(gi, { type: "text", value: r.group || "", maxLength: 24, placeholder: "", autocomplete: "off" });
      gi.setAttribute("list", "dp-groups-list");   // suggests the names already used; a new one can still be typed
      gi.setAttribute("aria-label", `Group for ${id}`);
      gi.addEventListener("change", () => {
        dispatch.undo = { [id]: board[id] ? { ...board[id] } : null };
        const nr = { ...rec(id) }; const v = gi.value.trim();
        if (v) { nr.group = groupName(v); nr.groupAt = Date.now(); } else delete nr.group;
        board[id] = nr; dispatch.msg = [{ ok: v ? `${id} → ${v}` : `${id}: no group` }];
        saveBoard(); styleSegments(); renderDispatch();
      });
      const first = sg.lines.find((l) => !l.warning);
      h("td", "street", first ? first.text : "", tr).addEventListener("click", () => dispatchSelect(id, false));
      h("td", "num", String(sg.houses), tr);
    }
  }
  if (dispatchWide() && !dispatch.msg.some((m) => m.ask)) setTimeout(() => { const n = dispatchPanel.querySelector(".dq-input"); if (n && document.activeElement === document.body) n.focus(); }, 0);
}
// groups, worked out from the names typed in (no setup). A group's den is the den of the segments it was given,
// not ones it was sent to cover (marked needs coverage before it got a group). Groups aren't known ahead, so
// each one's share of its den is guessed: the den's segments less what the den's other groups have finished.
// The guess (~) firms up as segments get done, and is exact once the whole den is.
function groupsTab(body) {
  const wk2 = week() === 2;
  const unassigned = DATA.segments.filter((s) => segStatus(s.id) === "cov" && !rec(s.id).group).map((s) => s.id);
  if (unassigned.length) h("p", "dp-alert", `Needs coverage, no group yet: ${unassigned.join(", ")}`, body);
  const covering = (id) => !!rec(id).covAt && (!rec(id).groupAt || rec(id).covAt <= rec(id).groupAt);
  const groups = {};
  for (const s of DATA.segments) { const g = rec(s.id).group; if (g) (groups[groupName(g)] ||= []).push(s.id); }
  const names = Object.keys(groups);
  if (!names.length) h("p", "hint", "Groups show up here as you type their names on segments (W6 #Wolf B, or the Group column).", body);
  const homeOf = (ids) => {
    const own = ids.filter((id) => !covering(id)), count = {};
    for (const id of own.length ? own : ids) count[segById(id).den] = (count[segById(id).den] || 0) + 1;
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  };
  const home = Object.fromEntries(names.map((n) => [n, homeOf(groups[n])]));
  const denOrder = DATA.dens.map((d) => d.key);
  names.sort((a, b) => denOrder.indexOf(home[a]) - denOrder.indexOf(home[b]) || a.localeCompare(b, undefined, { numeric: true }));
  const isDone = (id) => segStatus(id) === "done";
  const table = h("table", "dp-grid dp-groups", null, body);
  const hr = h("tr", "", null, h("thead", "", null, table));
  for (const l of ["Group", "Den", "Segments", "Done", ...(wk2 ? ["Bags"] : [])]) h("th", "", l, hr);
  const tb = h("tbody", "", null, table);
  for (const n of names) {
    const ids = groups[n], d = DATA.dens.find((x) => x.key === home[n]);
    const own = ids.filter((id) => segById(id).den === d.key && !covering(id));
    const help = ids.filter((id) => !own.includes(id));
    // the den's segments, less those the den's other groups have finished
    const others = names.filter((m) => m !== n && home[m] === d.key);
    const othersDone = d.segments.filter((id) => isDone(id) && others.some((m) => groupKey(m) === groupKey(rec(id).group))).length;
    const share = d.segments.length - othersDone;
    const exact = d.segments.every(isDone);
    const tr = h("tr", "", null, tb);
    h("td", "", n, tr);
    const dc = h("td", "", d.short, tr); dc.style.color = d.color; dc.style.fontWeight = "700";
    const sc = h("td", "segs", null, tr);
    for (const id of own) { h("span", isDone(id) ? "done-seg" : "", id, sc); sc.append(" "); }
    for (const id of help) { const sp = h("span", "cov-seg", id, sc); sp.title = "sent to cover"; sc.append(" "); }
    const doneOwn = own.filter(isDone).length;
    h("td", "num", `${doneOwn} of ${exact ? "" : "~"}${Math.max(share, own.length)}` + (help.length ? ` +${help.filter(isDone).length}` : ""), tr);
    if (wk2) h("td", "num", String(ids.reduce((a, id) => a + bagsOf(id), 0)), tr);
  }
  // segments done with no group name, by den: someone finished them, we don't know who
  for (const d of DATA.dens) {
    const ids = d.segments.filter((id) => isDone(id) && !rec(id).group);
    if (!ids.length) continue;
    const tr = h("tr", "unlabeled", null, tb);
    h("td", "", `Unlabeled ${d.short}`, tr);
    const dc = h("td", "", d.short, tr); dc.style.color = d.color; dc.style.fontWeight = "700";
    const sc = h("td", "segs", null, tr);
    for (const id of ids) { h("span", "done-seg", id, sc); sc.append(" "); }
    h("td", "num", String(ids.length), tr);
    if (wk2) h("td", "num", String(ids.reduce((a, id) => a + bagsOf(id), 0)), tr);
  }
  h("p", "hint", "“3 of ~18”: done of about how many – the den’s segments less what its other groups have finished, so it firms up as the den gets done. Red segments were covering for another group (+ counts them).", body);
}
function exportTab(body) {
  // a picture to share: progress for the group chat during the walk, or the finished map for social media
  h("h3", "", "Share picture", body);
  const t = totals();
  if (!dispatch.picMode) dispatch.picMode = t.done === t.segs ? "done" : "progress";
  const opts = h("div", "dp-filters", null, body);
  const mode = h("select", "", null, opts); mode.setAttribute("aria-label", "Picture");
  for (const [v, l] of [["progress", "Progress (group chat)"], ["done", "Finished (social media)"]]) { const o = h("option", "", l, mode); o.value = v; }
  mode.value = dispatch.picMode;
  const size = h("select", "", null, opts); size.setAttribute("aria-label", "Size");
  for (const [v, l] of [["1600x1200", "Wide 1600×1200"], ["1080x1080", "Square 1080×1080"]]) { const o = h("option", "", l, size); o.value = v; }
  size.value = dispatch.picSize || "1600x1200";
  const img = h("img", "dp-pic", null, body); img.alt = "Preview of the picture";
  const paint = () => {
    dispatch.picMode = mode.value; dispatch.picSize = size.value;
    const [W, H] = size.value.split("x").map(Number);
    img.src = shareCanvas(mode.value, W, H).toDataURL("image/png");
  };
  mode.addEventListener("change", paint); size.addEventListener("change", paint);
  paint();
  const prow = h("div", "move-row", null, body);
  const name = () => `sff-week${week()}-${dispatch.picMode === "done" ? "finished" : "progress"}.png`;
  const blob = () => new Promise((ok) => { const [W, H] = size.value.split("x").map(Number); shareCanvas(mode.value, W, H).toBlob(ok, "image/png"); });
  iconBtn("download", "Save picture", prow).addEventListener("click", () => blob().then((b) => download(name(), "image/png", b)));
  if (navigator.canShare) {
    const sh = iconBtn("share", "Share…", prow);
    sh.addEventListener("click", () => blob().then((b) => {
      const file = new File([b], name(), { type: "image/png" });
      if (navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(() => {});
      else download(name(), "image/png", b);
    }));
  }
  // a spreadsheet: a Dens sheet with totals, and a Segments sheet
  h("h3", "", "Spreadsheet", body);
  const row = h("div", "move-row", null, body);
  iconBtn("download", "Excel (.xlsx)", row).addEventListener("click", () => download(`sff-week${week()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx([["Dens", densRows()], ["Segments", segmentsRows()]])));
  backupTools(body);
}
// ---- CSV ----
const stamp = (t) => (t ? new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "");
function segmentsRows() {
  const rows = [["Den", "Segment", "Status", ...(week() === 2 ? ["Bags", "2nd pass"] : []), "Group", "Houses", "Streets", "Entered"]];
  for (const d of DATA.dens) for (const id of d.segments) {
    const sg = segById(id), r = rec(id), st = segStatus(id);
    rows.push([d.short, id, { done: "Done", cov: "Needs coverage", todo: "" }[st], ...(week() === 2 ? [r.bags || "", r.bags2 || ""] : []), r.group || "",
               sg.houses, sg.lines.filter((l) => !l.warning).map((l) => l.text + (l.numbers ? " " + l.numbers : "")).join("; "), stamp(r.at || r.covAt)]);
  }
  return rows;
}
function densRows() {
  const rows = [["Den", "Segments", "Done", "Houses", "Houses done", "% done", ...(week() === 2 ? ["Bags"] : []), "Need coverage"]];
  for (const d of DATA.dens) {
    const done = d.segments.filter((id) => segStatus(id) === "done");
    const hd = done.reduce((a, id) => a + segById(id).houses, 0);
    rows.push([d.short, d.segments.length, done.length, d.houses, hd, { pct: hd / d.houses },
               ...(week() === 2 ? [d.segments.reduce((a, id) => a + bagsOf(id), 0)] : []), d.segments.filter((id) => segStatus(id) === "cov").length]);
  }
  const t = totals();
  rows.push([{ total: "Total" }, t.segs, t.done, t.houses, t.housesDone, { pct: t.housesDone / t.houses }, ...(week() === 2 ? [t.bags] : []), t.cov]);
  return rows;
}
// ---- Excel: a small .xlsx made here (a zip of a few XML files, stored without compression) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipFiles(files) {                // [[name, text]] -> Blob, "stored" entries
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    parts.push(new Uint8Array(head), nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length),
                                 ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += head.length + nb.length + data.length;
  }
  const csize = central.reduce((a, x) => a + x.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
// sheets: [[name, rows]]; row 1 is the header. A cell can be a number, text, {pct: 0.5} (shown as 50%) or
// {total: "Total"} (marks a bold total row). Styled: a dark header row frozen at the top with filters, banded
// rows, widths to fit, percentages, a bold total.
function xlsx(sheets) {
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // styles: 0 plain, 1 header, 2 banded, 3 % , 4 % banded, 5 total, 6 total %
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0%"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF14213D"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F4F9"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F5"/></patternFill></fill></fills>' +
    '<borders count="2"><border/><border><top style="thin"><color rgb="FF14213D"/></top></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="3" borderId="0" applyNumberFormat="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="2" fillId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '</cellXfs></styleSheet>';
  const sheetXml = (rows) => {
    const ncol = rows[0].length;
    const width = (i) => Math.min(60, Math.max(8, ...rows.map((r) => {
      const v = r[i]; const t = v && typeof v === "object" ? (v.total || "100%") : v == null ? "" : String(v);
      return t.length * 1.1 + 2;
    })));
    const cols = "<cols>" + rows[0].map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i).toFixed(1)}" customWidth="1"/>`).join("") + "</cols>";
    const body = rows.map((r, ri) => {
      const total = r.some((v) => v && typeof v === "object" && "total" in v), band = ri > 0 && ri % 2 === 0;
      return `<row r="${ri + 1}"${ri === 0 ? ' ht="20" customHeight="1"' : ""}>` + r.map((v, ci) => {
        const ref = col(ci) + (ri + 1);
        let st = ri === 0 ? 1 : total ? 5 : band ? 2 : 0;
        if (v && typeof v === "object" && "pct" in v) { st = total ? 6 : band ? 4 : 3; return `<c r="${ref}" s="${st}"><v>${v.pct}</v></c>`; }
        if (v && typeof v === "object" && "total" in v) v = v.total;
        if (v === "" || v == null) return `<c r="${ref}" s="${st}"/>`;
        return typeof v === "number" ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join("") + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      cols + `<sheetData>${body}</sheetData><autoFilter ref="A1:${col(ncol - 1)}${rows.length}"/></worksheet>`;
  };
  const files = [
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(([n], i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + "</sheets>" +
      '<definedNames>' + sheets.map(([n, rows], i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(n)}'!$A$1:$${col(rows[0].length - 1)}$${rows.length}</definedName>`).join("") + '</definedNames></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows)]),
  ];
  return zipFiles(files);
}
// letters drawn as tube strokes on a 4 x 6 grid (y down), rounded like bent neon
const TUBE = {
  P: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
  A: [[[0, 6], [0, 1.5], [1.5, 0], [2.5, 0], [4, 1.5], [4, 6]], [[0, 3.5], [4, 3.5]]],
  C: [[[4, 0.8], [3.2, 0], [0.8, 0], [0, 0.8], [0, 5.2], [0.8, 6], [3.2, 6], [4, 5.2]]],
  K: [[[0, 0], [0, 6]], [[4, 0], [0.4, 3.2]], [[1.4, 2.4], [4, 6]]],
  7: [[[0, 0], [4, 0], [4, 1], [1.5, 6]]],
  2: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2.2], [0, 6], [4, 6]]],
  1: [[[0.8, 1.2], [2, 0], [2, 6]], [[0.8, 6], [3.2, 6]]],
};
// words: [[text, colour]], right-aligned at x, top at y, letters h tall
function neonWord(g, words, x, y, h, u) {
  const k = h / 6, adv = 4 * k + 0.9 * k, space = 1.6 * k;
  const total = words.reduce((a, [t], i) => a + t.length * adv + (i ? space : 0), 0) - 0.9 * k;
  let cx = x - total;
  g.lineCap = "round"; g.lineJoin = "round";
  words.forEach(([text, col], wi) => {
    if (wi) cx += space;
    for (const ch of text) {
      for (const [blur, width, colour, alpha] of [[22, 6.5, col, 1], [8, 4.5, col, 1], [0, 1.6, "#ffffff", 0.8]]) {
        g.save(); g.globalAlpha = alpha; g.shadowColor = col; g.shadowBlur = blur * u; g.strokeStyle = colour; g.lineWidth = width * u;
        for (const line of TUBE[ch] || []) {
          g.beginPath(); line.forEach(([px, py], i) => { const X0 = cx + px * k, Y0 = y + py * k; if (i) g.lineTo(X0, Y0); else g.moveTo(X0, Y0); }); g.stroke();
        }
        g.restore();
      }
      cx += adv;
    }
  });
}
// ---- the share picture, drawn on a canvas: a dark "mission control" look ----
// Glowing segments in den colours over a faint street grid, a title, big totals, and a bar per den.
// Progress (for the group chat) dims what's left and pulses coverage red; Finished (for social media) lights
// every den up with its total.
function shareCanvas(mode, W, H) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const u = Math.min(W, H) / 1080;
  const font = (px, weight) => `${weight || 700} ${Math.round(px * u)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  const t = totals(), wk2 = week() === 2, done = mode === "done";
  const pct = Math.round(100 * t.housesDone / t.houses);
  // background: deep navy, a soft glow in the middle, a fine grid
  const bg = g.createRadialGradient(W * 0.4, H * 0.55, 0, W * 0.4, H * 0.55, Math.max(W, H) * 0.8);
  bg.addColorStop(0, "#14213d"); bg.addColorStop(1, "#070b16");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(120,170,255,.06)"; g.lineWidth = 1;
  for (let x = 0; x < W; x += 40 * u) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 40 * u) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // layout: wide = map left, stats right; square = map top, stats below
  const wide = W / H > 1.2;
  const foot = done ? 120 * u : 60 * u;   // finished: room for the thank-you banner
  const map = wide ? { x: 30 * u, y: 150 * u, w: W * 0.6, h: H - 150 * u - foot - 10 * u } : { x: 30 * u, y: 150 * u, w: W - 60 * u, h: H * 0.48 - (done ? 40 * u : 0) };
  const side = wide ? { x: map.x + map.w + 30 * u, y: 150 * u, w: W - map.w - 90 * u } : { x: 40 * u, y: map.y + map.h + 20 * u, w: W - 80 * u };
  // title
  const day = new Date(WEEK_DAYS[week()] + "T12:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.fillStyle = "#7fb2ff"; g.font = font(28, 800);
  g.fillText((done ? `SCOUTING FOR FOOD • ${day}` : `SCOUTING FOR FOOD • LIVE • ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`).toUpperCase(), 40 * u, 62 * u);
  g.fillStyle = "#fff"; g.font = font(58, 800);
  g.fillText(done ? (wk2 ? `${t.bags.toLocaleString()} bags of food collected` : `${t.housesDone.toLocaleString()} houses reached`) : `Pack 721 is ${pct}% done`, 40 * u, 122 * u);
  // the map
  const pts = DATA.houses.map((hh) => P(hh.lonlat));
  const bx = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const sc = Math.min(map.w / (bx[2] - bx[0]), map.h / (bx[3] - bx[1]));
  const ox = map.x + (map.w - (bx[2] - bx[0]) * sc) / 2 - bx[0] * sc, oy = map.y + (map.h - (bx[3] - bx[1]) * sc) / 2 - bx[1] * sc;
  const X = (p) => [ox + p[0] * sc, oy + p[1] * sc];
  const path = (ptsL) => { g.beginPath(); ptsL.forEach((p, i) => { const [x, y] = X(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); };
  g.lineCap = "round"; g.lineJoin = "round";
  g.save(); g.beginPath(); g.rect(map.x - 20 * u, map.y - 20 * u, map.w + 40 * u, map.h + 40 * u); g.clip();
  g.strokeStyle = "rgba(140,170,220,.16)"; g.lineWidth = 2 * u;
  for (const st of DATA.streets) { path(st.line.map(P)); g.stroke(); }
  g.strokeStyle = "rgba(140,170,220,.3)"; g.lineWidth = 4 * u;
  for (const a of DATA.arterials) { path(a.line.map(P)); g.stroke(); }
  const den = Object.fromEntries(DATA.dens.map((d) => [d.key, d]));
  // left to do: dim; done: the den's colour with a glow; coverage (progress only): red glow
  for (const pass of ["todo", "cov", "on"]) for (const s of DATA.segments) {
    const st = segStatus(s.id), on = done || st === "done";
    const kind = on ? "on" : st === "cov" ? "cov" : "todo";
    if (kind !== pass) continue;
    const col = kind === "on" ? den[s.den].color : kind === "cov" ? "#ff3b5c" : "rgba(160,180,210,.35)";
    for (const r of [s.route, ...s.route_parts]) {
      path(r.map(P));
      if (kind !== "todo") { g.shadowColor = col; g.shadowBlur = 18 * u; g.strokeStyle = col; g.lineWidth = 8 * u; g.stroke(); }
      g.shadowBlur = 0; g.strokeStyle = kind === "todo" ? col : col; g.lineWidth = (kind === "todo" ? 5 : 6) * u; g.stroke();
      if (kind === "on") { g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1.6 * u; g.stroke(); }   // a bright core
    }
  }
  // Fire Station 5 in Week 2: a small beacon
  const fire = DATA.landmarks.find((lm) => lm.icon === "fire");
  if (wk2 && fire) {
    const [fx, fy] = X(P(fire.lonlat));
    g.shadowColor = "#ff6b3d"; g.shadowBlur = 20 * u; g.fillStyle = "#ff6b3d";
    g.beginPath(); g.arc(fx, fy, 7 * u, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    g.fillStyle = "#ffb199"; g.font = font(22, 700); g.textAlign = "left"; g.fillText("Fire Station 5", fx + 12 * u, fy + 5 * u);
  }
  g.restore();
  // stats: big tiles, then a bar per den
  const tile = (x, y, w, big, small, col) => {
    g.fillStyle = "rgba(255,255,255,.05)"; g.strokeStyle = "rgba(127,178,255,.25)"; g.lineWidth = 1.5 * u;
    g.beginPath(); g.roundRect(x, y, w, 100 * u, 14 * u); g.fill(); g.stroke();
    g.textAlign = "left"; g.fillStyle = col || "#fff"; g.font = font(46, 800); g.fillText(big, x + 18 * u, y + 54 * u);
    g.fillStyle = "#a9bcda"; g.font = font(21, 700); g.fillText(small.toUpperCase(), x + 18 * u, y + 84 * u);
  };
  const tiles = wk2 ? [[t.bags.toLocaleString(), "bags of food", "#6ef2b4"], [`${pct}%`, "houses done", "#7fb2ff"]]
                    : [[t.housesDone.toLocaleString(), "houses reached", "#6ef2b4"], [`${pct}%`, "of the area", "#7fb2ff"]];
  const tw = (side.w - 16 * u) / 2;
  tiles.forEach(([big, small, col], i) => tile(side.x + i * (tw + 16 * u), side.y, tw, big, small, col));
  // per den: name, a glowing bar of houses done, and its number
  // wide: one column of bars; square: two columns of three
  const cols = wide ? 1 : 2, perCol = Math.ceil(DATA.dens.length / cols), colW = (side.w - (cols - 1) * 30 * u) / cols;
  const rowsY = side.y + 132 * u, rowH = Math.min(92 * u, (H - rowsY - foot - 16 * u) / perCol);
  DATA.dens.forEach((d, i) => {
    const y = rowsY + (i % perCol) * rowH, sx = side.x + Math.floor(i / perCol) * (colW + 30 * u);
    const side_ = { x: sx, w: colW };
    const hd = d.segments.filter((id) => segStatus(id) === "done").reduce((a, id) => a + segById(id).houses, 0);
    const frac = done ? 1 : hd / d.houses, bags = d.segments.reduce((a, id) => a + bagsOf(id), 0);
    const label = wk2 ? `${bags.toLocaleString()} bags` : done ? `${d.houses} houses` : `${Math.round(100 * frac)}%`;
    g.textAlign = "left"; g.fillStyle = d.color; g.font = font(30, 800); g.fillText(d.short, side_.x, y + 30 * u);
    g.textAlign = "right"; g.fillStyle = "#eef3fb"; g.font = font(28, 800); g.fillText(label, side_.x + side_.w, y + 30 * u);
    const by = y + 42 * u, bh = 12 * u;
    g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.roundRect(side_.x, by, side_.w, bh, bh / 2); g.fill();
    if (frac > 0) {
      g.shadowColor = d.color; g.shadowBlur = 14 * u; g.fillStyle = d.color;
      g.beginPath(); g.roundRect(side_.x, by, Math.max(bh, side_.w * frac), bh, bh / 2); g.fill(); g.shadowBlur = 0;
    }
  });
  // footer. Finished: a glowing thank-you banner across the bottom. Progress: just the pack and any coverage.
  if (done) {
    const bx = 40 * u, by = H - foot + 10 * u, bw = W - 80 * u, bh = foot - 36 * u;
    const grad = g.createLinearGradient(bx, 0, bx + bw, 0);
    DATA.dens.forEach((d, i) => grad.addColorStop(i / (DATA.dens.length - 1), d.color));
    g.shadowColor = "rgba(127,178,255,.55)"; g.shadowBlur = 24 * u;
    g.fillStyle = "rgba(10,16,32,.85)"; g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = grad; g.lineWidth = 3 * u; g.stroke();
    g.textAlign = "center"; g.textBaseline = "middle";
    let fs = 38; g.font = font(fs, 800);
    const msg = "Thank you to every scout, family and neighbor!";
    while (g.measureText(msg).width > bw - 60 * u && fs > 20) { fs -= 2; g.font = font(fs, 800); }
    g.fillStyle = "#fff"; g.shadowColor = "rgba(255,255,255,.35)"; g.shadowBlur = 10 * u;
    g.fillText(msg, bx + bw / 2, by + bh / 2 + 1 * u); g.shadowBlur = 0;
    // "PACK 721" drawn as glowing tubes, like the segments: PACK in one den's colour, 7, 2 and 1 in three others
    neonWord(g, [["PACK", DATA.dens[1].color], ["7", DATA.dens[2].color], ["2", DATA.dens[3].color], ["1", DATA.dens[5].color]],
             W - 44 * u, 34 * u, 40 * u, u);
  } else {
    g.textAlign = "left"; g.fillStyle = "#8ea4c6"; g.font = font(22, 700);
    g.fillText("Pack 721", 40 * u, H - 24 * u);
  }
  if (!done && t.cov) { g.textAlign = "right"; g.fillStyle = "#ff7d93"; g.fillText(`${t.cov} segment${t.cov === 1 ? "" : "s"} need coverage`, W - 40 * u, H - 24 * u); }
  return c;
}
// backup: the whole board (both weeks) as a file, to keep or move to another computer
function backupTools(body) {
  h("h3", "", "Backup", body);
  h("p", "hint", "Everything is saved in this browser only. Save a backup now and then, or to move to another computer.", body);
  const row = h("div", "move-row", null, body);
  const sv = iconBtn("download", "Save backup", row);
  sv.addEventListener("click", () => download(`sff-board-${today()}.json`, "application/json", JSON.stringify({ sff: "board", saved: new Date().toISOString(), board: boardAll() }, null, 1)));
  const ld = h("label", "share-btn file-btn", null, row);
  ld.appendChild(iconBtn("upload", "", document.createElement("div")).querySelector("svg"));   // the same icon, on a label
  h("span", "", "Restore\u2026", ld);
  const fi = h("input", "", null, ld); fi.type = "file"; fi.accept = ".json,application/json";
  fi.addEventListener("change", () => {
    const f = fi.files && fi.files[0]; if (!f) return;
    f.text().then((t) => {
      const v = JSON.parse(t);
      if (!v || v.sff !== "board" || typeof v.board !== "object") throw new Error("not a board backup");
      if (!confirm("Replace this computer’s board with the backup from " + (v.saved || "the file").slice(0, 16).replace("T", " ") + "?")) return;
      localStorage.setItem(BOARD_KEY, JSON.stringify(v.board));
      loadBoard(); dispatch.msg = [{ ok: "Restored the backup." }]; dispatch.tab = "board";
      styleSegments(); renderDispatch();
    }).catch(() => { alert("That file isn’t a board backup."); });
  });
}
function download(name, type, data) {    // a file to save, made here (nothing is uploaded)
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
window.addEventListener("resize", () => { if (dispatch) { renderDispatch(); fit(true); } });

// ---------- den picker ----------
const picker = document.getElementById("den");
function pick(key, instant) {
  denKey = key;
  if (selected && !(denKey === PACK || DATA.dens.find((d) => d.key === key).segments.includes(selected) || isTracked(selected))) {
    selected = null; renderCard();
  }
  try { localStorage.setItem(STORE_KEY, key); } catch (_) { /* private mode: just don't remember */ }
  picker.value = key;
  draw();
  if (!instant) commit();                // place the new den's labels at the current view, then glide to it
  fit(instant);
}
// Picking a den shows all of it. Picking the den you're already on doesn't fire "change", so opening the
// list and closing it without a change also zooms back out to the whole den (there's no separate button).
let pickerChanged = false;
picker.addEventListener("focus", () => { pickerChanged = false; });
picker.addEventListener("change", () => {
  pickerChanged = true;
  if (picker.value === LEADER) { if (dispatch) exitDispatch(true); enterLeader(); return; }
  if (picker.value === DISPATCH) { if (leader) exitLeader(true); enterDispatch(); return; }
  if (leader) exitLeader(true);
  if (dispatch) exitDispatch(true);
  pick(picker.value);
});
picker.addEventListener("blur", () => { if (!pickerChanged) fit(); });

function start(data) {
  DATA = data;
  for (const d of data.dens) {
    const o = document.createElement("option");
    o.value = d.key; o.textContent = d.short;
    picker.appendChild(o);
  }
  const o = document.createElement("option");
  o.value = PACK; o.textContent = "Whole pack";
  picker.appendChild(o);
  const lo = document.createElement("option");
  lo.value = LEADER; lo.textContent = "Den leader";
  picker.appendChild(lo);
  const dop = document.createElement("option");
  dop.value = DISPATCH; dop.textContent = "Dispatcher";
  picker.appendChild(dop);
  const ok = (key) => key === PACK || data.dens.some((d) => d.key === key);
  loadSegs();
  autoTarget();
  loadSettings();
  readLink();                            // may bring a whole setup, den included
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (_) { /* ignore */ }
  syncLink();                            // a number saved earlier goes back into the address too
  renderSetupStatus(); renderCallBtn();
  renderBanner();
  pick(ok(saved) ? saved : PACK, true);
  if (pendingLeader) { enterLeader(pendingLeader); pendingLeader = null; }
  else if (saved === DISPATCH || new URLSearchParams(location.search).has("dispatch")) enterDispatch();
  resumeGps();
}

fetch("sff-2026.json?v=dev")   // pages.yml swaps "dev" for the git SHA (cache busting)
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(start)
  .catch((err) => {
    const m = document.getElementById("msg");
    m.textContent = "Couldn't load the map data (" + err.message + "). Check your signal and reload.";
    m.hidden = false;
  });
