// The dispatcher's QR codes: their number goes after the # in the map's link (…/SFF/#tel=3145550123), and
// a den's page adds the den (…&den=W) so the map opens on it. The part after # never reaches the web server.
// The QR codes are made here, by the vendored qrcode-generator (MIT), and drawn as SVG. Nothing is saved or sent.
"use strict";

const $ = (id) => document.getElementById(id);
const digits = (v) => {                  // a US mobile number as 10 digits, or null
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
};
const pretty = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const NS = "http://www.w3.org/2000/svg";
let DENS = [];                           // from the map's data: key, short name, colour, area, houses, segments

function qrSvg(text) {
  const q = qrcode(0, "M");             // smallest version that fits, medium error correction
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), quiet = 4, size = n + quiet * 2;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code for the map link");
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", size); bg.setAttribute("height", size); bg.setAttribute("fill", "#fff");
  svg.appendChild(bg);
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d); path.setAttribute("fill", "#000");
  svg.appendChild(path);
  return svg;
}

const el = (tag, cls, text, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

// one printable sheet; den is null for the whole-pack sheet
function sheet(d, den) {
  const link = new URL("./", location.href).href + "#tel=" + d + (den ? "&den=" + den.key : "");
  const s = el("section", "sheet");
  el("h2", "", "Scouting for Food \u2013 Pack 721", s);
  if (den) {
    const h = el("p", "den", den.short, s); h.style.color = den.color;
    el("p", "area", `Zone ${den.area} \u2022 ${den.houses} houses \u2022 ${den.segments} segments`, s);
  }
  el("p", "lead", "Scan with your phone's camera to open the walking map.", s);
  const box = el("div", "qr", null, s); box.appendChild(qrSvg(link));
  el("p", "link", link, s);
  const ol = el("ol", "steps", null, s);
  const li = (html) => { const x = el("li", "", null, ol); x.innerHTML = html; return x; };
  li("<b>iPhone:</b> tap Share, then <b>Add to Home Screen</b>, and open <b>SFF 721 Map</b> from there.");
  li(den ? `It opens on <b>${den.short}</b>. Star (&#9734;) the segments your group was given, and tap one to make it your target.`
         : "Pick your den, star (&#9734;) the segments your group was given, and tap one to make it your target.");
  const eg = den ? { L: "Lion", T: "Tiger", W: "Wolf", B: "Bear", WB: "Webelos", A: "AOL" }[den.key] || "Wolf" : "Wolf";
  li(`Tap the gear and type your group&rsquo;s name, like &ldquo;${eg} A&rdquo;.`);
  const last = li("Texts to the dispatcher go to "); el("b", "", pretty(d), last); last.append(".");
  return s;
}

function update() {
  const d = digits($("tel").value);
  $("err").hidden = !!d || $("tel").value.replace(/\D/g, "").length < 10;
  $("mode").hidden = $("print").hidden = !d;
  const box = $("sheets");
  box.textContent = "";
  if (!d) return;
  const perDen = $("mode-dens").checked && DENS.length;
  if (perDen) for (const den of DENS) box.appendChild(sheet(d, den));
  else box.appendChild(sheet(d, null));
  $("print").textContent = perDen ? `Print ${DENS.length} pages` : "Print this page";
}

$("tel").addEventListener("input", update);
for (const r of document.querySelectorAll("input[name=mode]")) r.addEventListener("change", update);
$("print").addEventListener("click", () => window.print());
fetch("sff-2026.json?v=dev")
  .then((r) => r.json())
  .then((data) => {
    DENS = data.dens.map((x) => ({ key: x.key, short: x.short, color: x.color, area: x.area, houses: x.houses, segments: x.segments.length }));
    update();
  })
  .catch(() => { $("mode-dens").disabled = true; update(); });   // no data: whole-pack page only
update();
