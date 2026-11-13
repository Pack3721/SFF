// SFF day-of tracker, milestone 1: draw a den's walking map from data/sff-2026.json.
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
const svg = document.getElementById("map");
const wrap = document.getElementById("wrap");
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
  const segs = D.segments.filter((s) => mine.has(s.id));
  const denColor = Object.fromEntries(D.dens.map((d) => [d.key, d.color]));
  const colorOf = (s) => (pack ? denColor[s.den] : s.color);

  // the den's box, as den_bbox in build.py (Lindbergh houses left out, 45 units of padding)
  const hs = D.houses.filter((h) => mine.has(h.seg) && (pack || h.street !== "LINDBERGH BLVD")).map((h) => P(h.lonlat));
  bbox = [Math.min(...hs.map((p) => p[0])) - 45, Math.min(...hs.map((p) => p[1])) - 45,
          Math.max(...hs.map((p) => p[0])) + 45, Math.max(...hs.map((p) => p[1])) + 45];

  const layer = (name) => el("g", { id: "l-" + name }, view);
  const Lstreet = layer("streets"), Lbld = layer("buildings"), Lzone = layer("zones"),
        Lslabel = layer("street-labels"), Lroute = layer("routes"), Lhouse = layer("houses"),
        Larrow = layer("arrows"), Lnum = layer("numbers"), Lid = layer("ids"),
        Lalabel = layer("arterial-labels"), Lstop = layer("stops");

  // 1. streets: a grey casing and a near-white fill (type 3+ are the wider collectors)
  const streets = D.streets.filter((s) => !ARTERIAL_STREETS.has(s.name.toUpperCase()));
  for (const wide of [false, true]) {
    const d = streets.filter((s) => (s.type >= 3) === wide).map((s) => lineD(s.line.map(P))).join("");
    el("path", { d, fill: "none", stroke: "#d4d4d4", "stroke-width": wide ? 15 : 10, "stroke-linecap": "round", "stroke-linejoin": "round" }, Lstreet);
    el("path", { d, fill: "none", stroke: "#f7f7f7", "stroke-width": wide ? 11.3 : 6.3, "stroke-linecap": "round", "stroke-linejoin": "round" }, Lstreet);
  }
  // arterials: wider and tan, run on past the data so they leave the edge of the map
  const arts = D.arterials.map((a) => ({ name: a.name, pts: extend(a.line.map(P), 4000) }));
  const ad = arts.map((a) => lineD(a.pts)).join("");
  el("path", { d: ad, fill: "none", stroke: "#c8c8c8", "stroke-width": 18 }, Lstreet);
  el("path", { d: ad, fill: "none", stroke: "#fff6dc", "stroke-width": 14 }, Lstreet);

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
  el("path", { d: D.buildings.map((r) => ringD(r.map(P))).join(""), fill: "#efefef" }, Lbld);
  el("path", { d: D.houses.filter((h) => !mine.has(h.seg)).map((h) => ringD(h.outline.map(P))).join(""), fill: "#dcdcdc" }, Lbld);

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
    const re = el("path", { d: routes.map((r) => lineD(r, PEN_LIFT)).join(""), fill: "none", stroke: c, opacity: 0.85,
                            "stroke-linecap": "round", "stroke-linejoin": "round" }, Lroute);
    screenStroke(re, 5, s.main_road ? [11, 6] : null);   // dash 2.2 and gap 1.2 line widths, as the PDF

    const hh = housesOf[s.id] || [];
    el("path", { d: hh.map((h) => ringD(h.outline.map(P))).join(""), fill: tint(c, 0.45) }, Lhouse);

    // start arrow: from the first route point toward the first point at least 12 units on
    const rt = routes[0];
    if (rt.length > 1) {
      let j = 1;
      while (j < rt.length - 1 && dist(rt[0], rt[j]) < 12) j++;
      const ang = Math.atan2(rt[j][1] - rt[0][1], rt[j][0] - rt[0][0]) * 180 / Math.PI;
      const g = screenGroup(Larrow, rt[j][0], rt[j][1], ang, ALWAYS);
      el("path", { d: "M2 0 L-12 -6.5 L-9 0 L-12 6.5 Z", fill: c, stroke: "#fff", "stroke-width": 1.2, "stroke-linejoin": "round" }, g);
    }

    // house numbers at the first and last house
    if (!pack && hh.length) {
      const ends = hh.length > 1 ? [hh[0], hh[hh.length - 1]] : [hh[0]];
      for (const h of ends) {
        const [x, y] = P(h.lonlat);
        const g = screenGroup(Lnum, x, y, 0, NUMBER);
        el("text", { class: "endnum", fill: c, "text-anchor": "middle", y: -5 }, g).textContent = h.num;
      }
    }

    // segment ID tag, where the PDF puts it
    const [lx, ly] = P(s.label);
    const g = screenGroup(Lid, lx, ly, 0, pack ? NUMBER : ALWAYS);   // in the pack view IDs give way to each other
    const box = el("rect", { fill: c, stroke: s.main_road ? "#222" : "#fff", "stroke-width": 1.5, rx: 4 }, g);
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
  document.getElementById("fit").textContent = pack ? "Whole pack" : "Whole den";
  view.appendChild(me.g);               // the GPS dot stays on top of whichever den is drawn
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
}

function fit() {
  stopGlide();
  follow(false);
  layout();
  const r = wrap.getBoundingClientRect();
  const padTop = 50, padBottom = 60, padSide = 12;     // room for the north arrow, scale and buttons
  const bw = bbox[2] - bbox[0], bh = bbox[3] - bbox[1];
  const W = r.width - 2 * padSide, H = r.height - padTop - padBottom;
  k = fitK = Math.min(W / bw, H / bh);
  tx = padSide + (W - bw * k) / 2 - bbox[0] * k;
  ty = padTop + (H - bh * k) / 2 - bbox[1] * k;
  commit();
}

function preview() {                    // cheap: move the picture drawn at (k0, tx0, ty0) to (k, tx, ty)
  const s = k / k0;
  // a plain pan nearing the edge of what's drawn: redraw now (only the offset changes) so no blank shows
  if (s === 1 && (Math.abs(tx - tx0) > mx * 0.6 || Math.abs(ty - ty0) > my * 0.6)) { commit(); return; }
  const dx = tx - tx0 * s + mx * (1 - s), dy = ty - ty0 * s + my * (1 - s);
  svg.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  scaleBar();
}

let placedK = 0;
function commit() {                     // the full redraw at the current view
  const panOnly = k === k0 && k === placedK;   // labels and line widths only depend on the zoom
  k0 = k; tx0 = tx; ty0 = ty;
  svg.style.transform = "";
  view.setAttribute("transform", `translate(${tx + mx} ${ty + my}) scale(${k})`);
  drawMe();
  if (panOnly) return;
  const inv = 1 / k;
  const shrink = Math.min(Math.max(k / 0.8, 0.75), 1);   // labels a bit smaller when zoomed far out
  for (const s of scaled) {
    if (!s.box) measure(s);
    s.el.setAttribute("transform", `translate(${f1(s.x)} ${f1(s.y)}) scale(${inv * shrink}) rotate(${f1(s.rot)})`);
  }
  if (k !== placedK) { placedK = k; declutter(shrink); }  // panning doesn't change what overlaps
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
function declutter(shrink) {
  const placed = [];
  const order = scaled.slice().sort((a, b) => a.prio - b.prio);
  for (const s of order) {
    const x = s.x * k + s.box.dx * shrink, y = s.y * k + s.box.dy * shrink;
    const hw = s.box.hw * shrink, hh = s.box.hh * shrink;
    let show = true;
    if (s.fit && s.fit * k < s.box.w * shrink + 16) show = false;   // street too short for its name
    if (show && s.prio !== ALWAYS)
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
let last = null;                         // {x, y, d} of the previous move: centre and finger spread
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
  if (glide) { stopGlide(); moved = true; }   // a touch catches the gliding map; redraw when it lifts
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
  if (e.type === "pointerup" && now - lastTap < 300) {
    const p = me.following ? myScreen() : local(e);   // while following, zoom in on yourself
    zoomAt(p.x, p.y, 2); commit(); lastTap = 0;
  }
  else lastTap = now;
};
wrap.addEventListener("pointerup", lift);
wrap.addEventListener("pointercancel", lift);
let wheelTimer;
wrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  stopGlide();
  follow(false);
  const p = local(e);
  zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  preview();
  clearTimeout(wheelTimer); wheelTimer = setTimeout(commit, 150);
}, { passive: false });
document.addEventListener("gesturestart", (e) => e.preventDefault());   // stop iOS zooming the page

document.getElementById("fit").addEventListener("click", fit);
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const f = me.following; fit(); if (f) centreOnMe(false); }, 150);
});

// ---------- GPS dot ----------
// The phone's location is only used to draw the dot. It is never stored or sent anywhere.
const WALK_K = 1.6;                      // "Centre on me" zooms in to at least this: about 250 m across a phone
const STALE_MS = 30000;                  // no fix for this long: the dot goes grey
const GPS_KEY = "sff.gps";               // "1" once location has worked, so it can restart by itself
const me = { g: el("g", { id: "me" }), pos: null, acc: 0, lastFix: 0, watch: null, wanted: false,
             following: false, centreNext: false };
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

function centreOnMe(zoomIn) {
  if (!me.pos) { me.centreNext = true; startGps(); return; }
  stopGlide();
  const r = wrap.getBoundingClientRect();
  if (zoomIn && k < WALK_K) k = WALK_K;
  tx = r.width / 2 - me.pos[0] * k;
  ty = r.height / 2 - me.pos[1] * k;
  commit();
  follow(true);
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
  if (me.centreNext) { me.centreNext = false; centreOnMe(true); }
  else if (me.following) centreOnMe(false);
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
    stopGps(); me.wanted = false; me.centreNext = false; remember(false); follow(false);
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

meBtn.addEventListener("click", () => centreOnMe(true));
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

// ---------- den picker ----------
const picker = document.getElementById("den");
function pick(key) {
  denKey = key;
  try { localStorage.setItem(STORE_KEY, key); } catch (_) { /* private mode: just don't remember */ }
  picker.value = key;
  draw();
  fit();
}
picker.addEventListener("change", () => pick(picker.value));

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
  pick(ok(saved) ? saved : PACK);
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
