#!/usr/bin/env python3
"""Render one 1200x630 social preview from an existing site image."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps, ImageStat


WIDTH = 1200
HEIGHT = 630
FONT_PATH = Path("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf")
FALLBACK_BACKGROUND = (255, 255, 255)


def load_rgb(source: Path) -> Image.Image:
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, "white")
            background.alpha_composite(rgba)
            return background.convert("RGB")
        return image.convert("RGB")


def frame_median_color(image: Image.Image, fraction: float = 0.12) -> tuple[int, int, int]:
    """Return the median RGB colour of the outer frame, with a safe white fallback."""
    sample = image.copy()
    sample.thumbnail((320, 320), Image.Resampling.LANCZOS)
    width, height = sample.size
    if width < 2 or height < 2:
        return FALLBACK_BACKGROUND

    border = max(1, round(min(width, height) * fraction))
    histograms = [[0] * 256 for _ in range(3)]
    pixel_count = 0
    pixels = sample.load()
    for y in range(height):
        for x in range(width):
            if x >= border and x < width - border and y >= border and y < height - border:
                continue
            red, green, blue = pixels[x, y]
            histograms[0][red] += 1
            histograms[1][green] += 1
            histograms[2][blue] += 1
            pixel_count += 1

    if pixel_count == 0:
        return FALLBACK_BACKGROUND

    midpoint = (pixel_count + 1) // 2
    medians = []
    for histogram in histograms:
        seen = 0
        median = 255
        for value, count in enumerate(histogram):
            seen += count
            if seen >= midpoint:
                median = value
                break
        medians.append(median)

    background = tuple(medians)
    luminance = 0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]
    return background if luminance >= 170 else FALLBACK_BACKGROUND


def render_product(image: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), frame_median_color(image))
    fitted = ImageOps.contain(image, (1120, 590), Image.Resampling.LANCZOS)
    x = (WIDTH - fitted.width) // 2
    y = (HEIGHT - fitted.height) // 2
    canvas.paste(fitted, (x, y))
    return canvas


def render_branded(image: Image.Image) -> Image.Image:
    canvas = ImageOps.fit(
        image,
        (WIDTH, HEIGHT),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.48),
    )
    canvas = ImageEnhance.Color(canvas).enhance(0.94)
    canvas = ImageEnhance.Contrast(canvas).enhance(1.02)
    # Keep already-dark source photos readable: lift only those, then apply
    # a genuinely light brand overlay instead of stacking darkness.
    sample = canvas.copy()
    sample.thumbnail((240, 126), Image.Resampling.BILINEAR)
    red, green, blue = ImageStat.Stat(sample).mean[:3]
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    if luminance < 85:
        canvas = ImageEnhance.Brightness(canvas).enhance(min(1.5, 85 / max(luminance, 1)))
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 52))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)

    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(FONT_PATH), 82)
    word = "EGOE"
    text_box = draw.textbbox((0, 0), word, font=font, stroke_width=1)
    text_width = text_box[2] - text_box[0]
    mark = 78
    gap = 25
    group_width = mark + gap + text_width
    group_x = (WIDTH - group_width) // 2
    group_y = (HEIGHT - mark) // 2

    draw.rectangle((group_x, group_y, group_x + mark, group_y + mark), fill=(243, 111, 33, 255))
    inset_x = 18
    inset_y = 16
    draw.rectangle(
        (
            group_x + inset_x,
            group_y + inset_y,
            group_x + mark - inset_x,
            group_y + mark - inset_y,
        ),
        outline=(255, 255, 255, 245),
        width=4,
    )
    text_x = group_x + mark + gap
    text_y = (HEIGHT - (text_box[3] - text_box[1])) // 2 - text_box[1] - 2
    draw.text(
        (text_x, text_y),
        word,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=1,
        stroke_fill=(0, 0, 0, 70),
    )
    return canvas.convert("RGB")


def save_jpeg(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "JPEG", quality=84, optimize=True, progressive=True, subsampling=1)
    if destination.stat().st_size > 260_000:
        image.save(destination, "JPEG", quality=76, optimize=True, progressive=True, subsampling=2)


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[3] not in {"product", "branded"}:
        raise SystemExit("usage: render-social-preview.py SOURCE DESTINATION product|branded")
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    kind = sys.argv[3]
    if not source.is_file():
        raise SystemExit(f"source not found: {source}")
    if not FONT_PATH.is_file() and kind == "branded":
        raise SystemExit(f"font not found: {FONT_PATH}")

    image = load_rgb(source)
    rendered = render_product(image) if kind == "product" else render_branded(image)
    save_jpeg(rendered, destination)


if __name__ == "__main__":
    main()
