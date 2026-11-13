import re
import re
import math, re, sys
from collections import defaultdict
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib import patheffects as pe

plt.rcParams["font.family"] = "DejaVu Sans"
KX = 0.782  # cos(lat) so x/y units are both ~1.1 m

def title(s):
    s = s.title()
    s = re.sub(r"\bDr\b", "Dr", s)
    return s

# ---------- load ----------
addr = {}
for line in open("addr.txt"):
    line = line.strip()
    if not line: continue
    st, rest = line.split(":", 1)
    pts = []
    for e in rest.split(";"):
        n, x, y = e.split(",")
        pts.append((int(n), int(x) * KX, int(y)))
    addr[st] = pts

# county "Parcel" points with no house on satellite imagery (checked 10 Nov 2026)
DROP = {("MAYO DR", 10021), ("VICKSBURG SIEGE CT", 9700), ("VICKSBURG SIEGE CT", 9801), ("RICHMOND CAVALRY DR", 9804),
        ("CHATTANOOGA CAMPAIGN CT", 9864), ("WILDERNESS BATTLE DR", 9726), ("WILDERNESS BATTLE DR", 9727),
        ("TEAKWOOD CT", 10957), ("ARBOR PARK LN", 10078), ("FLORINDA DR", 10125), ("FAWNHAVEN DR", 11060)}
for _st in list(addr):
    addr[_st] = [p for p in addr[_st] if (_st, p[0]) not in DROP]

streets = []
for line in open("streets.txt"):
    line = line.strip()
    if not line or "=" not in line: continue
    head, rest = line.split("=", 1)
    if not rest: continue
    name, sym = head.split("|")
    for p in rest.split("/"):
        pts = [(int(a) * KX, int(b)) for a, b in (q.split(",") for q in p.split())]
        streets.append((name, int(sym), pts))

MUSICK = [(int(a) * KX, int(b)) for a, b in (q.split(",") for q in
          "5345,4179 5276,4214 5181,4262 5135,4285 5093,4305 5026,4339 5007,4353 4963,4399 4933,4457".split())]
def above_musick(x, y):
    m = sorted(MUSICK)
    for (x1, y1), (x2, y2) in zip(m, m[1:]):
        if x1 <= x <= x2:
            return y > y1 + (y2 - y1) * (x - x1) / (x2 - x1)
    return True

# ---------- official pack boundaries (from the pack's Google My Map: AREA-C, AREA-F) ----------
_C = "-90.36988,38.53354 -90.36994,38.52703 -90.36744,38.52650 -90.36745,38.52939 -90.36154,38.52932 -90.36153,38.52898 -90.35820,38.52893 -90.35672,38.52895 -90.35543,38.52902 -90.35518,38.52903 -90.35484,38.52917 -90.35484,38.53039 -90.35481,38.53140 -90.35484,38.53246 -90.35483,38.53401 -90.35535,38.53445 -90.35743,38.53448 -90.35798,38.53348 -90.36148,38.53338 -90.36144,38.53425 -90.36935,38.53419 -90.36988,38.53354"
_F = "-90.34464,38.53143 -90.34363,38.53226 -90.34408,38.53263 -90.34380,38.53296 -90.34460,38.53347 -90.34386,38.53426 -90.34385,38.53451 -90.34505,38.53529 -90.34437,38.53575 -90.34388,38.53630 -90.34439,38.53727 -90.34488,38.53800 -90.34574,38.53851 -90.34601,38.53923 -90.34717,38.53980 -90.34810,38.53984 -90.34814,38.54062 -90.34736,38.54065 -90.34708,38.54119 -90.34725,38.54164 -90.34849,38.54208 -90.34842,38.54310 -90.34948,38.54399 -90.35008,38.54410 -90.35008,38.54436 -90.34937,38.54458 -90.34936,38.54590 -90.34946,38.54632 -90.35094,38.54578 -90.35088,38.54367 -90.35121,38.54330 -90.35181,38.54331 -90.35184,38.53946 -90.35180,38.53756 -90.35116,38.53595 -90.35081,38.53514 -90.35063,38.53475 -90.35042,38.53429 -90.35026,38.53403 -90.34989,38.53364 -90.34940,38.53333 -90.34506,38.53116 -90.34474,38.53088 -90.34416,38.53099 -90.34464,38.53143"
def _ring(t):
    return [((float(a)+90.4)*1e5*KX, (float(b)-38.49)*1e5) for a, b in (p.split(",") for p in t.split())]
ZONES = {"C": _ring(_C), "F": _ring(_F)}
def _inpoly(x, y, R):
    c = False
    for (x1, y1), (x2, y2) in zip(R, R[1:] + R[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            c = not c
    return c
def inzone(p):
    return any(_inpoly(p[1], p[2], R) for R in ZONES.values())


from matplotlib.collections import PolyCollection
_KX = 0.782
_BL = []   # Microsoft Global ML Building Footprints (2026-02 release)
for _l in open("layers/ms.txt").read().split("\n"):
    if "|" not in _l: continue
    _h, _g = _l.split("|", 1)
    _r = [(int(t.split(",")[0]) * _KX, int(t.split(",")[1])) for t in _g.split() if t]
    if len(_r) > 2:
        _cx = sum(p[0] for p in _r) / len(_r); _cy = sum(p[1] for p in _r) / len(_r)
        _BL.append(dict(a="", r=_r, c=(_cx, _cy)))
_A = {}
for _line in open("addr.txt"):
    _st, _rest = _line.rstrip("\n").split(":", 1)
    for _t in _rest.split(";"):
        _n, _x, _y = _t.split(","); _A[(round(int(_x) * _KX, 2), int(_y))] = (_n, _st)
def _pip(p, r):
    c = False
    for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
        if (y1 > p[1]) != (y2 > p[1]) and p[0] < x1 + (p[1] - y1) * (x2 - x1) / (y2 - y1): c = not c
    return c
_CACHE = {}
_USED = set()
def _others_inside(b, x, y):
    return any(_pip(q, b["r"]) for q in _A if q != (round(x, 2), int(round(y))) and math.dist(q, b["c"]) < 40)
def _bld_for(x, y):
    k = (round(x, 2), int(round(y)))
    if k in _CACHE: return _CACHE[k]
    c = [b for b in _BL if math.dist(b["c"], (x, y)) < 60 and not _crosses_street(b["r"])]
    inside = [b for b in c if _pip((x, y), b["r"])]
    best = inside[0] if inside else None
    if best is None:
        c = sorted((b for b in c if not _others_inside(b, x, y)), key=lambda b: math.dist(b["c"], (x, y)))
        if c and math.dist(c[0]["c"], (x, y)) < 22: best = c[0]
    if best is None: best = _box(x, y)
    _CACHE[k] = best
    return best
_SSEG = []
for _l in open("streets.txt"):
    if "=" not in _l: continue
    for _p in _l.split("=", 1)[1].strip().split("/"):
        _q = [(int(t.split(",")[0]) * _KX, int(t.split(",")[1])) for t in _p.split() if t]
        _SSEG += list(zip(_q, _q[1:]))
def _segx(a, b, c, d):
    f = lambda p, q, r: (r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])
    return (f(c, d, a) > 0) != (f(c, d, b) > 0) and (f(a, b, c) > 0) != (f(a, b, d) > 0)
def _crosses_street(r):
    return any(_segx(r[i], r[(i + 1) % len(r)], a, c) for i in range(len(r)) for a, c in _SSEG
               if min(a[0], c[0]) - 40 < r[i][0] < max(a[0], c[0]) + 40 and min(a[1], c[1]) - 40 < r[i][1] < max(a[1], c[1]) + 40)
def _box(x, y, w=4.5, d=6.5):
    # generic house footprint facing the nearest street, for houses with no usable outline
    best = None
    for a, c in _SSEG:
        vx, vy = c[0] - a[0], c[1] - a[1]; L2 = vx * vx + vy * vy or 1
        t = max(0, min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2))
        dd = math.dist((x, y), (a[0] + t * vx, a[1] + t * vy))
        if best is None or dd < best[0]: best = (dd, vx, vy)
    _, vx, vy = best; L = math.hypot(vx, vy) or 1; ux, uy = vx / L, vy / L; nx, ny = -uy, ux
    r = [(x + sx * w * ux + sy * d * nx, y + sx * w * uy + sy * d * ny) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return dict(a="", r=r, c=(x, y), synthetic=True)
import matplotlib.colors as _mc
def _tint(c, a):
    r, g, b = _mc.to_rgb(c); return (1 - a + a * r, 1 - a + a * g, 1 - a + a * b)
def _outl(ax, houses, fc, ec, z, lw=0.5):
    polys = []; dots = []
    for h in houses:
        b = _bld_for(h[1], h[2])
        if b: polys.append(b["r"])
        else: dots.append((h[1], h[2]))
    if polys: ax.add_collection(PolyCollection(polys, facecolors=fc, edgecolors=ec, lw=lw, zorder=z))
    if dots: ax.scatter(*zip(*dots), s=10, color=fc, edgecolor=ec, linewidth=lw, zorder=z)

import matplotlib.colors as _mc
def _tint(c, a):
    r, g, b = _mc.to_rgb(c); return (1 - a + a * r, 1 - a + a * g, 1 - a + a * b)
_OTHER = None
def _other_bld():
    global _OTHER
    if _OTHER is None:
        ours = set()
        for d in DENS:
            for s in d["segs"]:
                for p in (s.get("parts") or [dict(houses=s["houses"])]):
                    for h in p["houses"]:
                        bb = _bld_for(h[1], h[2])
                        if bb: ours.add(id(bb))
        _OTHER = [bb["r"] for bb in _BL if id(bb) not in ours and not _crosses_street(bb["r"])]
    return _OTHER

PFX = {"WB": "WE"}  # Webelos segment IDs start with WE
# ---------- den definitions ----------
ALL = lambda n, x, y: True
DENS = [
  dict(key="W", name="Wolves", scouts=14, color="#c0392b", zone="C, west side + Mugan block",
       streets={"FAWNHAVEN DR":ALL,"FAWNDALE DR":ALL,"FAWNWAY DR":ALL,"LITTIE RD":ALL,"ELLA MARY CT":ALL,
                "ARBOR PARK LN":ALL,"PATRINA CT":ALL,"KINGSMERE CT":ALL,"ALPENA DR":ALL,"ABDELL DR":ALL,"ALBURY CT":ALL,
                "MUGAN DR":ALL,"HAVELOCK CT":ALL,"KINGSMERE DR":ALL,"EDGEMOOR TER":ALL,"TULANE DR":ALL},
       start="Fawnhaven Dr at Baptist Church Rd"),
  dict(key="B", name="Bears", scouts=9, color="#1f6fd1", zone="C, Bernadine to Three Court",
       streets={"BERNADINE DR":ALL,"FARADAY DR":ALL,"GALENA CT":ALL,"PALMYRA CT":ALL,"PICKWICK DR":ALL,
                "DANDRIDGE DR":ALL,"THREE COURT DR":ALL,"MALLORY DR":ALL,"TEAKWOOD CT":ALL},
       start="Dandridge Dr at Bernadine Dr"),
  dict(key="L", name="Lions", scouts=5, color="#b8860b", zone="C, Teakwood / Valdamere / Mimosa / Wisteria",
       streets={"TEAKWOOD DR":ALL,"VALDAMERE DR":ALL,"MIMOSA LN":ALL,"WISTERIA LN":ALL},
       start="Teakwood Dr at Baptist Church Rd"),
  dict(key="T", name="Tigers", scouts=10, color="#e07b00", zone="F, north corner",
       streets={"WILDERNESS BATTLE DR":ALL,"WILDERNESS BATTLE CIR":ALL,"RICHMOND CAVALRY DR":ALL,
                "VICKSBURG SIEGE CT":ALL,"CHATTANOOGA CAMPAIGN CT":ALL,"APPOMATTOX STATION CT":ALL},
       start="Richmond Cavalry Dr at Musick Ave"),
  dict(key="A", name="Arrow of Light", scouts=6, color="#138a52", zone="F, Larkspur to Roscommon",
       streets={"LARKSPUR DR":ALL,"ANTRIM DR":ALL,"COPPERFIELD DR":ALL,"LEITRIM DR":ALL,"MAYO DR":ALL,
                "GRANT FOREST LN":ALL,"KILMEADE DR":ALL,"ROSCOMMON DR":ALL,"KILLOREN DR":ALL,"KILRUSH DR":ALL},
       start="Larkspur Dr at Musick Ave"),
  dict(key="WB", name="Webelos", scouts=8, color="#7d3cb5", zone="F, Meath and everything south",
       streets={"MEATH DR":ALL,"FLORINDA DR":ALL,"LAVINIA DR":lambda n,x,y:n<10600,
                "MUSICK MANOR LN":ALL,"FABICK DR":ALL,"CRECELIUS DR":ALL,"SONATA DR":ALL,"KAMPING LN":ALL,
                "TESSHIRE DR":ALL},
       start="Meath Dr at Musick Ave"),
  dict(key="M", name="Main roads", scouts=None, color="#34495e", zone="MA = AOL, MW = Webelos, M2\u2013M4 = Bears (adult along)",
       streets={"MUSICK AVE":ALL,"BAPTIST CHURCH RD":ALL,"TESSON FERRY RD":ALL},
       start="Musick Ave"),
]

SEG_TARGET = 13

def chunk(lst, target):
    n = len(lst)
    k = max(1, round(n / target))
    out, i = [], 0
    for j in range(k):
        sz = n // k + (1 if j < n % k else 0)
        out.append(lst[i:i + sz]); i += sz
    return out

def is_court(st):
    return st.endswith(" CT") or st.endswith(" TER") or st.endswith(" LN") and len(addr.get(st, [])) < 18

def nn_order(pts):
    """Order houses by walking nearest-neighbour from the lowest-numbered house."""
    rest = sorted(pts, key=lambda p: p[0])
    if not rest: return []
    if len(rest) > 2:
        # start at one end of the street: farthest house from the farthest house
        a = max(rest, key=lambda p: math.dist(p[1:], rest[0][1:]))
        b = max(rest, key=lambda p: math.dist(p[1:], a[1:]))
        st = min((a, b), key=lambda p: p[0])
        rest.remove(st); rest.insert(0, st)
    out = [rest.pop(0)]
    while rest:
        cur = out[-1]
        j = min(range(len(rest)), key=lambda i: math.dist(cur[1:], rest[i][1:]))
        out.append(rest.pop(j))
    return out

def runs(seq, gap=110):
    out, cur = [], [seq[0]]
    for a, b in zip(seq, seq[1:]):
        if math.dist(a[1:], b[1:]) > gap:
            out.append(cur); cur = []
        cur.append(b)
    out.append(cur)
    # fold tiny runs (a stray corner house or two) into a neighbouring run
    i = 0
    while len(out) > 1 and i < len(out):
        if len(out[i]) < 5:
            j = i - 1 if i > 0 else i + 1
            if j < i: out[j] = out[j] + out[i]
            else: out[j] = out[i] + out[j]
            out.pop(i); i = 0
        else:
            i += 1
    return out


# ---------- cross-street blocks ----------
_SP = defaultdict(list)
for _n, _s, _p in streets:
    if len(_p) > 1: _SP[_n].append(_p)
def _pproj(P, piece):
    best = None; acc = 0
    for a, b in zip(piece, piece[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
        t = max(0, min(1, ((P[0]-a[0])*dx + (P[1]-a[1])*dy) / (L*L)))
        Q = (a[0]+dx*t, a[1]+dy*t); d = math.dist(P, Q)
        if best is None or d < best[0]: best = (d, acc + t*L, Q, (dx/L, dy/L))
        acc += L
    return best
def _loc(st, P):
    best = None
    for i, pc in enumerate(_SP.get(st, [])):
        d, t, Q, u = _pproj(P, pc)
        if best is None or d < best[0]: best = (d, i, t, Q, u)
    return best[:4] if best else None
def _sidesign(st, P):
    best = None
    for i, pc in enumerate(_SP.get(st, [])):
        d, t, Q, u = _pproj(P, pc)
        if best is None or d < best[0]: best = (d, Q, u)
    d, Q, u = best
    c = u[0]*(P[1]-Q[1]) - u[1]*(P[0]-Q[0])
    return 1 if c > 0 else -1
_XCACHE = {}
def _xings(st):
    if st in _XCACHE: return _XCACHE[st]
    out = []
    for n, sy, pts in streets:
        if n == st or n.startswith("FAWNWAY2"): continue
        for k, p in enumerate(pts):
            r = _loc(st, p)
            if r and r[0] < 14:
                signs = set()
                for j in (k-1, k+1):
                    if 0 <= j < len(pts):
                        far = pts[j]
                        if math.dist(far, p) > 15 and _loc(st, far)[0] > 10:
                            signs.add(_sidesign(st, far))
                if not signs: signs = {1, -1}
                out.append((r[1], r[2], n, r[3], frozenset(signs)))
    # also: this street's own end points touching another street (e.g. Mugan Dr ending at Baptist Church Rd)
    for pc in _SP.get(st, []):
        for p in (pc[0], pc[-1]):
            for n, sy, pts in streets:
                if n == st or n.startswith("FAWNWAY2") or len(pts) < 2: continue
                d = _pproj(p, pts)[0]
                if d < 14:
                    r = _loc(st, p)
                    out.append((r[1], r[2], n, r[3], frozenset({1, -1})))
    _XCACHE[st] = out
    return out
def _short(n):
    return title(n).rsplit(" ", 1)[0] if " " in n else title(n)

def split_blocks(st, seq):
    if st not in _SP or len(seq) < 2: return [seq]
    sg = 1 if sum(_sidesign(st, h[1:]) for h in seq) >= 0 else -1
    X = [(pi, t, n, q) for pi, t, n, q, sgn in _xings(st) if sg in sgn]
    locs = [_loc(st, h[1:]) for h in seq]
    blocks, cur = [], [seq[0]]
    for k in range(1, len(seq)):
        (_, pa, ta, Qa), (_, pb, tb, Qb) = locs[k-1], locs[k]
        cut = False
        if pa == pb:
            lo, hi = sorted((ta, tb))
            cut = any(pi == pa and lo + 3 < t < hi - 3 for pi, t, n, q in X)
        else:
            mid = ((Qa[0]+Qb[0])/2, (Qa[1]+Qb[1])/2)
            cut = any(math.dist(q, mid) < max(30, math.dist(Qa, Qb)/2 + 8) for pi, t, n, q in X)
        if cut:
            blocks.append(cur); cur = []
        cur.append(seq[k])
    blocks.append(cur)
    # very short blocks (1-3 houses, mostly corner lots) join the smaller neighbouring block
    while len(blocks) > 1:
        small = [i for i, b in enumerate(blocks) if len(b) < 4]
        if not small: break
        i = min(small, key=lambda i: len(blocks[i]))
        if i == 0: j = 1
        elif i == len(blocks) - 1: j = i - 1
        else: j = i - 1 if len(blocks[i-1]) <= len(blocks[i+1]) else i + 1
        lo, hi = sorted((i, j))
        blocks[lo:hi+1] = [blocks[lo] + blocks[hi]]
    out = []
    for b in blocks:
        out += chunk(b, 13) if len(b) > 20 else [b]
    return out

def block_label(st, houses):
    """compass side + 'From -> To' cross streets for a street-side run of houses (in walking order)."""
    if st not in _SP: return None
    sg = 1 if sum(_sidesign(st, h[1:]) for h in houses) >= 0 else -1
    X = [(n, q) for pi, t, n, q, sgn in _xings(st) if sg in sgn]
    Qs = [_loc(st, h[1:])[3] for h in houses]
    vx = sum(h[1] - q[0] for h, q in zip(houses, Qs)); vy = sum(h[2] - q[1] for h, q in zip(houses, Qs))
    comp = ("E" if vx > 0 else "W") if abs(vx) > abs(vy) else ("N" if vy > 0 else "S")
    if len(houses) < 2: return comp, None, None
    A, B = Qs[0], Qs[-1]
    L = math.dist(A, B) or 1
    u = ((B[0]-A[0])/L, (B[1]-A[1])/L)
    def along(q): return (q[0]-A[0])*u[0] + (q[1]-A[1])*u[1]
    def near_path(q): return min(math.dist(q, Q) for Q in Qs) < 110
    fr = [(along(q), n) for n, q in X if along(q) <= 8 and near_path(q)]
    to = [(along(q), n) for n, q in X if along(q) >= L - 8 and near_path(q)]
    nm = lambda n: title(n) if _short(n) == _short(st) else _short(n)
    f = nm(max(fr)[1]) if fr else "end"
    t = nm(min(to)[1]) if to else "end"
    if f == t and f != "end":
        t = "end"
    return comp, f, t

def build_segments(den):
    raw = []
    for st, f in den["streets"].items():
        pts = [p for p in addr[st] if f(*p) and inzone(p)]
        if not pts: continue
        if len(pts) <= 18 and (st.endswith(" CT") or st.endswith(" TER") or len(pts) <= 12):
            # cul-de-sac / short street: one loop, both sides
            odd = nn_order([p for p in pts if p[0] % 2])
            even = nn_order([p for p in pts if p[0] % 2 == 0]) if any(p[0] % 2 == 0 for p in pts) else []
            seq = odd + even[::-1] if odd else even
            raw.append(dict(street=st, side="both sides", houses=seq))
            continue
        for side, par in (("odd", 1), ("even", 0)):
            sp = [p for p in pts if p[0] % 2 == par]
            if not sp: continue
            _pl = lambda q: sum(math.dist(a[1:], b[1:]) for a, b in zip(q, q[1:]))
            for r in runs(min((sorted(sp, key=lambda p: p[0]), nn_order(sp)), key=_pl)):
                parts = chunk(r, SEG_TARGET)
                for c in parts:
                    raw.append(dict(street=st, side=side + " side", houses=c))
    # walking order: finish one street before moving on (so IDs group by area).
    # within a street: walk one side block by block, then come back down the other side.
    bystreet = {}
    for x in raw: bystreet.setdefault(x["street"], []).append(x)
    def plans(segs):
        courts = [x for x in segs if x["side"] == "both sides"]
        O = [x for x in segs if x["side"] == "odd side"]; E = [x for x in segs if x["side"] == "even side"]
        if O and E:
            # make both sides run the same direction
            if math.dist(O[0]["houses"][0][1:], E[-1]["houses"][-1][1:]) < math.dist(O[0]["houses"][0][1:], E[0]["houses"][0][1:]):
                E = [dict(x, houses=x["houses"][::-1]) for x in E[::-1]]
        rev = lambda L: [dict(x, houses=x["houses"][::-1]) for x in L[::-1]]
        out = []
        for A, Bs in ((O, E), (E, O)):
            for fwd in (True, False):
                p = (A if fwd else rev(A)) + (rev(Bs) if fwd else Bs)
                out.append(p + courts)
        return out
    order, cur = [], None
    first = list(den["streets"])[0]
    left = dict(bystreet)
    while left:
        best = None
        for st, segs in left.items():
            for p in plans(segs):
                h0 = p[0]["houses"][0]
                d = (0 if st == first else 1e9) if cur is None else math.dist(cur, h0[1:])
                if best is None or d < best[0]: best = (d, st, p)
        _, st, p = best
        del left[st]
        order += p
        cur = p[-1]["houses"][-1][1:]
    for i, s in enumerate(order, 1):
        s["id"] = f"{PFX.get(den['key'], den['key'])}{i}"
        nums = [h[0] for h in s["houses"]]
        s["first"], s["last"] = nums[0], nums[-1]
        s["n"] = len(nums)
        if s["side"] == "both sides":
            s["range"] = f"{min(nums)}–{max(nums)}"
        else:
            s["range"] = f"{s['first']}→{s['last']}"
            bl = block_label(s["street"], s["houses"]) if den["key"] != "M" else None
            if bl:
                comp, f, t = bl
                s["disp"] = f"{comp} side"
    return order

for d in DENS:
    d["segs"] = build_segments(d)
    d["total"] = sum(s["n"] for s in d["segs"])
# fold the two little courts off Baptist Church Rd into the main-road segments on their side
def _fold(court, side):
    _M = next(d for d in DENS if d["key"] == "M")
    tgt = next(x for x in _M["segs"] if x["street"] == "BAPTIST CHURCH RD" and x["side"] == side)
    for d in DENS:
        if d["key"] == "M": continue
        for x in list(d["segs"]):
            if x["street"] == court:
                d["segs"].remove(x)
                tgt.setdefault("parts", [dict(street=tgt["street"], houses=tgt["houses"])])
                tgt["parts"].append(dict(street=court, houses=x["houses"]))
                tgt["n"] += x["n"]
                tgt["label"] = "Baptist Ch. + " + title(court)
                for i, y in enumerate(d["segs"], 1):
                    y["id"] = f"{d['key']}{i}"
                d["total"] = sum(y["n"] for y in d["segs"])
    _M["total"] = sum(y["n"] for y in _M["segs"])
# split Musick Ave between AOL (north, along their streets) and Webelos (south)
def _fix_threecourt():
    # Three Court Dr (Dandridge -> Baptist Church) has two dead-end courts off its south side.
    # Walk the south side westward from Dandridge and duck into each court as you reach it.
    B = next(d for d in DENS if d["key"] == "B")
    E_IN, W_IN = 4075 * KX, 3972 * KX            # where each court meets Three Court Dr
    incourt = lambda h: h[2] < 3950 and h[1] < 3225
    bad = [x for x in B["segs"] if x["street"] == "THREE COURT DR" and x["side"] == "even side"
           and any(h[1] < 4190 * KX for h in x["houses"])]
    if not bad: return
    i = B["segs"].index(bad[0])
    hs = [h for x in bad for h in x["houses"]]
    for x in bad: B["segs"].remove(x)
    DAND = 4190 * KX
    east = sorted([h for h in hs if h[1] >= DAND], key=lambda h: -h[1])
    hs = [h for h in hs if h[1] < DAND]
    main = sorted([h for h in hs if not incourt(h)], key=lambda h: -h[1])
    court = [h for h in hs if incourt(h)]
    ec = [h for h in court if h[1] > (E_IN + W_IN) / 2]; wc = [h for h in court if h[1] <= (E_IN + W_IN) / 2]
    def loop(c, ent):
        c = list(c); out = [min(c, key=lambda h: math.dist(h[1:], (ent, 3951)))]; c.remove(out[0])
        while c:
            nx = min(c, key=lambda h: math.dist(h[1:], out[-1][1:])); c.remove(nx); out.append(nx)
        return out
    parts = []
    for hs_, st in (([h for h in main if h[1] > E_IN], "THREE COURT DR"), (loop(ec, E_IN) if ec else [], "THREE COURT DR"),
                    ([h for h in main if W_IN < h[1] <= E_IN], "THREE COURT DR"), (loop(wc, W_IN) if wc else [], "THREE COURT DR"),
                    ([h for h in main if h[1] <= W_IN], "THREE COURT DR")):
        if hs_: parts.append(dict(street=st, houses=hs_))
    for p in parts:
        if p["houses"] and incourt(p["houses"][0]):
            p["court"] = (E_IN if p["houses"][0][1] > (E_IN + W_IN) / 2 else W_IN, 3936)
    allh = [h for p in parts for h in p["houses"]]
    seg = dict(street="THREE COURT DR", side="even side", houses=parts[0]["houses"], parts=parts, n=len(allh),
               first=allh[0][0], last=allh[-1][0], range=f"{allh[0][0]}\u2192{allh[-1][0]}",
               label="Three Court Dr + 2 courts", disp="S side, Dandridge \u2192 Baptist Ch., into each court")
    B["segs"].insert(i, seg)
    # north side: split at Dandridge too
    odd = [x for x in B["segs"] if x["street"] == "THREE COURT DR" and x["side"] == "odd side"]
    if odd:
        j = B["segs"].index(odd[0])
        oh = sorted([h for x in odd for h in x["houses"]], key=lambda h: -h[1])
        for x in odd: B["segs"].remove(x)
        for k_, (grp, lab) in enumerate(((sorted([h for h in oh if h[1] < DAND], key=lambda h: -h[1]), "N side, Dandridge \u2192 Baptist Ch."),
                                          (sorted([h for h in oh if h[1] >= DAND], key=lambda h: h[1]), "N side, Dandridge \u2192 east end"))):
            if grp:
                B["segs"].insert(j, dict(street="THREE COURT DR", side="odd side", houses=grp, n=len(grp), first=grp[0][0],
                                         last=grp[-1][0], range=f"{grp[0][0]}\u2192{grp[-1][0]}", disp=lab))
        i = B["segs"].index(seg)
    if east:
        B["segs"].insert(i, dict(street="THREE COURT DR", side="even side", houses=east, n=len(east), first=east[0][0],
                                 last=east[-1][0], range=f"{east[0][0]}\u2192{east[-1][0]}", disp="S side, east of Dandridge"))
    # order: north-east, south-east (back to Dandridge), then north-west, south-west
    tc = [x for x in B["segs"] if x["street"] == "THREE COURT DR"]
    pos = B["segs"].index(tc[0])
    key_ = {"N side, Dandridge \u2192 east end": 0, "S side, east of Dandridge": 1,
            "N side, Dandridge \u2192 Baptist Ch.": 2}
    tc.sort(key=lambda x: key_.get(x.get("disp"), 3))
    for x in tc: B["segs"].remove(x)
    B["segs"][pos:pos] = tc
    k = 1
    for x in B["segs"]:
        if not x.get("main"):
            x["id"] = f"B{k}"; k += 1
_fix_threecourt()

def _move_house(num, street, to_street, to_side_prefix=None):
    # move one address into another segment (e.g. 9700 Vicksburg Siege sits at the top, beside Wilderness Battle Cir)
    for d in DENS:
        src = next((x for x in d["segs"] if x["street"] == street and any(h[0] == num for h in x["houses"])), None)
        if not src: continue
        h = next(h for h in src["houses"] if h[0] == num)
        dst = next((x for x in d["segs"] if x["street"] == to_street and (to_side_prefix is None or any(q[0] == to_side_prefix for q in x["houses"]))), None)
        if not dst: return
        src["houses"].remove(h); src["n"] -= 1
        src["first"], src["last"] = src["houses"][0][0], src["houses"][-1][0]
        src["range"] = f"{src['first']}\u2192{src['last']}"
        dst.setdefault("parts", [dict(street=dst["street"], houses=dst["houses"])])
        dst["parts"].append(dict(street=street, houses=[h]))
        dst["n"] += 1
        dst["label"] = title(dst["street"]) + " + " + str(num) + " " + title(street).rsplit(" ", 1)[0]
        d["total"] = sum(x["n"] for x in d["segs"])
        return
_move_house(9700, "VICKSBURG SIEGE CT", "WILDERNESS BATTLE CIR", 9704)

def _split_musick():
    # Satellite check: most Musick Ave addresses are corner lots at the ends of side streets.
    # Only the private lane between Roscommon and Meath (9940/9946/9950) and 10104 (south of the creek)
    # need walking on Musick itself; every other Musick house joins the nearest side-street segment.
    _M = next(d for d in DENS if d["key"] == "M")
    m = next(x for x in _M["segs"] if x["street"] == "MUSICK AVE")
    i = _M["segs"].index(m)
    groups = {"MA": ("A", {9940, 9946, 9950}), "MWE": ("WB", {10104})}
    keep = set().union(*(g[1] for g in groups.values()))
    new = []
    for sid, (owner, nums) in groups.items():
        hs = [h for h in m["houses"] if h[0] in nums]
        new.append(dict(street="MUSICK AVE", side=m["side"], houses=hs, id=sid, owner_fixed=owner,
                        first=hs[0][0], last=hs[-1][0], n=len(hs), range=f"{hs[0][0]}\u2013{hs[-1][0]}" if len(hs) > 1 else str(hs[0][0])))
    _M["segs"][i:i+1] = new
    pool = [x for d in DENS if d["key"] != "M" for x in d["segs"]]
    for h in m["houses"]:
        if h[0] in keep: continue
        best = min(pool, key=lambda x: min(math.dist(h[1:], q[1:]) for q in x["houses"]))
        best.setdefault("parts", [dict(street=best["street"], houses=best["houses"])])
        best["parts"].append(dict(street="MUSICK AVE", houses=[h]))
        best["n"] += 1
        best.setdefault("musick", []).append(h[0])
        best["label"] = title(best["street"]).rsplit(" ", 1)[0] + " + " + ", ".join(str(n) for n in best["musick"]) + " Musick"
    for x in pool:
        if 10304 in x.get("musick", []):
            x["warn"] = "\u26a0 10304: no sidewalk"
    for d in DENS:
        d["total"] = sum(x["n"] for x in d["segs"])
_split_musick()
_fold("TEAKWOOD CT", "even side")
_fold("KINGSMERE CT", "odd side")
# main-road segments count toward Webelos / AOL
_M = next(d for d in DENS if d["key"] == "M")
for d in DENS: d["extra"] = []
for s in _M["segs"]:
    tgt = s.get("owner_fixed") or ("A" if s["street"] == "MUSICK AVE" else "WB" if s["street"] == "TESSON FERRY RD" else "B")
    s["owner"] = tgt
    next(d for d in DENS if d["key"] == tgt)["extra"].append(s)
for d in DENS:
    d["grand"] = d["total"] + sum(s["n"] for s in d["extra"])
_ren = {"M2": "MB1", "M3": "MB2", "M4": "MB3"}
for d in DENS:
    for x in d["extra"]:
        x["main"] = True
        x["id"] = _ren.get(x["id"], x["id"])
        if x["street"] == "TESSON FERRY RD":
            x["id"] = "MWE2"; x["range"] = "10699"
        elif x["id"] == "MWE":
            x["id"] = "MWE1"
        d["segs"].append(x)
    d["extra"] = []
    d["total"] = d["grand"] = sum(x["n"] for x in d["segs"])
DENS = [d for d in DENS if d["key"] != "M"]
# Baptist Church Rd: sidewalk on the EAST side only (checked on Apple Maps imagery).
def _rebuild_bc():
    B = next(d for d in DENS if d["key"] == "B"); W = next(d for d in DENS if d["key"] == "W")
    old = [x for x in B["segs"] if x.get("main")]
    courts = {p["street"]: p["houses"] for x in old for p in x.get("parts", []) if p["street"] != "BAPTIST CHURCH RD"}
    B["segs"] = [x for x in B["segs"] if not x.get("main")]
    bc = {h[0]: h for h in addr["BAPTIST CHURCH RD"] if inzone(h)}
    def mk(sid, nums, court=None, nosw=False, side="even side"):
        hs = [bc[n] for n in nums if n in bc]
        seg = dict(street="BAPTIST CHURCH RD", side=side, houses=hs, id=sid, main=True, nosidewalk=nosw,
                   first=hs[0][0], last=hs[-1][0])
        seg["n"] = len(hs)
        seg["range"] = f"{hs[0][0]}\u2192{hs[-1][0]}" if len(hs) > 1 else str(hs[0][0])
        if court:
            seg["parts"] = [dict(street="BAPTIST CHURCH RD", houses=hs), dict(street=court, houses=courts[court])]
            seg["n"] += len(courts[court]); seg["label"] = "Baptist Ch. + " + title(court)
        return seg
    W["segs"] += [mk("MW1", [10126, 10130, 10138, 10144, 10148, 10156, 10164, 10178]),
                  mk("MW2", [10135, 10139], "KINGSMERE CT", True, "odd side")]
    B["segs"] += [mk("MB1", [10300, 10310, 10318, 10322, 10326], "TEAKWOOD CT"),
                  mk("MB2", [10301, 10311, 10319, 10327], None, True, "odd side")]
    for d in (W, B): d["total"] = d["grand"] = sum(x["n"] for x in d["segs"])
_rebuild_bc()

# Lindbergh's 2 houses are reached from the bottom of Mimosa / Wisteria: add each to the nearest Lions segment
_L = next(d for d in DENS if d["key"] == "L")
for h in [p for p in addr["LINDBERGH BLVD"] if inzone(p)]:
    best = min(_L["segs"], key=lambda x: min(math.dist(h[1:], q[1:]) for q in x["houses"]))
    best.setdefault("parts", [dict(street=best["street"], houses=best["houses"])])
    best["parts"].append(dict(street="LINDBERGH BLVD", houses=[h]))
    best["n"] += 1
    best["label"] = title(best["street"]).rsplit(" ", 1)[0] + " + " + str(h[0]) + " Lindbergh"
_L["total"] = _L["grand"] = sum(x["n"] for x in _L["segs"])
def _combine(key, cap=17):
    """Fewer, bigger segments: join neighbouring blocks on the same street side, and fold tiny bits into a neighbour."""
    D = next(d for d in DENS if d["key"] == key)
    segs = [x for x in D["segs"] if not x.get("main")]
    mains = [x for x in D["segs"] if x.get("main")]
    out = []
    for x in segs:
        p = out[-1] if out else None
        same_side = p and p["street"] == x["street"] and p["side"] == x["side"] and x["side"] != "both sides"
        if same_side and p["n"] + x["n"] <= cap:
            extras = [q for q in p.get("parts", [])[1:]] + [q for q in x.get("parts", [])[1:]]
            p["houses"] = p["houses"] + x["houses"]; p["n"] += x["n"]
            if extras:
                p["parts"] = [dict(street=p["street"], houses=p["houses"])] + extras
                tags = [lab.split(" + ", 1)[1] for lab in (p.get("label", ""), x.get("label", "")) if " + " in lab]
                if not tags: tags = [title(q["street"]) for q in extras if q["street"] != p["street"]]
                p["label"] = title(p["street"]).rsplit(" ", 1)[0] + " + " + ", ".join(tags)
            for k in ("musick",):
                if x.get(k): p[k] = p.get(k, []) + x[k]
            if x.get("warn"): p["warn"] = x["warn"]
            p["last"] = p["houses"][-1][0]; p["range"] = f"{p['first']}\u2192{p['last']}"
            bl = block_label(p["street"], p["houses"])
            if bl:
                comp, f, t = bl
                p["disp"] = f"{comp} side" + (f": {f} \u2192 {t}" if f and not (f == "end" and t == "end") else "")
            continue
        if p and p["street"] == x["street"] and sum(1 for y in segs if y["street"] == x["street"]) == 2 \
                and p["n"] + x["n"] <= 18 and not p.get("parts") and not x.get("parts"):
            # short street: do both sides as one segment (up one side, back the other)
            p["houses"] = p["houses"] + x["houses"]; p["n"] += x["n"]
            p["side"] = "both sides"; p.pop("disp", None)
            nums = [h[0] for h in p["houses"]]; p["range"] = f"{min(nums)}\u2013{max(nums)}"
            continue
        near = p and min(math.dist(a[1:], b[1:]) for a in p["houses"] for b in x["houses"]) < 70
        if p and near and x["side"] == "both sides" and x["n"] <= 8 and p["n"] + x["n"] <= cap + 4 and not x.get("parts"):
            p.setdefault("parts", [dict(street=p["street"], houses=p["houses"])])
            p["parts"].append(dict(street=x["street"], houses=x["houses"]))
            p["n"] += x["n"]
            p["label"] = p.get("label", title(p["street"])) + " + " + title(x["street"])
            continue
        if p and (x["n"] <= 3 or (x["n"] <= 5 and p["street"] == x["street"])) and p["n"] + x["n"] <= cap + 5:
            # tiny court / short stub: add as an extra stop on the previous segment
            p.setdefault("parts", [dict(street=p["street"], houses=p["houses"])])
            p["parts"].append(dict(street=x["street"], houses=x["houses"]))
            p["n"] += x["n"]
            if x["street"] != p["street"]:
                p["label"] = p.get("label", title(p["street"])) + " + " + title(x["street"])
            else:
                nums = [h[0] for q in p["parts"] for h in q["houses"]]
                p["range"] = f"{min(nums)}\u2013{max(nums)}"
                if p["side"] != x["side"]:
                    p["disp"] = "both sides"
            continue
        out.append(x)
    for i, x in enumerate(out, 1):
        x["id"] = f"{PFX.get(key, key)}{i}"
    D["segs"] = out + mains
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
def _simple_segments(key, order_streets, skip=()):
    """Plain segments: one side of one street per segment, in house-number order.
    Split only where the numbering jumps (a separate stretch of the street) or a side is too long.
    Short streets and courts are one loop, both sides."""
    D = next(d for d in DENS if d["key"] == key)
    mains = [x for x in D["segs"] if x.get("main")]
    out = []
    for st in order_streets:
        if st in skip: continue
        f = D["streets"].get(st, ALL)
        pts = [p for p in addr[st] if f(*p) and inzone(p)]
        if not pts: continue
        if len(pts) <= 14 or st.endswith(" CT") and len(pts) <= 18:
            odd = sorted([p for p in pts if p[0] % 2], key=lambda p: p[0])
            even = sorted([p for p in pts if p[0] % 2 == 0], key=lambda p: -p[0])
            out.append(dict(street=st, side="both sides", disp="both sides", houses=odd + even))
            continue
        sides = []
        for par, nm in ((1, "odd side"), (0, "even side")):
            sp = sorted([p for p in pts if p[0] % 2 == par], key=lambda p: p[0])
            if not sp: continue
            runs_ = [[sp[0]]]
            for a, b in zip(sp, sp[1:]):
                if b[0] - a[0] > 300: runs_.append([])
                runs_[-1].append(b)
            while len(runs_) > 1 and min(len(r) for r in runs_) < 5:
                i = min(range(len(runs_)), key=lambda k: len(runs_[k]))
                j = i - 1 if i > 0 else 1
                lo, hi = sorted((i, j))
                runs_[lo:hi+1] = [runs_[lo] + runs_[hi]]
            pieces = []
            for r in runs_:
                pieces += chunk(r, 18) if len(r) > 24 else [r]
            sides.append((nm, pieces))
        # serpentine: odd side out, even side back
        for i, (nm, pieces) in enumerate(sides):
            if i == 1:
                pieces = [pc[::-1] for pc in pieces[::-1]]
            for pc in pieces:
                seg = dict(street=st, side=nm, houses=pc)
                bl = block_label(st, pc)
                if bl:
                    comp, fr, to = bl
                    seg["disp"] = f"{comp} side" + (f": {fr} \u2192 {to}" if fr and not (fr == "end" and to == "end") else "")
                out.append(seg)
    # a 1-3 house street (e.g. Tulane Dr) rides along with the segment before it
    merged = []
    for x in out:
        if merged and len(x["houses"]) <= 3 and x["street"] != merged[-1]["street"]:
            p = merged[-1]
            p.setdefault("parts", [dict(street=p["street"], houses=p["houses"])])
            p["parts"].append(dict(street=x["street"], houses=x["houses"]))
            p["label"] = title(p["street"]) + " + " + title(x["street"])
            p["extra_n"] = p.get("extra_n", 0) + len(x["houses"])
            continue
        merged.append(x)
    out = merged
    for i, x in enumerate(out, 1):
        x["id"] = f"{PFX.get(key, key)}{i}"
        nums = [h[0] for h in x["houses"]]
        x["n"] = len(nums) + x.get("extra_n", 0); x["first"], x["last"] = nums[0], nums[-1]
        x["range"] = f"{min(nums)}\u2013{max(nums)}" if x["side"] == "both sides" else f"{nums[0]}\u2192{nums[-1]}"
    D["segs"] = out + mains
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])

def _group(key, cap=22, hop=110):
    """Group neighbouring segments (in walking order) into one, up to ~cap houses,
    only when the next one starts close to where the last ended and stays on the same side of Baptist Church Rd."""
    D = next(d for d in DENS if d["key"] == key)
    segs = [x for x in D["segs"] if not x.get("main")]; mains = [x for x in D["segs"] if x.get("main")]
    side = lambda h: 0 if h[1] < 3858 * KX else 1
    out = []
    for x in segs:
        p = out[-1] if out else None
        if p:
            a = p["parts"][-1]["houses"][-1] if p.get("parts") else p["houses"][-1]
            b = x["houses"][0]
            if p["n"] + x["n"] <= cap and math.dist(a[1:], b[1:]) < hop and side(a) == side(b):
                p.setdefault("parts", [dict(street=p["street"], houses=p["houses"])])
                p["parts"] += x.get("parts", [dict(street=x["street"], houses=x["houses"])])
                p["n"] += x["n"]
                p["grouped"] = p.get("grouped", [dict(street=p["street"], side=p.get("disp", p["side"]), rng=p["range"], label=p.get("label"))])
                p["grouped"].append(dict(street=x["street"], side=x.get("disp", x["side"]), rng=x["range"], label=x.get("label")))
                names = []
                for g in p["grouped"]:
                    nm = (g["label"] or title(g["street"])).split(" + ")[0]
                    nm = nm.rsplit(" ", 1)[0] if nm.split()[-1] in ("Dr", "Ct", "Ln", "Rd", "Ter", "Ave", "Cir") else nm
                    if not names or names[-1] != nm: names.append(nm)
                p["label"] = " + ".join(names)
                def _bit(g):
                    nm = (g["label"] or title(g["street"])).split(" + ")[0].rsplit(" ", 1)[0]
                    sd = g["side"].split(":")[0]
                    return nm + (" loop" if sd == "both sides" else " " + sd)
                bits = []
                for g in p["grouped"]:
                    b = _bit(g)
                    if not bits or bits[-1] != b: bits.append(b)
                p["disp"] = " \u00b7 ".join(bits)
                if len({b.rsplit(" ", 2)[0] if b.endswith(" side") else b for b in bits}) == 1 and len(bits) > 1:
                    p["disp"] = "both sides"
                nums = [h[0] for q in p["parts"] for h in q["houses"]]
                p["range"] = f"{min(nums)}\u2013{max(nums)}"
                for k in ("musick",):
                    if x.get(k): p[k] = p.get(k, []) + x[k]
                if x.get("warn"): p["warn"] = x["warn"]
                continue
        out.append(x)
    for i, x in enumerate(out, 1):
        x["id"] = f"{PFX.get(key, key)}{i}"
    D["segs"] = out + mains
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
for _k in ("L", "T", "W", "B", "WB", "A"):
    _group(_k)

def _bears_custom():
    B = next(d for d in DENS if d["key"] == "B")
    S = [x for x in B["segs"] if not x.get("main")]
    def plist(x): return x.get("parts", [dict(street=x["street"], houses=x["houses"])])
    def finish(x, label=None, disp=None):
        ps = [p for p in x["parts"] if p["houses"]]
        x["parts"] = ps; x["houses"] = ps[0]["houses"]; x["street"] = ps[0]["street"]
        allh = [h for p in ps for h in p["houses"]]
        x["n"] = len(allh); x["first"], x["last"] = allh[0][0], allh[-1][0]
        x["range"] = f"{allh[0][0]}\u2192{allh[-1][0]}"
        if label: x["label"] = label
        if disp: x["disp"] = disp
    TC_Y = 3981   # Three Court Dr crosses Dandridge here
    dE = next(x for x in S if x["street"] == "DANDRIDGE DR" and x.get("disp") == "E side")
    dW = next(x for x in S if x["street"] == "DANDRIDGE DR" and x.get("disp") == "W side" and any(h[0] == 10337 for h in x["houses"]))
    eLow = [h for h in dE["houses"] if h[2] < TC_Y]; wLow = [h for h in dW["houses"] if h[2] < TC_Y]
    dE["houses"] = [h for h in dE["houses"] if h[2] >= TC_Y]; dE.pop("parts", None)
    dW["houses"] = [h for h in dW["houses"] if h[2] >= TC_Y]; dW.pop("parts", None)
    for x in (dE, dW):
        x["parts"] = plist(x); finish(x)
    b8 = next(x for x in S if x.get("disp") == "S side, east of Dandridge")
    b8["parts"] = plist(b8) + [dict(street="DANDRIDGE DR", houses=sorted(eLow, key=lambda h: -h[2]))]
    finish(b8, "Three Court + Dandridge", "Three Court S side to Dandridge, then Dandridge E side south")
    b10 = next(x for x in S if x.get("label") == "Three Court Dr + 2 courts")
    b10["parts"] = [dict(street="DANDRIDGE DR", houses=sorted(wLow, key=lambda h: h[2]))] + plist(b10)
    finish(b10, "Dandridge + Three Court + 2 courts", "Dandridge W side north to Three Court, then Three Court S side west, into each court")
    # Pickwick west side + Galena + Palmyra -> two halves, split between Galena and Palmyra
    pw = next(x for x in S if x["street"] == "PICKWICK DR" and x.get("disp") == "W side")
    gp = next(x for x in S if x.get("label") == "Galena + Palmyra")
    gal = next(p for p in plist(gp) if p["street"] == "GALENA CT")["houses"]
    pal = next(p for p in plist(gp) if p["street"] == "PALMYRA CT")["houses"]
    P = sorted(pw["houses"], key=lambda h: -h[2])
    n1 = dict(street="PICKWICK DR", side="odd side", parts=[dict(street="PICKWICK DR", houses=[h for h in P if h[2] >= 4226]),
              dict(street="GALENA CT", houses=gal), dict(street="PICKWICK DR", houses=[h for h in P if 4180 <= h[2] < 4226])])
    n2 = dict(street="PICKWICK DR", side="odd side", parts=[dict(street="PICKWICK DR", houses=[h for h in P if 4115 <= h[2] < 4180]),
              dict(street="PALMYRA CT", houses=pal), dict(street="PICKWICK DR", houses=[h for h in P if h[2] < 4115])])
    finish(n1, "Pickwick + Galena Ct", "Pickwick W side (Bernadine to Galena), Galena loop")
    finish(n2, "Pickwick + Palmyra Ct", "Pickwick W side (Galena to Three Court), Palmyra loop")
    i = B["segs"].index(pw); B["segs"][i] = n1
    j = B["segs"].index(gp); B["segs"][j] = n2
    # the two Faraday houses east of Pickwick go with Pickwick's east side
    fa = next(x for x in S if x.get("label") == "Faraday")
    pe_ = next(x for x in S if x["street"] == "PICKWICK DR" and x.get("disp") == "E side")
    move = [h for p in plist(fa) for h in p["houses"] if h[0] in (10808, 10809)]
    fa["parts"] = [dict(street=p["street"], houses=[h for h in p["houses"] if h[0] not in (10808, 10809)]) for p in plist(fa)]
    finish(fa)
    nums = [h[0] for p in fa["parts"] for h in p["houses"]]; fa["range"] = f"{min(nums)}\u2013{max(nums)}"
    ph = pe_["houses"]
    cut = next(k for k, h in enumerate(ph) if h[2] > 4300)      # going north, insert at Faraday
    pe_["parts"] = [dict(street="PICKWICK DR", houses=ph[:cut]),
                    dict(street="FARADAY DR", houses=sorted(move, key=lambda h: h[2])),
                    dict(street="PICKWICK DR", houses=ph[cut:])]
    finish(pe_, "Pickwick + 2 on Faraday", "E side, Three Court \u2192 Bernadine, plus 10808/10809 Faraday")
    pe_["range"] = f"{pe_['first']}\u2192{pe_['last']}"
    k = 1
    for x in B["segs"]:
        if not x.get("main"):
            x["id"] = f"B{k}"; k += 1
    B["total"] = B["grand"] = sum(x["n"] for x in B["segs"])
_bears_custom()

def _webelos_both_sides():
    """Webelos side streets: one segment per street, up one side and back the other.
    Musick corner lots stay with their side street; Kamping is split into two halves."""
    D = next(d for d in DENS if d["key"] == "WB")
    REDO = ["FLORINDA DR", "LAVINIA DR", "FABICK DR", "CRECELIUS DR", "SONATA DR", "KAMPING LN"]
    keep, pool, warns = [], defaultdict(list), {}
    musick = []
    for x in D["segs"]:
        streets_in = {p["street"] for p in x.get("parts", [x])}
        if x.get("main") or not (streets_in & set(REDO + ["MUSICK MANOR LN"])):
            keep.append(x); continue
        if x.get("warn"): warns[x["warn"]] = x
        for p in x.get("parts", [dict(street=x["street"], houses=x["houses"])]):
            if p["street"] == "MUSICK AVE": musick += p["houses"]
            else: pool[p["street"]] += p["houses"]
    # each Musick corner lot joins the street whose houses are nearest
    corner = defaultdict(list)
    ONMUSICK = {10128, 10134}                 # shared driveway off Musick Rd, not reachable from Lavinia
    drive = [h for h in musick if h[0] in ONMUSICK]
    musick = [h for h in musick if h[0] not in ONMUSICK]
    for h in musick:
        st = min(pool, key=lambda k: min(math.dist(h[1:], q[1:]) for q in pool[k]))
        corner[st].append(h)
    def both(st, hs, cor):
        allh = hs + cor
        cx = sum(h[1] for h in allh) / len(allh); cy = sum(h[2] for h in allh) / len(allh)
        sxx = sum((h[1]-cx)**2 for h in allh); syy = sum((h[2]-cy)**2 for h in allh); sxy = sum((h[1]-cx)*(h[2]-cy) for h in allh)
        ang = 0.5 * math.atan2(2*sxy, sxx - syy); u = (math.cos(ang), math.sin(ang))
        pr = lambda h: (h[1]-cx)*u[0] + (h[2]-cy)*u[1]
        ref = cor or [min(allh, key=lambda h: h[1])]           # start at the Musick end (or west end)
        if sum(pr(h) for h in ref) / len(ref) > 0: pr_ = lambda h: -pr(h)
        else: pr_ = pr
        odd_sign = 1 if sum(_sidesign(st, h[1:]) for h in hs if h[0] % 2) >= 0 else -1
        isodd = lambda h: (h[0] % 2 == 1) if h in hs else (_sidesign(st, h[1:]) == odd_sign)
        s1 = sorted([h for h in allh if isodd(h)], key=pr_)
        s2 = sorted([h for h in allh if not isodd(h)], key=pr_)
        if s2 and s1 and pr_(s2[0]) < pr_(s1[0]): s1, s2 = s2, s1
        return s1, s2[::-1], pr_
    def mkseg(st, s1, s2, label):
        parts = [dict(street=st, houses=s1)] + ([dict(street=st, houses=s2)] if s2 else [])
        parts = [p for p in parts if p["houses"]]
        allh = [h for p in parts for h in p["houses"]]
        nums = [h[0] for h in allh]
        seg = dict(street=st, side="both sides", houses=parts[0]["houses"], parts=parts, n=len(allh),
                   first=allh[0][0], last=allh[-1][0], range=f"{min(nums)}\u2013{max(nums)}", label=label,
                   disp="both sides" + (" + Musick corner" + ("s" if sum(1 for h in allh if h[0] < 10400 and st != "FLORINDA DR") > 1 else "") if any(h[0] < 10400 for h in allh) and st != "FLORINDA DR" else ""))
        for w, src in warns.items():
            if any(h[0] == 10304 for h in allh) and "10304" in w: seg["warn"] = w
        return seg
    new = []
    for st in REDO:
        hs, cor = pool.get(st, []), corner.get(st, [])
        if not hs: continue
        lab = title(st).rsplit(" ", 1)[0]
        s1, s2, pr_ = both(st, hs, cor)
        if len(s1) + len(s2) > 30:
            allh = s1 + s2; mid = sorted(pr_(h) for h in allh)[len(allh)//2]
            a1 = [h for h in s1 if pr_(h) <= mid]; a2 = [h for h in s2 if pr_(h) <= mid]
            b1 = [h for h in s1 if pr_(h) > mid];  b2 = [h for h in s2 if pr_(h) > mid]
            new.append(mkseg(st, a1, a2, lab + " (Musick end)"))
            new.append(mkseg(st, b1, b2, lab + " (far end)"))
        else:
            seg = mkseg(st, s1, s2, lab)
            new.append(seg)
    # Musick Rd stretch: from Lavinia north along the Musick sidewalk -> shared driveway (10134, 10128)
    # -> Musick Manor Ln (private lane) -> 10104 across the creek
    mm = sorted(pool.get("MUSICK MANOR LN", []), key=lambda h: h[0])
    old_mwe = [x for x in keep if x.get("main") and x["street"] == "MUSICK AVE"]
    far = [h for x in old_mwe for h in x["houses"]]
    for x in old_mwe: keep.remove(x)
    parts = [dict(street="MUSICK AVE", houses=sorted(drive, key=lambda h: -h[0])),
             dict(street="MUSICK MANOR LN", houses=[h for h in mm if h[0] % 2 == 0] + [h for h in mm if h[0] % 2][::-1]),
             dict(street="MUSICK AVE", houses=far)]
    parts = [p for p in parts if p["houses"]]
    allh = [h for p in parts for h in p["houses"]]
    keep.append(dict(street="MUSICK AVE", side="even side", main=True, id="MWE1", houses=parts[0]["houses"], parts=parts,
                     n=len(allh), first=allh[0][0], last=allh[-1][0], range=f"{allh[0][0]}\u2192{allh[-1][0]}",
                     label="Musick Rd + Musick Manor Ln", disp="from Lavinia north on Musick sidewalk",
                     tag_at=(far[0][1] + 34, far[0][2] + 34) if far else None))
    meath = [x for x in keep if not x.get("main") and "MEATH" in x["street"]]
    rest = [x for x in keep if not x.get("main") and x not in meath]
    mains = sorted([x for x in keep if x.get("main")], key=lambda x: x["id"])
    D["segs"] = meath + rest[:1] + new + rest[1:] + mains if rest and rest[0]["street"] == "KILMEADE DR" else meath + new + rest + mains
    k = 1
    for x in D["segs"]:
        if not x.get("main"):
            x["id"] = f"WE{k}"; k += 1
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
_webelos_both_sides()

def _aol_custom():
    D = next(d for d in DENS if d["key"] == "A")
    S = [x for x in D["segs"] if not x.get("main")]
    def parts(x): return x.get("parts", [dict(street=x["street"], houses=x["houses"])])
    a5 = next(x for x in S if x.get("label") == "Mayo + Leitrim")
    a6 = next(x for x in S if x["street"] == "LEITRIM DR")
    north = [h for p in parts(a5) if p["street"] == "LEITRIM DR" for h in p["houses"]]
    mayo = [h for p in parts(a5) if p["street"] == "MAYO DR" for h in p["houses"]]
    for x, ps, lab, disp in ((a5, [dict(street="MAYO DR", houses=mayo)], "Mayo Dr", "E side"),
                             (a6, [dict(street="LEITRIM DR", houses=a6["houses"]), dict(street="LEITRIM DR", houses=north)],
                              "Leitrim Dr", "both sides")):
        x["parts"] = ps; x["houses"] = ps[0]["houses"]
        allh = [h for p in ps for h in p["houses"]]
        x["n"] = len(allh); x["first"], x["last"] = allh[0][0], allh[-1][0]
        x["label"] = lab; x["disp"] = disp; x["side"] = "both sides" if disp == "both sides" else x["side"]
        nums = [h[0] for h in allh]
        x["range"] = f"{min(nums)}\u2013{max(nums)}" if disp == "both sides" else f"{allh[0][0]}\u2192{allh[-1][0]}"
    # Killoren/Kilrush + Kilmeade/Roscommon: regroup, split at Kilrush Dr
    a7 = next(x for x in S if x.get("label") == "Killoren + Kilrush")
    a8 = next(x for x in S if x.get("label") == "Kilmeade + Roscommon")
    get = lambda x, st: [h for p in parts(x) if p["street"] == st for h in p["houses"]]
    kil, klo, kme, ros = get(a7, "KILRUSH DR"), get(a7, "KILLOREN DR"), get(a8, "KILMEADE DR"), get(a8, "ROSCOMMON DR")
    KX_KILRUSH = 5331 * KX
    ros_e = [h for h in ros if h[1] > KX_KILRUSH]
    ros_w = sorted([h for h in ros if h[1] <= KX_KILRUSH], key=lambda h: -h[1])
    KLO = 5210 * KX
    def setp(x, ps, lab, disp):
        ps = [p for p in ps if p["houses"]]
        x["parts"] = ps; x["houses"] = ps[0]["houses"]; x["street"] = ps[0]["street"]
        allh = [h for p in ps for h in p["houses"]]
        x["n"] = len(allh); x["first"], x["last"] = allh[0][0], allh[-1][0]
        x["range"] = f"{allh[0][0]}\u2192{allh[-1][0]}"; x["label"] = lab; x["disp"] = disp
    setp(a7, [dict(street="KILMEADE DR", houses=kme), dict(street="ROSCOMMON DR", houses=ros_e)],
         "Kilmeade + Roscommon", "Kilmeade loop, Roscommon S side to Kilrush")
    setp(a8, [dict(street="KILRUSH DR", houses=kil), dict(street="ROSCOMMON DR", houses=[h for h in ros_w if h[1] > KLO]),
              dict(street="KILLOREN DR", houses=klo), dict(street="ROSCOMMON DR", houses=[h for h in ros_w if h[1] <= KLO])],
         "Kilrush + Killoren + Roscommon", "Kilrush loop, Roscommon S side, Killoren loop")
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
_aol_custom()

def _wolves_east():
    """Kingsmere / Havelock / Edgemoor / Tulane block east of Baptist Church Rd (checked on aerial photo)."""
    D = next(d for d in DENS if d["key"] == "W")
    AREA = {"KINGSMERE DR", "HAVELOCK CT", "EDGEMOOR TER", "TULANE DR"}
    idx = [i for i, x in enumerate(D["segs"]) if not x.get("main") and {p["street"] for p in x.get("parts", [x])} & AREA]
    if not idx: return
    at = idx[0]
    for i in sorted(idx, reverse=True): D["segs"].pop(i)
    A = lambda st: [h for h in addr[st] if inzone(h)]
    KY = 4141
    hav = A("HAVELOCK CT"); king = A("KINGSMERE DR"); edg = A("EDGEMOOR TER"); tul = A("TULANE DR")
    def mk(ps, label, disp, both=True):
        ps = [p for p in ps if p["houses"]]
        allh = [h for p in ps for h in p["houses"]]; nums = [h[0] for h in allh]
        return dict(street=ps[0]["street"], side="both sides" if both else "odd side", houses=ps[0]["houses"], parts=ps,
                    n=len(allh), first=allh[0][0], last=allh[-1][0], label=label, disp=disp,
                    range=f"{min(nums)}\u2013{max(nums)}", direct=ps[0].get("direct", False))
    hv = mk([dict(street="HAVELOCK CT", houses=sorted([h for h in hav if h[0] % 2], key=lambda h: h[0]) +
                  sorted([h for h in hav if h[0] % 2 == 0], key=lambda h: -h[0]))], "Havelock Ct", "both sides (court)")
    kg = mk([dict(street="KINGSMERE DR", houses=sorted([h for h in king if h[2] > 4135], key=lambda h: h[1])),
             dict(street="KINGSMERE DR", houses=sorted([h for h in king if h[2] <= 4135], key=lambda h: -h[1]))],
            "Kingsmere Dr", "both sides")
    north = [h for h in edg if h[2] > KY]
    en = mk([dict(street="EDGEMOOR TER", houses=sorted([h for h in north if h[0] % 2 == 0], key=lambda h: h[0]), direct=True),
             dict(street="EDGEMOOR TER", houses=sorted([h for h in north if h[0] % 2], key=lambda h: -h[0]), direct=True)],
            "Edgemoor Ter (north)", "both sides, to the circle and back")
    south = [h for h in edg if h[2] <= KY]
    leg = sorted([h for h in south if h[1] < 4020 * KX], key=lambda h: -h[2])
    rest = [h for h in south if h[1] >= 4020 * KX]
    arm_s = sorted([h for h in rest if h[0] % 2 == 0], key=lambda h: h[1])
    arm_n = sorted([h for h in rest if h[0] % 2], key=lambda h: -h[1])
    es = mk([dict(street="EDGEMOOR TER", houses=leg + arm_s, direct=True),
             dict(street="TULANE DR", houses=sorted(tul, key=lambda h: h[2]), direct=True),
             dict(street="EDGEMOOR TER", houses=arm_n, direct=True)],
            "Edgemoor Ter (south) + Tulane", "around the bend and up Tulane")
    D["segs"][at:at] = [hv, kg, en, es]
    k = 1
    for x in D["segs"]:
        if not x.get("main"):
            x["id"] = f"W{k}"; k += 1
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
_wolves_east()

def _wolves_fawnhaven():
    """Fawnhaven / Fawnway / Fawndale / Ella Mary (checked on aerial photo)."""
    D = next(d for d in DENS if d["key"] == "W")
    AREA = {"FAWNHAVEN DR", "FAWNWAY DR", "FAWNDALE DR", "ELLA MARY CT"}
    idx = [i for i, x in enumerate(D["segs"]) if not x.get("main") and {p["street"] for p in x.get("parts", [x])} & AREA]
    at = idx[0]
    for i in sorted(idx, reverse=True): D["segs"].pop(i)
    A = lambda st: [h for h in addr[st] if inzone(h)]
    fh, fw, fd, em = A("FAWNHAVEN DR"), A("FAWNWAY DR"), A("FAWNDALE DR"), A("ELLA MARY CT")
    FD = 3232 * KX          # Fawndale meets Fawnhaven
    MID = 3700 * KX         # Fawnhaven south side splits at Arbor Park / Ella Mary
    def mk(ps, label, disp, rng_both=False):
        ps = [p for p in ps if p["houses"]]
        allh = [h for p in ps for h in p["houses"]]; nums = [h[0] for h in allh]
        return dict(street=ps[0]["street"], side="both sides" if rng_both else "odd side", houses=ps[0]["houses"], parts=ps,
                    n=len(allh), first=allh[0][0], last=allh[-1][0], label=label, disp=disp,
                    range=(f"{min(nums)}\u2013{max(nums)}" if rng_both else f"{allh[0][0]}\u2192{allh[-1][0]}"),
                    direct=ps[0].get("direct", False))
    east = [h for h in fh if h[1] > FD]; west = [h for h in fh if h[1] <= FD]
    n_e = sorted([h for h in east if h[0] % 2], key=lambda h: -h[1])
    s_e = sorted([h for h in east if h[0] % 2 == 0], key=lambda h: h[1])
    half = len(n_e) // 2 + len(n_e) % 2
    w1 = mk([dict(street="FAWNHAVEN DR", houses=n_e[:half])], "Fawnhaven Dr", "N side, from Baptist Church west")
    w2 = mk([dict(street="FAWNHAVEN DR", houses=n_e[half:])], "Fawnhaven Dr", "N side, on west to Fawndale")
    INNER_FH = {11224, 11230, 11253}; INNER_FW = {11205, 11211, 11241}
    fh_out = sorted([h for h in west if h[0] not in INNER_FH], key=lambda h: (h[2] < 4380, -h[1] if h[2] >= 4380 else -h[2]))
    fh_in = sorted([h for h in west if h[0] in INNER_FH], key=lambda h: -h[1])
    fw_out = sorted([h for h in fw if h[0] not in INNER_FW], key=lambda h: (h[1] > 3100 * KX, -h[2] if h[1] <= 3100 * KX else h[1]))
    fw_in = sorted([h for h in fw if h[0] in INNER_FW], key=lambda h: h[1])
    fd_w = sorted([h for h in fd if h[0] % 2], key=lambda h: h[2])
    fd_e = sorted([h for h in fd if h[0] % 2 == 0], key=lambda h: h[2])
    w3 = mk([dict(street="FAWNHAVEN DR", houses=fh_out), dict(street="FAWNWAY DR", houses=fw_out, direct=True)],
            "Fawnhaven + Fawnway (outer)", "outer side of the loop, Fawndale to Fawndale", True)
    w4 = mk([dict(street="FAWNHAVEN DR", houses=fh_in), dict(street="FAWNWAY DR", houses=fw_in, direct=True),
             dict(street="FAWNDALE DR", houses=fd_w, direct=True)],
            "Fawnhaven + Fawnway + Fawndale (inner)", "inner side of the loop", True)
    w5 = mk([dict(street="FAWNDALE DR", houses=fd_e, direct=True),
             dict(street="FAWNHAVEN DR", houses=[h for h in s_e if h[1] <= MID])],
            "Fawndale + Fawnhaven", "Fawndale east side north, then Fawnhaven S side east")
    emo = sorted(em, key=lambda h: (h[0] % 2 == 0, h[0] if h[0] % 2 else -h[0]))
    w6 = mk([dict(street="FAWNHAVEN DR", houses=[h for h in s_e if h[1] > MID]), dict(street="ELLA MARY CT", houses=emo)],
            "Fawnhaven + Ella Mary Ct", "S side on to Baptist Church, Ella Mary loop")
    D["segs"][at:at] = [w1, w2, w3, w4, w5, w6]
    k = 1
    for x in D["segs"]:
        if not x.get("main"):
            x["id"] = f"W{k}"; k += 1
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
_wolves_fawnhaven()

def _wolves_alpena():
    D = next(d for d in DENS if d["key"] == "W")
    idx = [i for i, x in enumerate(D["segs"]) if not x.get("main") and {p["street"] for p in x.get("parts", [x])} & {"ALPENA DR", "ABDELL DR"}]
    at = idx[0]
    for i in sorted(idx, reverse=True): D["segs"].pop(i)
    A = lambda st: [h for h in addr[st] if inzone(h)]
    ab, al = A("ABDELL DR"), A("ALPENA DR")
    abo = sorted([h for h in ab if h[0] % 2], key=lambda h: h[0]) + sorted([h for h in ab if h[0] % 2 == 0], key=lambda h: -h[0])
    cds = [h for h in al if h[1] < 3120 * KX]                        # little court west of Littie
    main = [h for h in al if h[1] >= 3120 * KX]
    odd = sorted([h for h in main if h[0] % 2], key=lambda h: h[0])
    even = sorted([h for h in main if h[0] % 2 == 0], key=lambda h: -h[0])
    cds = sorted(cds, key=lambda h: h[0])
    def mk(ps, label, disp):
        ps = [p for p in ps if p["houses"]]
        allh = [h for p in ps for h in p["houses"]]; nums = [h[0] for h in allh]
        return dict(street=ps[0]["street"], side="both sides", houses=ps[0]["houses"], parts=ps, n=len(allh),
                    first=allh[0][0], last=allh[-1][0], label=label, disp=disp, range=f"{min(nums)}\u2013{max(nums)}")
    D["segs"][at:at] = [mk([dict(street="ABDELL DR", houses=abo)], "Abdell Dr", "both sides"),
                        mk([dict(street="ALPENA DR", houses=odd), dict(street="ALPENA DR", houses=cds, direct=True),
                            dict(street="ALPENA DR", houses=even)], "Alpena Dr",
                           "both sides + little court")]
    k = 1
    for x in D["segs"]:
        if not x.get("main"):
            x["id"] = f"W{k}"; k += 1
    D["total"] = D["grand"] = sum(x["n"] for x in D["segs"])
_wolves_alpena()

def _wolves_tweaks():
    D = next(d for d in DENS if d["key"] == "W")
    S = D["segs"]
    def P(x): return x.get("parts", [dict(street=x["street"], houses=x["houses"])])
    def fin(x, label=None, disp=None, both=False):
        ps = [p for p in x["parts"] if p["houses"]]
        x["parts"] = ps; x["houses"] = ps[0]["houses"]; x["street"] = ps[0]["street"]; x["direct"] = ps[0].get("direct", False)
        allh = [h for p in ps for h in p["houses"]]; nums = [h[0] for h in allh]
        x["n"] = len(allh); x["first"], x["last"] = allh[0][0], allh[-1][0]
        x["range"] = f"{min(nums)}\u2013{max(nums)}" if both else f"{allh[0][0]}\u2192{allh[-1][0]}"
        if label: x["label"] = label
        if disp: x["disp"] = disp
    def loop(st, hs):
        o = sorted([h for h in hs if h[0] % 2], key=lambda h: h[0]); e = sorted([h for h in hs if h[0] % 2 == 0], key=lambda h: -h[0])
        return [dict(street=st, houses=o), dict(street=st, houses=e)]
    find = lambda lab: next(x for x in S if x.get("label") == lab)
    # 1+2: Fawnhaven bit of the old W6 -> W5; Ella Mary Ct joins Arbor Park Ln
    w6 = find("Fawnhaven + Ella Mary Ct"); w5 = find("Fawndale + Fawnhaven")
    fh = [h for p in P(w6) if p["street"] == "FAWNHAVEN DR" for h in p["houses"]]
    em = [h for p in P(w6) if p["street"] == "ELLA MARY CT" for h in p["houses"]]
    w5["parts"] = P(w5) + [dict(street="FAWNHAVEN DR", houses=fh)]; fin(w5, disp="Fawndale E side, Fawnhaven S side east")
    S.remove(w6)
    ap = next(x for x in S if x["street"] == "ARBOR PARK LN")
    aph = [h for p in P(ap) for h in p["houses"]]
    ap["parts"] = loop("ARBOR PARK LN", aph) + loop("ELLA MARY CT", em)
    fin(ap, "Arbor Park Ln + Ella Mary Ct", "two courts off Littie Rd", True)
    # 3: Kingsmere Ct joins Patrina S side (starts at Baptist Church)
    mw2 = next(x for x in S if x.get("id") == "MW2")
    kc = [h for p in P(mw2) if p["street"] == "KINGSMERE CT" for h in p["houses"]]
    mw2["parts"] = [p for p in P(mw2) if p["street"] != "KINGSMERE CT"]; fin(mw2, label="Baptist Church Rd")
    ps_ = next(x for x in S if x["street"] == "PATRINA CT" and x.get("disp", "").startswith("S side"))
    ps_["parts"] = loop("KINGSMERE CT", kc) + P(ps_); fin(ps_, "Kingsmere Ct + Patrina Ct", "Kingsmere Ct, then Patrina S side")
    # 4: Abdell both sides, drawn as two sides
    ab = find("Abdell Dr"); ab["parts"] = loop("ABDELL DR", [h for p in P(ab) for h in p["houses"]]); fin(ab, disp="both sides", both=True)
    # 5: Patrina north side as one segment
    pn = [x for x in S if x["street"] == "PATRINA CT" and x.get("disp", "").startswith("N side")]
    if len(pn) > 1:
        pn[0]["parts"] = [dict(street="PATRINA CT", houses=[h for x in pn for p in P(x) for h in p["houses"]])]
        fin(pn[0], "Patrina Ct", "N side, west end back to Baptist Church")
        for x in pn[1:]: S.remove(x)
    k = 1
    for x in S:
        if not x.get("main"):
            x["id"] = f"W{k}"; k += 1
    D["total"] = D["grand"] = sum(x["n"] for x in S)
_wolves_tweaks()

_AGE = ["L", "T", "W", "B", "WB", "A"]
DENS.sort(key=lambda d: _AGE.index(d["key"]) if d["key"] in _AGE else 99)
PAGE = {d["key"]: i + 2 for i, d in enumerate(DENS)}  # page 1 = overview, last = log

# ---------- snap routes to street centerlines (sidewalk side) ----------
PIECES = defaultdict(list)
for _n, _s, _p in streets:
    if len(_p) > 1: PIECES[_n].append(_p)
OFF = 11  # ~12 m from centreline = sidewalk / front of house

def _proj(H, piece):
    best = None
    for k, (a, b) in enumerate(zip(piece, piece[1:])):
        dx, dy = b[0]-a[0], b[1]-a[1]; L2 = dx*dx + dy*dy or 1e-9
        t = max(0, min(1, ((H[0]-a[0])*dx + (H[1]-a[1])*dy) / L2))
        P = (a[0]+dx*t, a[1]+dy*t); d = math.dist(H, P)
        if best is None or d < best[0]:
            side = 1 if dx*(H[1]-a[1]) - dy*(H[0]-a[0]) > 0 else -1
            best = (d, k, t, P, side)
    return best

def _normal(piece, i):
    vs = []
    for k in (i-1, i):
        if 0 <= k < len(piece)-1:
            a, b = piece[k], piece[k+1]; L = math.dist(a, b) or 1
            vs.append((-(b[1]-a[1])/L, (b[0]-a[0])/L))
    return (sum(v[0] for v in vs)/len(vs), sum(v[1] for v in vs)/len(vs))

def court_path(seg):
    ex, cy = seg["court"]                      # court entrance x and bulb centre y
    hs = seg["houses"]
    r = 15
    start = (ex, 3966)                         # just off Three Court Dr
    neck = (ex, cy + r)
    angs = sorted(math.atan2(h[2] - cy, h[1] - ex) for h in hs)
    a0 = math.pi / 2                           # enter at the top of the bulb
    ring = [(ex + r * math.cos(a0 - t * 2 * math.pi / 24), cy + r * math.sin(a0 - t * 2 * math.pi / 24)) for t in range(25)]
    return [start, neck] + ring + [neck, start]

def street_route(seg):
    if seg.get("court"): return court_path(seg)
    if seg.get("direct"): return [(h[1], h[2]) for h in seg["houses"]]
    pieces = PIECES.get(seg["street"])
    if not pieces:
        return [(h[1], h[2]) for h in seg["houses"]]
    locs = []
    for h in seg["houses"]:
        H = (h[1], h[2])
        best = None
        for pi, pc in enumerate(pieces):
            r = _proj(H, pc)
            if best is None or r[0] < best[1][0]: best = (pi, r)
        pi, (d, k, t, P, side) = best
        u = ((H[0]-P[0])/d, (H[1]-P[1])/d) if d > 1e-6 else (0, 0)
        S = (P[0]+u[0]*min(OFF, d), P[1]+u[1]*min(OFF, d))
        locs.append((pi, k + t, S, side))
    pts = [locs[0][2]]
    for (pi, pos, S, side), (pj, pos2, S2, side2) in zip(locs, locs[1:]):
        if pi == pj and side == side2:
            pc = pieces[pi]
            lo, hi = sorted((pos, pos2))
            verts = [v for v in range(len(pc)) if lo < v < hi]
            if pos2 < pos: verts = verts[::-1]
            for v in verts:
                n = _normal(pc, v)
                pts.append((pc[v][0] + n[0]*OFF*side, pc[v][1] + n[1]*OFF*side))
        pts.append(S2)
    return pts

def penlift(pts, hop=115):
    xs, ys = [pts[0][0]], [pts[0][1]]
    for a, b in zip(pts, pts[1:]):
        if math.dist(a, b) > hop:
            xs.append(float("nan")); ys.append(float("nan"))
        xs.append(b[0]); ys.append(b[1])
    return xs, ys

def mid_on(pts):
    L = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    if L == 0: return pts[0]
    acc = 0
    for a, b in zip(pts, pts[1:]):
        d = math.dist(a, b)
        if acc + d >= L/2 and d > 0:
            t = (L/2 - acc)/d; return (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
        acc += d
    return pts[-1]

# ---------- drawing ----------
SEG_COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#e377c2", "#8c564b", "#bcbd22", "#0b3d91"]

import os
BW = os.environ.get("BW") == "1"
BW_DEN = {"L": 0.90, "T": 0.80, "W": 0.72, "B": 0.84, "WB": 0.74, "A": 0.90}
_BW_LS = ["-", (0, (5, 2)), (0, (1.2, 1.4)), (0, (6, 2, 1.2, 2)), (0, (10, 3))]
def bw_style(c):
    """black-and-white: 10 palette colours -> 2 greys x 5 line patterns"""
    k = SEG_COLORS.index(c) if c in SEG_COLORS else 0
    return ("#000000" if k % 2 == 0 else "#585858"), _BW_LS[k // 2 % 5]


HOUSE_ST = {}
for _st, _hs in addr.items():
    for _h in _hs: HOUSE_ST[(_h[0], round(_h[1], 3), _h[2])] = _st
def street_runs(sg):
    """Houses of a segment in walking order, grouped into consecutive runs by their real street."""
    ps = sg.get("parts", [dict(street=sg["street"], houses=sg["houses"])])
    L = []
    for p in ps:
        for h in p["houses"]:
            st = HOUSE_ST.get((h[0], round(h[1], 3), h[2]), p["street"])
            if L and L[-1]["street"] == st: L[-1]["houses"].append(h)
            else: L.append(dict(street=st, houses=[h]))
    return L


MAIN_ST = {"BAPTIST CHURCH RD", "MUSICK AVE", "TESSON FERRY RD", "LINDBERGH BLVD"}
def warn_placement(sg, L):
    """Return list of (line index, text): warnings that belong under one particular line."""
    out = []
    w = sg.get("warn")
    if w:
        m = re.search(r"(\d{4,5})", w)
        idx = next((k for k, ln in enumerate(L) if m and any(h[0] == int(m.group(1)) for h in ln["houses"])), len(L) - 1)
        txt = w
        ln = L[idx]
        if m and len(ln["houses"]) == 1: txt = w.replace(m.group(1) + ": ", "").replace(m.group(1), "").strip()
        out.append((idx, txt))
    if sg.get("main"):
        txt = "\u26a0 MAIN ROAD" + (" \u2013 NO SIDEWALK" if sg.get("nosidewalk") else "")
        mains = [k for k, ln in enumerate(L) if ln["street"] in MAIN_ST]
        if len(L) > 1 and len(mains) == 1: out.append((mains[0], txt))
        elif len(L) > 1: out.append((len(L) - 1, txt))
    return out

def seg_colors(den):
    """Give each segment a colour that no nearby segment in the same den uses (within ~250 m),
    and that differs from the segment numbered just before it."""
    segs = den["segs"]
    pts = [[h[1:] for p in x.get("parts", [x]) for h in p["houses"]] for x in segs]
    def near(i, j):
        return min(math.dist(a, b) for a in pts[i][::2] for b in pts[j][::2]) < 380
    out = []
    for i in range(len(segs)):
        banned = {out[j] for j in range(i) if near(i, j) or j == i - 1}
        free = [k for k in range(len(SEG_COLORS)) if k not in banned]
        if not free:   # fall back to the colour used farthest away
            far = {}
            for j in range(i):
                d = min(math.dist(a, b) for a in pts[i][::2] for b in pts[j][::2])
                far[out[j]] = min(far.get(out[j], 1e9), d)
            free = [max(far, key=far.get)]
        out.append(free[0] if i < len(SEG_COLORS) else free[i % len(free)])
    return [SEG_COLORS[k] for k in out]

ARTERIALS = {
  "Baptist Church Rd": "3847,3264 3849,3361 3852,3516 3853,3674 3854,3997 3856,4141 3858,4278 3861,4396 3862,4498 3863,4646 3863,4691 3862,4878 3862,5006 3862,5260",
  "Musick Rd": "5511,4078 5455,4124 5345,4179 5276,4214 5181,4262 5093,4305 5026,4339 5007,4353 4963,4399 4933,4457 4885,4569 4855,4639 4835,4684 4807,4786 4808,4870 4808,4941 4809,5098 4810,5284 4811,5356 4813,5498 4811,5572",
  "S Lindbergh Blvd": "2741,3765 2806,3752 2913,3729 2979,3714 3058,3697 3160,3664 3202,3656 3312,3632 3406,3612 3687,3552 3852,3516 4121,3458 4251,3441 4556,3381 4807,3329",
  "Tesson Ferry Rd": "4102,3106 4284,3156 4388,3203 4482,3280 4547,3368 4643,3504 4733,3599 4811,3654 4972,3737 5058,3799 5239,3941 5363,4034 5438,4065 5511,4078 5719,4101 5842,4148 5918,4212 6027,4367",
  "Gravois Rd": "2798,4997 2978,5072 3210,5127 3564,5180 3738,5219 3862,5260 4011,5311 4218,5379 4309,5409 4652,5522 4811,5572 5108,5671",
}
def _ext(pts, far=4000):
    (a, b), (c, d) = pts[:2], pts[-2:]
    u = math.dist(a, b) or 1; v = math.dist(c, d) or 1
    return [(a[0] + (a[0]-b[0])/u*far, a[1] + (a[1]-b[1])/u*far)] + pts + [(d[0] + (d[0]-c[0])/v*far, d[1] + (d[1]-c[1])/v*far)]
ARTS = {n: _ext([(int(x)*KX, int(y)) for x, y in (p.split(",") for p in t.split())]) for n, t in ARTERIALS.items()}
_ARTNAMES = {"BAPTIST CHURCH RD", "MUSICK AVE", "MUSICK RD", "S LINDBERGH BLVD", "LINDBERGH BLVD", "TESSON FERRY RD", "GRAVOIS RD"}

def draw_arterials(ax, bbox, label=True):
    x0, y0, x1, y1 = bbox
    for n, pts in ARTS.items():
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color="#c8c8c8", lw=11, solid_capstyle="butt", zorder=1.2)
        ax.plot(xs, ys, color="#fff6dc", lw=8.4, solid_capstyle="butt", zorder=1.3)
        if not label: continue
        # label at the middle of the part that is on this map
        inside = []
        for a, b in zip(pts, pts[1:]):
            for k in range(21):
                p = (a[0] + (b[0]-a[0])*k/20, a[1] + (b[1]-a[1])*k/20)
                if x0 + 25 <= p[0] <= x1 - 25 and y0 + 25 <= p[1] <= y1 - 25:
                    inside.append((p, math.degrees(math.atan2(b[1]-a[1], b[0]-a[0]))))
        if len(inside) < 3: continue
        for frac in ((0.12, 0.88) if len(inside) > 40 else (0.5,)):
            p, ang = inside[int(len(inside) * frac)]
            if ang > 90: ang -= 180
            if ang < -90: ang += 180
            ax.text(p[0], p[1], n, fontsize=7, color="#7a5a00", rotation=ang, rotation_mode="anchor", ha="center", clip_on=True,
                    va="center", zorder=8.5, fontweight="bold", path_effects=[pe.withStroke(linewidth=2.5, foreground="white")])

def draw_streets(ax, bbox, label=True):
    x0, y0, x1, y1 = bbox
    seen_label = defaultdict(float)
    for name, sym, pts in streets:
        if name in _ARTNAMES: continue
        if all(not (x0 - 50 <= x <= x1 + 50 and y0 - 50 <= y <= y1 + 50) for x, y in pts):
            continue
        w = 9 if sym >= 3 else 6
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color="#d4d4d4", lw=w, solid_capstyle="round", zorder=1)
        ax.plot(xs, ys, color="#f7f7f7", lw=w - 2.2, solid_capstyle="round", zorder=1.1)
        # label on longest piece
        L = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        if label and L > seen_label[name] and L > 60:
            seen_label[name] = L
    draw_arterials(ax, bbox, label)
    if not label: return
    for name, sym, pts in streets:
        if name in _ARTNAMES: continue
        L = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        if seen_label.get(name) != L: continue
        # midpoint
        acc, half = 0, L / 2
        for a, b in zip(pts, pts[1:]):
            dl = math.dist(a, b)
            if acc + dl >= half:
                t = (half - acc) / dl
                mx, my = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
                if ang > 90: ang -= 180
                if ang < -90: ang += 180
                break
            acc += dl
        if not (x0 <= mx <= x1 and y0 <= my <= y1): continue
        ax.text(mx, my, title(name), fontsize=6.3, color="#555", rotation=ang, rotation_mode="anchor",
                ha="center", va="center", zorder=2, style="italic", clip_on=True,
                path_effects=[pe.withStroke(linewidth=2.5, foreground="white")])

def den_bbox(dens, pad=45):
    hs = [h for d in dens for s in d["segs"] if not (s["street"] == "LINDBERGH BLVD" and len(dens) == 1) for h in s["houses"]]
    xs = [h[1] for h in hs]; ys = [h[2] for h in hs]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad

def fit_bbox(bbox, aspect):
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    if w / h > aspect:
        nh = w / aspect; cy = (y0 + y1) / 2; y0, y1 = cy - nh / 2, cy + nh / 2
    else:
        nw = h * aspect; cx = (x0 + x1) / 2; x0, x1 = cx - nw / 2, cx + nw / 2
    return x0, y0, x1, y1

STOPS = [(3857 * KX, 4141, "All-way stop \u2013 cross here"), (3863 * KX, 4691, "Stop \u2013 Ridge Forest Dr")]  # Baptist Church Rd at Kingsmere Dr / Kingsmere Ct (confirmed on Apple Look Around)
def draw_stops(ax, bbox, label=True):
    x0, y0, x1, y1 = bbox
    for x, y, t in STOPS:
        if not (x0 <= x <= x1 and y0 <= y <= y1): continue
        ax.scatter([x], [y], marker="8", s=170, color="#d0021b", edgecolor="white", linewidth=1.5, zorder=9)
        ax.text(x, y, "STOP", fontsize=3.6, color="white", ha="center", va="center", fontweight="bold", zorder=10)
        if label:
            ax.text(x + 12, y - 14, t, fontsize=6.2, color="#d0021b", ha="left", va="top", fontweight="bold", zorder=10, clip_on=True,
                    path_effects=[pe.withStroke(linewidth=2.5, foreground="white")])

def draw_zones(ax):
    for k, R in ZONES.items():
        xs, ys = zip(*(R + R[:1]))
        ax.plot(xs, ys, color="#222", lw=1.1, ls=(0, (5, 3)), zorder=2.5, alpha=0.7)

def draw_den_map(ax, den, others):
    _SC = seg_colors(den)
    bbox = den_bbox([den])
    pos = ax.get_position(); fig = ax.figure
    aspect = (pos.width * fig.get_figwidth()) / (pos.height * fig.get_figheight())
    bbox = fit_bbox(bbox, aspect)
    draw_streets(ax, bbox)
    draw_zones(ax)
    draw_stops(ax, bbox)
    _bx = [r for r in _other_bld() if any(bbox[0] - 20 < x < bbox[2] + 20 and bbox[1] - 20 < y < bbox[3] + 20 for x, y in r)]
    ax.add_collection(PolyCollection(_bx, facecolors="#efefef", edgecolors="none", lw=0, zorder=1.5))
    # other dens' houses faint
    for o in others:
        if o is den: continue
        for s in o["segs"]:
            _outl(ax, s["houses"], "#dcdcdc", "none", 2, lw=0)
    for i, s in enumerate(den["segs"]):
        c = _SC[i]
        ls = (0, (2.2, 1.2)) if s.get("main") else "-"
        if BW:
            c, ls_ = bw_style(c)
            if not s.get("main"): ls = ls_
        xs = [h[1] for h in s["houses"]]; ys = [h[2] for h in s["houses"]]
        rt = street_route(s); rx, ry = penlift(rt)
        ax.plot(rx, ry, color=c, lw=2.6 if BW else 3.4, alpha=1 if BW else 0.85, ls=ls, solid_capstyle="round", solid_joinstyle="round", zorder=3)
        for p in s.get("parts", [])[1:]:
            px, py = penlift(street_route(p))
            ax.plot(px, py, color=c, lw=2.6 if BW else 3.4, alpha=1 if BW else 0.85, ls=ls, solid_capstyle="round", solid_joinstyle="round", zorder=3)
            xs += [h[1] for h in p["houses"]]; ys += [h[2] for h in p["houses"]]
        _outl(ax, list(zip([0]*len(xs), xs, ys)), _tint(c, 0.6 if BW else 0.45), "none", 4, lw=0)
        # start arrow along the route
        if len(rt) > 1:
            k = 1
            while k < len(rt)-1 and math.dist(rt[0], rt[k]) < 12: k += 1
            ax.annotate("", xy=rt[k], xytext=rt[0],
                        arrowprops=dict(arrowstyle="-|>", color=c, lw=1.6, mutation_scale=12), zorder=5)
        # house numbers at both ends of the segment, placed at the actual houses
        _ps = s.get("parts", [dict(houses=s["houses"])])
        _h0 = _ps[0]["houses"][0]; _h1 = _ps[-1]["houses"][-1]
        for _h, _num in ((_h0, s["first"]), (_h1, s["last"])):
            if _h is _h1 and _h is _h0: continue
            ax.text(_h[1], _h[2] + 9, str(_h[0]), fontsize=5.4, color=c, ha="center", va="bottom", zorder=6,
                    fontweight="bold", path_effects=[pe.withStroke(linewidth=2.2, foreground="white")])
        mx, my = mid_on(rt)
        if s.get("main"):
            mx += -22 if s["side"].startswith("odd") else 22
            my += -40 if s["side"].startswith("odd") else 40
        if s.get("tag_at"):
            mx, my = s["tag_at"]
        ax.text(mx, my, s["id"] + (" \u26a0" if s.get("main") else ""), fontsize=7.2, color="white", ha="center", va="center", fontweight="bold", zorder=7,
                bbox=dict(boxstyle="round,pad=0.25", fc=c, ec="#222" if s.get("main") else "white", lw=1.2))
    ax.set_xlim(bbox[0], bbox[2]); ax.set_ylim(bbox[1], bbox[3])
    ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values(): sp.set_color("#999")
    # north arrow + scale bar (units ~1.1 m; 100 m ~ 90 units)
    x0, y0, x1, y1 = bbox
    ax.annotate("N", xy=(x1 - 25, y1 - 20), xytext=(x1 - 25, y1 - 70), ha="center", fontsize=9, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color="#333", lw=1.5), zorder=8)
    sb = 91  # ~100 m
    ax.plot([x0 + 20, x0 + 20 + sb], [y0 + 18, y0 + 18], color="#333", lw=2, zorder=8)
    ax.text(x0 + 20 + sb / 2, y0 + 24, "100 m (~330 ft)", fontsize=6, ha="center", va="bottom", color="#333", zorder=8)

def draw_checklist(ax, den, part=None, footer=True, lh_max=0.027):
    _SC = seg_colors(den)
    ax.axis("off")
    rows = den["segs"]
    off = 0
    if part is not None:
        off, end = part; _SC = _SC[off:end]; rows = rows[off:end]
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    y = 0.985
    if part is not None: y = 0.96
    if off == 0:
        import textwrap
        SING = {"L": "Lion", "T": "Tiger", "W": "Wolf", "B": "Bear", "WB": "Webelos", "A": "AOL"}
        ax.text(0, y, "Text the dispatcher each ID when done.", fontsize=7.2, color="#333", va="top", fontweight="bold")
        notes = ("Arrow on each coloured line = where that segment starts. "
                 "Small number = first house of the segment. “Both sides” = loop the whole court. "
                 "\u26a0 dashed segments are on a busy main road."
                 + (" Baptist Church Rd has a sidewalk on the EAST side only. Cross Baptist Church Rd at the Kingsmere all-way stop (red STOP marker)."
                    if den["key"] in ("W", "B", "L") else "")
                 + (" Musick Ave has a sidewalk on our (east) side from Larkspur to Sonata, including over the creek bridge. NO sidewalk on our side from Sonata to Kamping." if den["key"] in ("A", "WB") else ""))
        _w = textwrap.wrap(notes, 112 if part else 96)
        ax.text(0, y - (0.05 if part else 0.03), "\n".join(_w), fontsize=5.6, color="#555", va="top", linespacing=1.25)
        y -= (0.05 if part else 0.03) + 0.0145 * len(_w) * (0.82 / 0.38 if part else 1) + 0.012
    elif part is not None:
        y -= 0.05 + 0.0145 * 3 * (0.82 / 0.38) + 0.012
    y -= 0.035
    cols = [0.0, 0.10, 0.60, 0.79, 0.86, 0.99]
    if os.environ.get("NUMFIRST", "1") == "1": cols = [0.0, 0.31, 0.10, 0.685, 0.765, 0.885]
    hdr = ["Seg", "Street / side", "Numbers", "Hses", "Bags", "Pickup"]
    for k_, (cx, h) in enumerate(zip(cols, hdr)):
        if k_ == 3: ax.text(cx + 0.03, y, h, fontsize=6.8, fontweight="bold", va="top", color="#555", ha="center")
        elif k_ in (4, 5): ax.text(cx + 0.055, y, h, fontsize=6.8, fontweight="bold", va="top", color="#555", ha="center")
        else: ax.text(cx, y, h, fontsize=6.8, fontweight="bold", va="top", color="#555")
    y -= 0.022 * (2.0 if part else 1)
    ax.plot([0, 1], [y, y], color="#999", lw=0.6)
    if part: y -= 0.01
    # one line per street in a segment (consecutive parts on the same street are merged)
    lines_for = street_runs
    blocks = []
    for sg in rows:
        L = lines_for(sg)
        multi = len(L) > 1
        _w1 = (sg.get("main") or sg.get("warn")) and not multi
        nl = len(L) + (len(warn_placement(sg, L)) if multi else 0) + (2 if _w1 else 0)
        blocks.append((sg, L, multi, max(2, nl)))
    total_lines = sum(b_[3] for b_ in blocks)
    lh = min(lh_max, (y - ((0.08 if part else 0.09) if footer else 0.03)) / max(1, total_lines))
    fs = 7.2 if lh > 0.021 else 6.3
    yy0 = y
    for i, (sg, L, multi, nl) in enumerate(blocks):
        c = _SC[i]
        top = yy0; bh = lh * nl; mid = top - bh / 2
        if i % 2 == 0:
            ax.add_patch(plt.Rectangle((0, top - bh), 1, bh, color="#f3f3f3", zorder=0, lw=0))
        if BW: c = bw_style(c)[0]
        ax.text(cols[0] + 0.005, mid, sg["id"], fontsize=fs, color="white", fontweight="bold", va="center",
                bbox=dict(boxstyle="round,pad=0.2", fc=c, ec=c))
        _hot = sg.get("main") or sg.get("warn")
        warn = ((("\u26a0 MAIN ROAD \u2013 NO SIDEWALK" if sg.get("nosidewalk") else "\u26a0 MAIN ROAD") if sg.get("main") else "")
                + (("  " + sg["warn"]) if sg.get("warn") else "")).strip()
        if not multi:
            ln = L[0] if L else dict(street=sg["street"], houses=sg["houses"])
            name = title(ln["street"])
            if "(" in (sg.get("label") or ""): name += " " + sg["label"][sg["label"].index("("):]
            ax.text(cols[1], top - lh * 0.55, name, fontsize=fs if len(name) < 30 else fs - 1, va="center")
            sub = sg.get("disp", sg["side"])
            _short = name.split()[0]
            if sub.startswith(_short + " "): sub = sub[len(_short) + 1:]
            ax.text(cols[1], top - lh * 1.45, sub, fontsize=fs - 1.2, va="center", color="#666")
            if warn:
                ax.text(cols[1], top - lh * 2.4, warn, fontsize=fs - 1.2, va="center", color="#b00000", fontweight="bold")
            ax.text(cols[2], top - lh * 0.55 if os.environ.get("NUMFIRST", "1") == "1" else mid, sg["range"], fontsize=fs - 0.6, va="center")
            ax.text(cols[3] + 0.03, mid, str(sg["n"]), fontsize=fs, va="center", ha="center")
        else:
            W_ = warn_placement(sg, L); slot = 0
            for k, ln in enumerate(L):
                yk = top - lh * (slot + 0.55); slot += 1
                nums = [h[0] for h in ln["houses"]]
                both = len({n % 2 for n in nums}) > 1
                rng = (f"{min(nums)}\u2013{max(nums)}" if both else f"{nums[0]}\u2192{nums[-1]}") if len(nums) > 1 else str(nums[0])
                name = title(ln["street"]) + ((" + " + ", ".join(ln["extra"])) if ln.get("extra") else "")
                ax.text(cols[1], yk, name, fontsize=fs - 0.4, va="center")
                ax.text(cols[2], yk, rng, fontsize=fs - 0.8, va="center")
                for wi, wt in W_:
                    if wi == k:
                        ax.text(cols[1], top - lh * (slot + 0.45), wt, fontsize=fs - 1.2, va="center", color="#b00000", fontweight="bold")
                        slot += 1
            ax.text(cols[3] + 0.03, mid, str(sg["n"]), fontsize=fs, va="center", ha="center")
        for _c in (cols[4], cols[5]):
            ax.plot([_c + 0.01, _c + 0.10], [mid - lh * 0.4] * 2, color="#333", lw=0.7)
        yy0 -= bh
    rh = (y - yy0) / max(1, len(rows))
    if not footer: return
    yb = y - rh * len(rows) - 0.02
    ax.plot([0, 1], [yb + 0.01, yb + 0.01], color="#999", lw=0.6)
    ax.text(0.11, yb - 0.01, "Total houses", fontsize=7.5, fontweight="bold", va="top")
    ax.text(cols[3] + 0.03, yb - 0.01, str(den["total"]), fontsize=7.5, fontweight="bold", va="top", ha="center")

def header(fig, den):
    fig.text(0.045, 0.955, den["name"], fontsize=22, fontweight="bold", color="#000" if BW else den["color"], va="center")
    sc = f"  •  {den['scouts']} scouts  •  ~{den['grand']/den['scouts']:.0f} houses per scout" if den["scouts"] else ""
    ex = (" + main roads " + ", ".join(x["id"] for x in den["extra"]) + f" ({sum(x['n'] for x in den['extra'])})") if den["extra"] else ""
    fig.text(0.045, 0.915, f"Zone {den['zone']}  •  {den['total']} houses{ex}  •  {len(den['segs'])} segments{sc}",
             fontsize=9.5, color="#444", va="center")
    fig.text(0.94, 0.955, "Scouting for Food 2026 • Pack 3721", fontsize=9, color="#777", ha="right", va="center")
    fig.text(0.045, 0.025, "Address data: St. Louis County GIS address points. Street lines: St. Louis County street centerlines. "
             "Counts include every current address on these streets.", fontsize=6, color="#999")

def den_page(pdf, den):
    fig = plt.figure(figsize=(11, 8.5))
    header(fig, den)
    if den["key"] == "W":
        # wide area: map across the top, checklist in two columns underneath
        ax = fig.add_axes([0.045, 0.42, 0.90, 0.465])
        draw_den_map(ax, den, DENS)
        n = len(den["segs"]); h = (n + 1) // 2
        a1 = fig.add_axes([0.045, 0.03, 0.44, 0.38]); draw_checklist(a1, den, part=(0, h), footer=False, lh_max=0.06)
        a2 = fig.add_axes([0.505, 0.03, 0.44, 0.38]); draw_checklist(a2, den, part=(h, n), footer=True, lh_max=0.06)
    else:
        ax = fig.add_axes([0.045, 0.06, 0.54, 0.82])
        draw_den_map(ax, den, DENS)
        ax2 = fig.add_axes([0.60, 0.06, 0.345, 0.82])
        draw_checklist(ax2, den)
    pdf.savefig(fig); plt.close(fig)

def overview_page(pdf, dens, title_txt, sub):
    fig = plt.figure(figsize=(11, 8.5))
    fig.text(0.045, 0.955, title_txt, fontsize=20, fontweight="bold", va="center")
    fig.text(0.045, 0.915, sub, fontsize=9.5, color="#444", va="center")
    fig.text(0.94, 0.955, "Scouting for Food 2026 • Pack 3721", fontsize=9, color="#777", ha="right", va="center")
    ax = fig.add_axes([0.045, 0.06, 0.62, 0.82])
    pos = ax.get_position()
    bbox = fit_bbox(den_bbox(dens, 60), (pos.width * 11) / (pos.height * 8.5))
    draw_streets(ax, bbox)
    draw_zones(ax)
    draw_stops(ax, bbox, label=False)
    # Sappington Elementary (11011 Gravois Rd)
    sx, sy = (-90.364914 + 90.4) * 1e5 * KX, (38.542702 - 38.49) * 1e5
    from matplotlib.patches import Polygon as _Poly, Rectangle as _Rect
    sc = "#000" if BW else "#5a3d1e"
    ax.add_patch(_Rect((sx - 22, sy - 18), 44, 28, fc="white", ec=sc, lw=1.4, zorder=9))
    ax.add_patch(_Poly([(sx - 28, sy + 10), (sx, sy + 32), (sx + 28, sy + 10)], closed=True, fc=sc, ec=sc, zorder=9))
    ax.add_patch(_Rect((sx - 5, sy - 18), 10, 14, fc=sc, ec=sc, zorder=9.1))
    ax.text(sx, sy - 26, "Sappington\nElementary", fontsize=7.5, fontweight="bold", color=sc, ha="center", va="top",
            zorder=9, linespacing=1.1, path_effects=[pe.withStroke(linewidth=2.5, foreground="white")])
    # shaded den regions: every map cell within ~50 m of a den's house takes that den's colour
    import numpy as np
    from matplotlib.colors import to_rgb
    H = [(h[1], h[2], k) for k, d in enumerate(dens) for s_ in d["segs"] for p in s_.get("parts", [s_]) for h in p["houses"]]
    hx = np.array([h[0] for h in H]); hy = np.array([h[1] for h in H]); hk = np.array([h[2] for h in H])
    step = 4
    gx = np.arange(bbox[0], bbox[2], step); gy = np.arange(bbox[1], bbox[3], step)
    GX, GY = np.meshgrid(gx, gy)
    best = np.full(GX.shape, 1e9); lab = np.full(GX.shape, -1)
    for x_, y_, k_ in zip(hx, hy, hk):
        d2 = (GX - x_) ** 2 + (GY - y_) ** 2
        m = d2 < best; best[m] = d2[m]; lab[m] = k_
    lab[best > 48 ** 2] = -1
    rgba = np.zeros(GX.shape + (4,))
    for k, d in enumerate(dens):
        r, g, b_ = to_rgb(d["color"]); rgba[lab == k] = (r, g, b_, 0.38)
        if BW:
            gv = BW_DEN[d["key"]]; rgba[lab == k] = (gv, gv, gv, 1)
    ax.imshow(rgba, extent=(gx[0], gx[-1] + step, gy[0], gy[-1] + step), origin="lower", zorder=0.5, interpolation="bilinear")
    for k, d in enumerate(dens):
        ax.contour(GX, GY, (lab == k).astype(float), levels=[0.5], colors=["#000" if BW else d["color"]], linewidths=1.6, zorder=0.6)
        pts = [(x_, y_) for x_, y_, k_ in H if k_ == k and not (y_ < 3800)]
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        ax.text(cx, cy, f"{d['name'].replace('Arrow of Light', 'AOL')}\n{d['grand']} houses\npage {PAGE[d['key']]}", fontsize=10, fontweight="bold",
                color="#000" if BW else d["color"], ha="center", va="center", zorder=8, linespacing=1.15,
                path_effects=[pe.withStroke(linewidth=3.5, foreground="white")])
    ax.set_xlim(bbox[0], bbox[2]); ax.set_ylim(bbox[1], bbox[3]); ax.set_aspect("equal")
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values(): sp.set_color("#999")
    lx = fig.add_axes([0.685, 0.06, 0.26, 0.82]); lx.axis("off"); lx.set_xlim(0, 1); lx.set_ylim(0, 1)
    y = 0.98
    lx.text(0, y, "Den", fontsize=7, fontweight="bold", color="#555", va="top")
    lx.text(0.52, y, "Scouts", fontsize=7, fontweight="bold", color="#555", va="top", ha="right")
    lx.text(0.68, y, "Mult", fontsize=7, fontweight="bold", color="#555", va="top", ha="right")
    lx.text(0.85, y, "Hses", fontsize=7, fontweight="bold", color="#555", va="top", ha="right")
    lx.text(1.0, y, "Load\u2020", fontsize=7, fontweight="bold", color="#555", va="top", ha="right")
    y -= 0.05
    for d in dens:
        lx.add_patch(plt.Rectangle((0, y - 0.018), 0.05, 0.022, color=((BW_DEN[d["key"]],) * 3) if BW else d["color"], ec="#000" if BW else None, lw=0.6))
        lx.text(0.08, y - 0.007, f"{d['name'].replace('Arrow of Light', 'AOL')} ({PFX.get(d['key'], d['key'])})", fontsize=8, va="center")
        MULT = {"L":1,"T":1,"W":1.25,"WE":1.25,"B":1.5,"WB":1.75,"A":2}
        lx.text(0.52, y - 0.007, str(d["scouts"]) if d["scouts"] else "\u2013", fontsize=8.5, va="center", ha="right")
        lx.text(0.68, y - 0.007, f"\u00d7{MULT[d['key']]:g}", fontsize=8.5, va="center", ha="right")
        lx.text(0.85, y - 0.007, str(d["grand"]) + ("*" if d["extra"] else ""), fontsize=8.5, va="center", ha="right")
        MULT = {"L":1,"T":1,"W":1.25,"WE":1.25,"B":1.5,"WB":1.75,"A":2}
        lx.text(1.0, y - 0.007, f"{d['grand']/(d['scouts']*MULT[d['key']]):.1f}" if d["scouts"] else "–", fontsize=8.5,
                va="center", ha="right")
        y -= 0.045
    lx.plot([0, 1], [y + 0.012, y + 0.012], color="#999", lw=0.6)
    lx.text(0.08, y - 0.007, "Total", fontsize=8.5, fontweight="bold", va="center")
    lx.text(0.52, y - 0.007, str(sum(d["scouts"] or 0 for d in dens)), fontsize=8.5, fontweight="bold", va="center", ha="right")
    lx.text(0.85, y - 0.007, str(sum(d["grand"] for d in dens)), fontsize=8.5, fontweight="bold", va="center", ha="right")
    y -= 0.045
    y -= 0.02
    import textwrap
    note = ("\u2020 Load = houses \u00f7 (scouts \u00d7 multiplier).\n"
            "Black dashed outline = official pack area C and F.\n"
            "Red STOP = Kingsmere all-way stop: cross Baptist Church Rd here.")
    _nt = "\n".join("\n".join(textwrap.wrap(par, 50)) if par else "" for par in note.split("\n"))
    lx.text(0, y, _nt, fontsize=7, color="#444", va="top", linespacing=1.35)
    # texting instructions
    yi = y - 0.0205 * (_nt.count("\n") + 1) - 0.022
    lx.plot([0, 1], [yi + 0.015, yi + 0.015], color="#999", lw=0.6)
    INSTR = [("Group names", "each group uses its den name plus a letter, e.g. Wolf A, Bear C. One den can split into several groups (Wolf A, Wolf B\u2026)."),
             ("Done with a segment?", "Text the dispatcher your group and the segment ID, e.g. \u201cWolf A \u2013 W7 done\u201d."),
             ("Finished early?", "Text \u201cWolf A available\u201d to get more segments."),
             ("Need more bags?", "Text your current segment, e.g. \u201cW8 need bags\u201d."),
             ("Need help?", "Text the dispatcher.")]
    for lab_, txt_ in INSTR:
        body = "\n".join(textwrap.wrap(lab_ + "  " + txt_, 56))
        first, _, rest = body.partition("\n")
        t_ = lx.text(0, yi, lab_, fontsize=7, fontweight="bold", va="top", color="#000")
        fig.canvas.draw()
        wb = t_.get_window_extent().transformed(lx.transAxes.inverted()).width
        lx.text(wb + 0.015, yi, first[len(lab_):].strip(), fontsize=7, va="top", color="#222")
        if rest: lx.text(0, yi - 0.0185, rest, fontsize=7, va="top", color="#222", linespacing=1.3)
        yi -= 0.0185 * (body.count("\n") + 1) + 0.008
        if lab_ == "Group names":
            lx.text(0, yi - 0.004, "Your group:", fontsize=8.5, fontweight="bold", va="top")
            lx.plot([0.33, 1], [yi - 0.026] * 2, color="#333", lw=0.8)
            yi -= 0.04
    # dispatcher contact blanks
    yb = 0.152
    lx.plot([0, 1], [yb + 0.03, yb + 0.03], color="#999", lw=0.6)
    lx.text(0, yb + 0.01, "Dispatcher", fontsize=9, fontweight="bold", va="top")
    for k_, wk in enumerate(("Week 1 (bags)", "Week 2 (pickup)")):
        yy_ = yb - 0.04 - k_ * 0.068
        lx.text(0, yy_, wk, fontsize=8.5, fontweight="bold", va="bottom")
        lx.text(0.40, yy_, "Name", fontsize=7, color="#555", va="bottom")
        lx.plot([0.51, 1], [yy_ - 0.004] * 2, color="#333", lw=0.7)
        lx.text(0.40, yy_ - 0.031, "Phone", fontsize=7, color="#555", va="bottom")
        lx.plot([0.51, 1], [yy_ - 0.035] * 2, color="#333", lw=0.7)
    pdf.savefig(fig); plt.close(fig)

def seg_lines(sg):
    """Street-by-street lines for a segment: [(street name, number range)]."""
    L = street_runs(sg)
    out = []
    for ln in L:
        nums = [h[0] for h in ln["houses"]]
        both = len({n % 2 for n in nums}) > 1
        rng = (f"{min(nums)}\u2013{max(nums)}" if both else f"{nums[0]}\u2192{nums[-1]}") if len(nums) > 1 else str(nums[0])
        out.append((title(ln["street"]) + ((" + " + ", ".join(ln["extra"])) if ln.get("extra") else ""), rng))
    return out

def log_pages(pdf):
    items = []
    for d in DENS:
        for s in d["segs"]:
            L = seg_lines(s)
            if len(L) == 1:
                dsp = s.get("disp", s["side"]); short = L[0][0].split()[0]
                if dsp.startswith(short + " "): dsp = dsp[len(short) + 1:]
                L = [(L[0][0] + ", " + dsp, L[0][1])]
            if s.get("main"):
                L.append(("\u26a0 MAIN ROAD" + (" \u2013 NO SIDEWALK" if s.get("nosidewalk") else ""), ""))
            items.append((d, s, L))
    per = 62
    pages, cur, used = [], [], 0
    for it in items:
        if used + len(it[2]) > per and cur:
            pages.append(cur); cur, used = [], 0
        cur.append(it); used += len(it[2])
    if cur: pages.append(cur)
    lh = 0.955 / per
    for pi, pg in enumerate(pages):
        fig = plt.figure(figsize=(8.5, 11))
        fig.text(0.07, 0.965, "Dispatcher log", fontsize=18, fontweight="bold")
        fig.text(0.93, 0.965, f"Page {pi+1} of {len(pages)}", fontsize=8, color="#777", ha="right")
        ax = fig.add_axes([0.07, 0.03, 0.86, 0.91]); ax.axis("off"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        cols = [0, 0.08, 0.48, 0.62, 0.69, 0.79, 0.89]
        hdr = ["Seg", "Street / side", "Numbers", "Houses", "Started", "Done", "By (den)"]
        for cx, h in zip(cols, hdr):
            ax.text(cx, 0.995, h, fontsize=7.5, fontweight="bold", color="#555", va="top")
        y = 0.975
        for i, (d, s, L) in enumerate(pg):
            bh = lh * len(L); mid = y - bh / 2
            if i % 2 == 0:
                ax.add_patch(plt.Rectangle((0, y - bh), 1, bh, color="#f3f3f3", lw=0, zorder=0))
            ax.text(0.003, mid, s["id"], fontsize=7, color="white", fontweight="bold", va="center",
                    bbox=dict(boxstyle="round,pad=0.18", fc="#000" if BW else d["color"], ec="#000" if BW else d["color"]))
            for k, (nm, rng) in enumerate(L):
                yk = y - lh * (k + 0.5)
                warn = nm.startswith("\u26a0")
                ax.text(cols[1], yk, nm, fontsize=6.6, va="center", color="#b00000" if warn else "black",
                        fontweight="bold" if warn else "normal")
                ax.text(cols[2], yk, rng, fontsize=6.3, va="center")
            ax.text(cols[3] + 0.025, mid, str(s["n"]), fontsize=7, va="center", ha="center")
            for c in (cols[4], cols[5], cols[6]):
                ax.plot([c, c + 0.09], [mid - lh * 0.35, mid - lh * 0.35], color="#aaa", lw=0.5)
            y -= bh
        pdf.savefig(fig); plt.close(fig)

def log_onepage(pdf):
    items = []
    for d in DENS:
        for s in d["segs"]:
            L = seg_lines(s)
            if len(L) == 1:
                dsp = s.get("disp", s["side"]).split(",")[0]; short = L[0][0].split()[0]
                if dsp.startswith(short + " "): dsp = dsp[len(short) + 1:]
                L = [(L[0][0] + ", " + dsp, L[0][1])]
            runs_ = street_runs(s)
            if len(runs_) > 1:
                for wi, wt in sorted(warn_placement(s, runs_), reverse=True):
                    L.insert(wi + 1, (wt, ""))
            else:
                if s.get("main"):
                    L.append(("\u26a0 MAIN ROAD" + (" \u2013 NO SIDEWALK" if s.get("nosidewalk") else ""), ""))
                if s.get("warn"):
                    L.append((s["warn"], ""))
            items.append((d, s, L))
    total = sum(len(L) for _, _, L in items)
    half, acc, cut = total / 2, 0, 0
    for i, (_, _, L) in enumerate(items):
        if acc + len(L) / 2 > half: cut = i; break
        acc += len(L)
    cols_items = [items[:cut], items[cut:]]
    per = max(sum(len(L) for _, _, L in c) for c in cols_items)
    fig = plt.figure(figsize=(11, 8.5))
    fig.text(0.05, 0.976, "Dispatcher log", fontsize=13, fontweight="bold", va="center")
    fig.text(0.95, 0.976, "Scouting for Food 2026 \u2022 Pack 3721", fontsize=8.5, color="#777", ha="right", va="center")
    lh = 0.965 / (per + 0.3)
    G = 0.055                                   # gutter for the vertical den label
    for ci, colitems in enumerate(cols_items):
        ax = fig.add_axes([0.05 + ci * 0.46, 0.03, 0.44, 0.925]); ax.axis("off"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        cx = [G, G + 0.31, G + 0.455, 0.905, G + 0.15, G + 0.26]
        for k_, (x, h) in enumerate(zip(cx, ["Seg", "Numbers", "Street / side", "Hses", "Help", "Done"])):
            ax.text(x + (0.03 if k_ == 3 else 0), 0.995, h, fontsize=7, fontweight="bold", color="#555", va="top", ha="center" if k_ >= 3 else "left")
        ax.plot([0, 1], [0.975, 0.975], color="#999", lw=0.6)
        y = 0.97
        spans = []
        for i, (d, s, L) in enumerate(colitems):
            bh = lh * len(L); mid = y - bh / 2
            if not spans or spans[-1][0] is not d:
                spans.append([d, y, y]); stripe = 0
            stripe += 1
            if stripe % 2 == 1:
                ax.add_patch(plt.Rectangle((G, y - bh), 1 - G, bh, color="#f1f1f1", lw=0, zorder=0))
            c = "#000" if BW else d["color"]
            ax.text(cx[0] + 0.003, mid, s["id"], fontsize=6.6, color="white", fontweight="bold", va="center",
                    bbox=dict(boxstyle="round,pad=0.16", fc=c, ec=c))
            for k, (nm, rng) in enumerate(L):
                yk = y - lh * (k + 0.5)
                warn = nm.startswith("\u26a0")
                if len(nm) > 38: nm = nm[:37].rstrip(" ,") + "\u2026"
                ax.text(cx[2], yk, nm, fontsize=6.4, va="center", color="#b00000" if warn else "black",
                        fontweight="bold" if warn else "normal")
                ax.text(cx[1], yk, rng, fontsize=6.2, va="center")
            ax.text(cx[3] + 0.03, mid, str(s["n"]), fontsize=6.6, va="center", ha="center")
            yl = y - bh + lh * 0.18                  # write-in lines sit at the bottom of the row
            ax.plot([cx[4] - 0.05, cx[4] + 0.05], [yl, yl], color="#777", lw=0.55)
            ax.plot([cx[5] - 0.04, cx[5] + 0.04], [yl, yl], color="#777", lw=0.55)
            y -= bh
            spans[-1][2] = y
        for d, top, bot in spans:
            c = "#000" if BW else d["color"]
            ax.add_patch(plt.Rectangle((0, bot + lh * 0.05), G * 0.7, top - bot - lh * 0.1, color=c, lw=0, zorder=1))
            lab = {"Arrow of Light": "AOL"}.get(d["name"], d["name"]) + f"  p.{PAGE[d['key']]}"
            if top - bot < 0.09: lab = {"Arrow of Light": "AOL"}.get(d["name"], d["name"])
            ax.text(G * 0.35, (top + bot) / 2, lab, rotation=90, fontsize=7, color="white", fontweight="bold",
                    ha="center", va="center", zorder=2)
            ax.plot([G, 1], [bot, bot], color=c, lw=0.6)
    pdf.savefig(fig); plt.close(fig)


class _Numbered:
    def __init__(self, pdf, total): self.pdf, self.n, self.total = pdf, 0, total
    def savefig(self, fig, **kw):
        self.n += 1
        fig.text(0.955, 0.012, str(self.n), fontsize=9, color="#555", ha="right", va="bottom")
        self.pdf.savefig(fig, **kw)
with PdfPages("SFF-2026-Pack3721-Maps-BW.pdf" if BW else "SFF-2026-Pack3721-Maps.pdf") as _pdf:
    pdf = _Numbered(_pdf, len(DENS) + 2)
    core = [d for d in DENS]
    overview_page(pdf, DENS, "Dispatcher overview – all zones",
                  "Shaded areas = each den’s streets, with its page number. Dispatcher log is on page 8.")
    cz = [d for d in DENS if d["key"] in ("W", "T", "B", "OC")]
    fz = [d for d in DENS if d["key"] in ("WB", "A", "L", "OF")]
    for d in DENS:
        den_page(pdf, d)
    log_onepage(pdf)

for d in DENS:
    print(d["key"], d["name"], d["total"], len(d["segs"]), [ (s["id"], s["n"]) for s in d["segs"]])
