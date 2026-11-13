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
function draw() {
  view.textContent = "";
  scaled = []; strokes = []; placedK = 0;
  const D = DATA;
  const pack = denKey === PACK;
  const den = pack ? null : D.dens.find((d) => d.key === denKey);
  const mine = new Set(pack ? D.segments.map((s) => s.id) : den.segments);
  // also draw segments you track from other dens (when the dispatcher sends you to help)
  const shown = new Set([...mine, ...mySegs.tracked]);
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
    t.textContent = s.id + (s.main_road ? " ⚠" : "");
    const w = t.getComputedTextLength() + 10;
    box.setAttribute("x", -w / 2); box.setAttribute("y", -11); box.setAttribute("width", w); box.setAttribute("height", 22);
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

  // landmarks (Sappington Elementary, where every walk starts and ends): a marker and its name
  for (const lm of D.landmarks) {
    const [x, y] = P(lm.lonlat);
    const g = screenGroup(Lstop, x, y, 0, ALWAYS);
    el("circle", { r: 7, fill: "#1a1a1a", stroke: "#fff", "stroke-width": 2.5 }, g);
    el("text", { class: "landmark", x: 12, "dominant-baseline": "central" }, g).textContent = lm.name;
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
  view.appendChild(me.g);               // the GPS dot stays on top of whichever den is drawn
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
  const cardH = card.classList.contains("open") ? card.getBoundingClientRect().height : 0;
  const padTop = 100, padSide = 12;           // room for the north arrow, banner,
  const padBottom = Math.max(60, cardH + 16);                      // scale, buttons and the segment card
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const W = r.width - 2 * padSide, H = r.height - padTop - padBottom;
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
}

let placedK = 0;
function commit() {                     // the full redraw at the current view
  const panOnly = k === k0 && k === placedK;   // labels and line widths only depend on the zoom
  k0 = k; tx0 = tx; ty0 = ty;
  svg.style.transform = fx.style.transform = "";
  view.setAttribute("transform", `translate(${tx + mx} ${ty + my}) scale(${k})`);
  fxView.setAttribute("transform", view.getAttribute("transform"));
  sizeAnts();
  drawMe();
  if (panOnly) return;
  const inv = 1 / k;
  const shrink = Math.min(Math.max(k / 0.8, 0.75), 1);   // labels a bit smaller when zoomed far out
  for (const s of scaled) {
    if (!s.box) measure(s);
    s.el.setAttribute("transform", `translate(${f1(s.x)} ${f1(s.y)}) scale(${inv * shrink}) rotate(${f1(s.rot)})`);
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
  const m = steps.filter((v) => v / mPerPx <= 160).pop() || 10;
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
el("circle", { r: 10, fill: "#fff", class: "halo" }, me.dot);
el("circle", { r: 7, class: "core" }, me.dot);

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
  me.pos = P([c.longitude, c.latitude]);
  me.acc = c.accuracy;
  me.lastFix = Date.now();
  me.g.style.display = "";
  remember(true);
  const area = DATA && DATA.houses.map((h) => P(h.lonlat));
  const far = area && area.every((q) => dist(q, me.pos) > 900);   // ~1 km from every house on the walk
  status(far ? "You're away from the walk area" : `GPS ±${Math.round(c.accuracy)} m`);
  if (me.centerNext) { me.centerNext = false; centerOnMe(true); }
  else if (me.following) centerOnMe(false);
  else drawMe();
}

// iPhones refuse without asking when location is off for the browser, so say where to switch it on.
function blockedHelp() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios && /CriOS/.test(ua))
    return "Location is off for Chrome. iPhone Settings \u203a Privacy & Security \u203a Location Services \u203a Chrome \u203a While Using. Then reload.";
  if (ios && /FxiOS/.test(ua))
    return "Location is off for Firefox. iPhone Settings \u203a Privacy & Security \u203a Location Services \u203a Firefox \u203a While Using. Then reload.";
  if (ios && navigator.standalone)      // already opened from the Home Screen
    return "Location is blocked for SFF Map. Check iPhone Settings \u203a Privacy & Security \u203a Location Services is on, then close and reopen SFF Map and allow location when asked.";
  if (ios)                               // a Safari tab: the Home Screen app asks for itself, even when Safari can't
    return "Safari is blocking location. Add the map to your Home Screen instead: tap Share \u203a Add to Home Screen, open SFF Map from there, and tap Allow when it asks for your location.";
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
  if (!("geolocation" in navigator)) { status("This browser can't share location.", true); return; }
  me.wanted = true;
  if (me.watch !== null) return;
  if (!me.pos) status("Finding you…");
  me.watch = navigator.geolocation.watchPosition(onFix, onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopGps() {
  if (me.watch !== null) navigator.geolocation.clearWatch(me.watch);
  me.watch = null;
}

meBtn.addEventListener("click", () => centerOnMe(true));
// GPS off while the page is in the background, to save battery; back on when it returns.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopGps();
  else if (me.wanted) startGps();
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
let mySegs = { tracked: [], target: null };
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
  } catch (_) { /* nothing saved, or no storage */ }
}
function saveSegs() { try { localStorage.setItem(SEG_KEY, JSON.stringify(mySegs)); } catch (_) { /* ignore */ } }

const segById = (id) => DATA.segments.find((s) => s.id === id);
const denOf = (s) => DATA.dens.find((d) => d.key === s.den);
const segOrder = (a, b) => DATA.segments.indexOf(a) - DATA.segments.indexOf(b);
const isTracked = (id) => mySegs.tracked.includes(id);

function setTracked(id, on) {
  mySegs.tracked = mySegs.tracked.filter((x) => x !== id);
  if (on) mySegs.tracked.push(id);
  if (!on && mySegs.target === id) mySegs.target = null;
  saveSegs();
  segmentsChanged(!on || !(id in segEls));
}
function setTarget(id) {
  mySegs.target = mySegs.target === id ? null : id;
  if (mySegs.target && !isTracked(id)) mySegs.tracked.push(id);   // your target is always one of yours
  saveSegs();
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
  const any = mySegs.tracked.length > 0;
  for (const id in segEls) {
    const e = segEls[id];
    e.faded = any && !isTracked(id) && id !== selected;
    for (const [part, attr, colour, grey] of e.paint) part.setAttribute(attr, e.faded ? grey : colour);
    e.route.setAttribute("opacity", e.faded ? 0.8 : 0.9);
    const glow = id === mySegs.target || id === selected;   // a soft glow in the segment's own colour
    e.halo.style.display = glow ? "" : "none";
    if (glow) { e.halo.setAttribute("stroke", e.color); e.halo.setAttribute("stroke-opacity", id === mySegs.target ? 0.45 : 0.3); }
  }
  const t = mySegs.target && segEls[mySegs.target];
  ants.style.display = t ? "" : "none";
  if (t) ants.setAttribute("d", t.d);
  // the ants layer is above the whole map, so copy the target's ID tag and start arrow on top of the dashes
  for (const [, copy] of fxCopies) copy.remove();
  fxCopies = t ? t.extras.filter((g) => g.kind === "tag" || g.kind === "arrow").map((g) => [g, fxView.appendChild(g.cloneNode(true))]) : [];
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
  selected = id;
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
function tapAt(p) {
  const x = (p.x - tx) / k, y = (p.y - ty) / k, reach = 22 / k;
  let best = null, bestD = reach;
  for (const id in segEls) {
    const e = segEls[id];
    if (e.tag && dist(e.tag, [x, y]) < bestD + 6 / k) { best = id; bestD = dist(e.tag, [x, y]) - 6 / k; }
    for (const r of e.routes) for (let i = 1; i < r.length; i++) {
      const d = segDist([x, y], r[i - 1], r[i]);
      if (d < bestD) { best = id; bestD = d; }
    }
  }
  if (best) select(best, false);
  else if (selected) select(null);
}
function segDist(p, a, b) {               // distance from p to the line piece a-b
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
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

// the card for one segment: all its lines and the Track / Target buttons
function renderCard() {
  const s = selected && segById(selected);
  document.body.classList.toggle("card-open", !!s);
  if (!s) { slideOut(card); return; }    // keep its content while it slides away
  slideIn(card);
  card.textContent = "";
  const top = h("div", "card-top", null, card);
  chip(s, top);
  h("span", "card-den", `${denOf(s).short} \u2022 ${s.houses} houses`, top);
  const x = h("button", "close", "\u2715", top); x.type = "button"; x.setAttribute("aria-label", "Close");
  x.addEventListener("click", () => select(null));
  linesOf(s, card, true);
  const row = h("div", "card-actions", null, card);
  const tr = h("button", isTracked(s.id) ? "on" : "", isTracked(s.id) ? "\u2605 Tracking" : "\u2606 Track", row);
  tr.type = "button"; tr.setAttribute("aria-pressed", isTracked(s.id));
  tr.addEventListener("click", () => setTracked(s.id, !isTracked(s.id)));
  const tg = h("button", mySegs.target === s.id ? "on target" : "", mySegs.target === s.id ? "\u25c9 Target" : "\u25ce Make target", row);
  tg.type = "button"; tg.setAttribute("aria-pressed", mySegs.target === s.id);
  tg.addEventListener("click", () => setTarget(s.id));
  document.body.style.setProperty("--card-h", card.getBoundingClientRect().height + "px");
}

// the banner: your target segment, tap to go to it
// the banner: your target segment (tap to go to it), or a faint prompt to pick one (tap to open the list)
function renderBanner() {
  const s = mySegs.target && segById(mySegs.target);
  banner.hidden = false;
  banner.classList.toggle("empty", !s);
  banner.textContent = "";
  if (!s) {
    h("span", "what", "No target \u2013 tap to pick one", banner);
    return;
  }
  h("span", "label", "Target", banner);
  chip(s, banner);
  const first = s.lines.find((l) => !l.warning);
  h("span", "what", first ? first.text : "", banner);
}
banner.addEventListener("click", () => {
  if (mySegs.target) select(mySegs.target, true);
  else openSheet();
});

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
      h("p", "total", `${mine.length} segment${mine.length === 1 ? "" : "s"} \u2022 ${n} house${n === 1 ? "" : "s"}`, body);
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
      if (mySegs.target === s.id) h("span", "badge", "Target", meta);
      main.addEventListener("click", () => { closeSheet(); select(s.id, true); });
      const star = h("button", "star" + (isTracked(s.id) ? " on" : ""), isTracked(s.id) ? "\u2605" : "\u2606", row);
      star.type = "button";
      star.setAttribute("aria-label", (isTracked(s.id) ? "Stop tracking " : "Track ") + s.id);
      star.setAttribute("aria-pressed", isTracked(s.id));
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
    for (const id of ids) if (!isTracked(id)) mySegs.tracked.push(id);
    saveSegs();
    if (ids.length === 1 && !bad.length) {  // one segment: go straight to it on the map
      closeSheet(); segmentsChanged(true); select(ids[0], true);
    } else { segmentsChanged(true); }
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
document.getElementById("segs-btn").addEventListener("click", openSheet);
document.getElementById("sheet-close").addEventListener("click", closeSheet);

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
picker.addEventListener("change", () => { pickerChanged = true; pick(picker.value); });
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
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (_) { /* ignore */ }
  const ok = (key) => key === PACK || data.dens.some((d) => d.key === key);
  loadSegs();
  renderBanner();
  pick(ok(saved) ? saved : PACK, true);
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
