#!/usr/bin/env python3
"""
Generates 1200×630 OG images for the slides catalog.

Pure-PIL placeholder: uses Georgia (system) since Cormorant Garamond isn't
available locally. Visually close enough for link unfurls; replace the
.png files with hand-tuned versions when you have them.

Colors and proportions match _framework/tokens.css (dark palette).

Usage:
    bin/gen-og.py <out.png> <title> [<subtitle>]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG    = (13, 13, 13)        # --color-bg-page
FG    = (228, 223, 216)     # --color-fg
MUTED = (107, 102, 96)      # --color-fg-muted
DIM   = (74, 70, 67)        # --color-fg-dim

GEORGIA         = "/System/Library/Fonts/Supplemental/Georgia.ttf"
GEORGIA_ITALIC  = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
HELVETICA       = "/System/Library/Fonts/Helvetica.ttc"


def load_font(path, size, fallback_index=0):
    try:
        if path.endswith(".ttc"):
            return ImageFont.truetype(path, size=size, index=fallback_index)
        return ImageFont.truetype(path, size=size)
    except (OSError, IOError):
        return ImageFont.load_default()


def text_width(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def draw_orbit_mark(img, cx, cy, scale=1.0):
    """Concentric circles + satellite dot. Mirrors /favicon.svg."""
    d = ImageDraw.Draw(img)
    # outer ring r=21, inner ring r=12.5, core r=4, satellite r=2.75 at top
    rings = [(21, 3), (12.5, 3)]
    for r, sw in rings:
        r *= scale
        sw = max(1, int(round(sw * scale)))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=FG, width=sw)
    # core
    r = 4 * scale
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=FG)
    # satellite at top (favicon places it at y=11 with viewBox=64; cy-21 here)
    sat_offset = 21 * scale
    sr = 2.75 * scale
    sy = cy - sat_offset
    d.ellipse((cx - sr, sy - sr, cx + sr, sy + sr), fill=FG)


def gen(out_path, title, subtitle):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Eyebrow + mark, top-left
    mark_cx, mark_cy = 90, 90
    draw_orbit_mark(img, mark_cx, mark_cy, scale=1.0)

    eyebrow_font = load_font(HELVETICA, 22, fallback_index=0)
    eyebrow_text = "SLIDES.ELIJAHFROST.COM"
    # 8px tracking ≈ 0.18em at 22px ~= ~4px between letters; PIL doesn't do
    # tracking natively. Use spaces between letters as a poor man's tracking.
    eyebrow_spaced = "  ".join(eyebrow_text)
    d.text((mark_cx + 38, mark_cy - 11), eyebrow_spaced, fill=MUTED, font=eyebrow_font)

    # Title — Georgia Light isn't on most macs; Georgia at lower weight via thin.
    title_font = load_font(GEORGIA, 116)
    # Wrap if too wide
    tw = text_width(d, title, title_font)
    max_w = W - 160
    if tw > max_w:
        size = int(116 * max_w / tw)
        title_font = load_font(GEORGIA, size)
    d.text((80, H / 2 - 90), title, fill=(255, 255, 255), font=title_font)

    if subtitle:
        sub_font = load_font(GEORGIA_ITALIC, 44)
        d.text((84, H / 2 + 70), subtitle, fill=FG, font=sub_font)

    # Bottom-right URL
    foot_font = load_font(HELVETICA, 20, fallback_index=0)
    foot = "slides.elijahfrost.com"
    fw = text_width(d, foot, foot_font)
    d.text((W - 80 - fw, H - 80), foot, fill=DIM, font=foot_font)

    # Hairline divider near the bottom
    d.line([(80, H - 50), (W - 80, H - 50)], fill=(30, 30, 30), width=1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip())
        sys.exit(1)
    out = Path(sys.argv[1])
    title = sys.argv[2]
    subtitle = sys.argv[3] if len(sys.argv) > 3 else None
    gen(out, title, subtitle)


if __name__ == "__main__":
    main()
