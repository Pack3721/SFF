"""Draw the app's home-screen icons (app/icons/*.png): a white map pin over "SFF" on blue.

Needs Pillow. Run from the repo root:  python3 tools/make_icons.py
"""
from PIL import Image, ImageDraw, ImageFont

BLUE, WHITE = (26, 115, 232), (255, 255, 255)
FONT = "/System/Library/Fonts/SFNSRounded.ttf"   # macOS; any bold sans works


def icon(size, pad=0.0):
    """pad: fraction of the edge kept clear, for Android's round "maskable" crop."""
    S = size * 4                                   # draw big, shrink for smooth edges
    im = Image.new("RGB", (S, S), BLUE)
    d = ImageDraw.Draw(im)
    inner = S * (1 - 2 * pad)
    o = S * pad
    cx, r = S / 2, inner * 0.17                    # pin head
    cy = o + inner * 0.34
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    d.polygon([(cx - r * 0.86, cy + r * 0.5), (cx + r * 0.86, cy + r * 0.5), (cx, cy + r * 2.1)], fill=WHITE)
    d.ellipse([cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42], fill=BLUE)
    try:
        f = ImageFont.truetype(FONT, int(inner * 0.24))
        f.set_variation_by_name("Bold")
    except Exception:
        f = ImageFont.load_default()
    d.text((cx, o + inner * 0.80), "SFF", font=f, fill=WHITE, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)


icon(180).save("app/icons/apple-touch-icon.png")
icon(192).save("app/icons/icon-192.png")
icon(512).save("app/icons/icon-512.png")
icon(512, pad=0.1).save("app/icons/icon-maskable-512.png")
print("wrote app/icons")
