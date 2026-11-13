// The dispatcher's QR code: their number goes after the # in the map's link (…/SFF/#tel=3145550123).
// The part after # never reaches the web server. The QR code is made here, by the vendored
// qrcode-generator (MIT), and drawn as SVG. Nothing is saved or sent.
"use strict";

const $ = (id) => document.getElementById(id);
const digits = (v) => {                  // a US mobile number as 10 digits, or null
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
};
const pretty = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const NS = "http://www.w3.org/2000/svg";

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

function update() {
  const d = digits($("tel").value);
  $("sheet").hidden = !d;
  $("err").hidden = !!d || $("tel").value.replace(/\D/g, "").length < 10;
  if (!d) return;
  const link = new URL("./", location.href).href + "#tel=" + d;
  $("qr").textContent = "";
  $("qr").appendChild(qrSvg(link));
  $("link").textContent = link;
  $("tel-shown").textContent = pretty(d);
}
$("tel").addEventListener("input", update);
$("print").addEventListener("click", () => window.print());
update();
