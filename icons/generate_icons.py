"""
Generates the PWA app icons (icon-192.png, icon-512.png, icon-180.png)
from icons/source-svgs/city.svg.

Layout: white square with a black border, the city glyph centered in the
middle band, "KAMPALA" set above it and "HOUSING" set below it.

Usage:
    pip install Pillow cairosvg --break-system-packages
    python3 icons/generate_icons.py
"""
import os
import io
import cairosvg
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_SVG = os.path.join(OUT_DIR, "source-svgs", "city.svg")

FONT_BOLD = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_SEMIBOLD = "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf"

MASTER_SIZE = 1024


def draw_tracked_text(draw, xy, text, font, fill, tracking=0):
    """Draws text with letter-spacing (PIL has no native tracking), centered
    horizontally at xy=(cx, y)."""
    cx, y = xy
    widths = [draw.textlength(ch, font=font) for ch in text]
    total_w = sum(widths) + tracking * (len(text) - 1)
    x = cx - total_w / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


def build_master():
    size = MASTER_SIZE
    img = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(img)

    # Black border / edge, rounded to match the app's button radius language
    border_w = round(size * 0.032)
    corner_r = round(size * 0.16)
    inset = border_w / 2
    draw.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=corner_r,
        outline="black",
        width=border_w,
    )

    # --- Wordmark: KAMPALA (top) / HOUSING (bottom) ---
    top_font = ImageFont.truetype(FONT_BOLD, round(size * 0.098))
    bottom_font = ImageFont.truetype(FONT_SEMIBOLD, round(size * 0.072))

    top_y = round(size * 0.095)
    draw_tracked_text(draw, (size / 2, top_y), "KAMPALA", top_font, "black", tracking=size * 0.010)

    bottom_h = draw.textbbox((0, 0), "HOUSING", font=bottom_font)[3]
    bottom_y = size - round(size * 0.095) - bottom_h
    draw_tracked_text(draw, (size / 2, bottom_y), "HOUSING", bottom_font, "black", tracking=size * 0.028)

    # --- Centered city glyph in the middle band ---
    icon_target = round(size * 0.44)
    raw = cairosvg.svg2png(url=SOURCE_SVG, output_width=icon_target * 2, output_height=icon_target * 2)
    glyph = Image.open(io.BytesIO(raw)).convert("RGBA")
    bbox = glyph.getbbox()
    glyph = glyph.crop(bbox)
    scale = icon_target / max(glyph.size)
    glyph = glyph.resize((round(glyph.size[0] * scale), round(glyph.size[1] * scale)), Image.LANCZOS)

    band_top = top_y + round(size * 0.115)
    band_bottom = bottom_y - round(size * 0.04)
    band_center_y = (band_top + band_bottom) / 2

    gx = round(size / 2 - glyph.size[0] / 2)
    gy = round(band_center_y - glyph.size[1] / 2)
    img.paste(glyph, (gx, gy), glyph)

    return img


def make_icon(master, size, path):
    resized = master.resize((size, size), Image.LANCZOS)
    resized.save(path)


if __name__ == "__main__":
    master = build_master()
    master.save(os.path.join(OUT_DIR, "icon-master-1024.png"))
    make_icon(master, 512, os.path.join(OUT_DIR, "icon-512.png"))
    make_icon(master, 192, os.path.join(OUT_DIR, "icon-192.png"))
    make_icon(master, 180, os.path.join(OUT_DIR, "icon-180.png"))
    print("Icons written to", OUT_DIR)
