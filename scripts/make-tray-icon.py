#!/usr/bin/env python3
"""
Draw the osmRouter menu-bar tray icon — three elliptical orbits + a center
dot, pure black on transparent, sized for macOS Template Image rules.

Why a custom-drawn icon instead of downscaling the 500×500 brand PNG:
the brand mark has anti-aliased detail (electron dot, multiple line
weights, varied opacity) that turns into a featureless blob below ~64 px.
The menu bar wants the silhouette of an atom, not its photograph.

macOS template image rules:
  - PNG with alpha channel
  - Pure black foreground (R=G=B=0). macOS auto-tints based on theme.
  - "Template" suffix in filename triggers template mode in Electron.
  - Provide @1x (16-22 px) AND @2x (32-44 px). Electron looks for both.

Output goes to apps/desktop/resources/.
"""
from PIL import Image, ImageDraw
import math
import pathlib

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "To Compile V2" / "osmRouter-app" / "apps" / "desktop" / "resources"

def draw_atom(size: int, stroke: float) -> Image.Image:
    """
    Draws a single atom symbol on a transparent square canvas of `size×size`.
    The atom is three rotated ellipses with a filled center dot.

    Stroke width and ellipse aspect tuned per-size so the symbol stays
    crisp at 16/22/32/44 — anti-aliased stroke rendering at 4× then
    downsample preserves shape without smearing it.
    """
    # Render at 4× resolution then downsample with LANCZOS for clean AA.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = s / 2, s / 2
    # Ellipses fit just inside the canvas. Outer semi-major = 46% of size.
    a = s * 0.46
    b = s * 0.20  # semi-minor — controls how "flat" the orbit looks
    line = max(2, stroke * scale)

    # Three orbits at 0°, 60°, 120°. Render each by drawing an ellipse on
    # a rotated overlay then pasting onto the main canvas.
    for angle_deg in (0, 60, 120):
        layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse(
            (cx - a, cy - b, cx + a, cy + b),
            outline=(0, 0, 0, 255),
            width=int(line),
        )
        layer = layer.rotate(angle_deg, resample=Image.BICUBIC, expand=False)
        img.alpha_composite(layer)

    # Centre dot — proves it's an atom, not just a flower
    r = s * 0.08
    draw.ellipse(
        (cx - r, cy - r, cx + r, cy + r),
        fill=(0, 0, 0, 255),
    )

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # @1x — 22 px — what macOS shows on a non-Retina display (rare, but valid)
    img1x = draw_atom(22, stroke=1.6)
    p1x = OUT_DIR / "tray-icon-Template.png"
    img1x.save(p1x, "PNG")
    print(f"wrote {p1x} ({img1x.size[0]}×{img1x.size[1]})")

    # @2x — 44 px — what every Retina Mac actually shows
    img2x = draw_atom(44, stroke=2.6)
    p2x = OUT_DIR / "tray-icon-Template@2x.png"
    img2x.save(p2x, "PNG")
    print(f"wrote {p2x} ({img2x.size[0]}×{img2x.size[1]})")


if __name__ == "__main__":
    main()
