from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path(__file__).resolve().parent
PNG_PATH = OUT_DIR / "app-icon.png"
ICO_PATH = OUT_DIR / "app.ico"


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main():
    scale = 4
    size = 256
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background tile.
    bg = (28, 36, 54, 255)
    bg2 = (40, 58, 86, 255)
    accent = (72, 139, 255, 255)
    accent_light = (89, 213, 255, 255)
    white = (246, 249, 255, 255)

    pad = 18 * scale
    rounded_rect(draw, (pad, pad, canvas_size - pad, canvas_size - pad), 48 * scale, bg)

    # Subtle diagonal highlight.
    draw.polygon(
        [
            (pad, pad),
            (canvas_size - pad, pad),
            (canvas_size - pad, 72 * scale),
            (68 * scale, canvas_size - pad),
            (pad, canvas_size - pad),
        ],
        fill=bg2,
    )

    # Main chat bubble.
    bubble = (
        46 * scale,
        58 * scale,
        210 * scale,
        176 * scale,
    )
    rounded_rect(draw, bubble, 34 * scale, accent)
    draw.polygon(
        [
            (96 * scale, 170 * scale),
            (76 * scale, 214 * scale),
            (136 * scale, 174 * scale),
        ],
        fill=accent,
    )

    # Inner shine bubble.
    rounded_rect(
        draw,
        (69 * scale, 80 * scale, 187 * scale, 116 * scale),
        18 * scale,
        accent_light,
    )

    # Letter mark.
    try:
        font = ImageFont.truetype("arialbd.ttf", 78 * scale)
    except OSError:
        font = ImageFont.load_default()

    text = "C"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (canvas_size - tw) / 2 - 2 * scale
    ty = 116 * scale - th / 2 - 4 * scale
    draw.text((tx, ty), text, font=font, fill=white)

    # Small status dot.
    draw.ellipse((180 * scale, 174 * scale, 210 * scale, 204 * scale), fill=(45, 226, 148, 255))
    draw.ellipse((189 * scale, 183 * scale, 201 * scale, 195 * scale), fill=(230, 255, 246, 255))

    img = img.resize((size, size), Image.Resampling.LANCZOS)
    img.save(PNG_PATH)

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ICO_PATH, sizes=sizes)
    print(f"Wrote {PNG_PATH}")
    print(f"Wrote {ICO_PATH}")


if __name__ == "__main__":
    main()
