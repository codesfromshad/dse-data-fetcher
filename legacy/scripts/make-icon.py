"""Generates assets/icon.ico (and icon.png) for the Windows exe.

    python3 scripts/make-icon.py        (needs Pillow: pip install pillow)

The .ico is written by hand rather than with Pillow's ICO writer, because
Pillow stores every size as PNG. Windows only officially expects PNG for the
256 px frame; the small sizes Explorer uses in list/Details views are
traditionally 32-bit BMP, which every Windows component reads. So:
16-128 px -> 32-bit BMP (with alpha), 256 px -> PNG.
"""
import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZES = [16, 24, 32, 48, 64, 128, 256]


def draw(size):
    # Draw at 4x then downsample for clean anti-aliasing at every size.
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    pad, radius = S * 0.04, S * 0.22

    # Deep blue rounded square with a subtle top-lit gradient
    bg = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(bg)
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)], fill=(int(30 + 12 * (1 - t)), int(64 + 30 * (1 - t)), int(175 + 40 * (1 - t)), 255))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius, fill=255)
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    small = size <= 24
    green, red, white = (52, 211, 120, 255), (248, 96, 96, 255), (255, 255, 255, 255)
    # (x centre, body top, body bottom, wick top, wick bottom, colour) as fractions of S
    candles = [
        (0.27, 0.58, 0.72, 0.52, 0.78, green),
        (0.42, 0.50, 0.62, 0.44, 0.68, red),
        (0.57, 0.38, 0.54, 0.32, 0.60, green),
        (0.72, 0.24, 0.42, 0.18, 0.48, green),
    ]
    if small:  # fewer, chunkier candles so they survive 16/24 px
        candles = [
            (0.30, 0.56, 0.76, 0.50, 0.80, green),
            (0.50, 0.42, 0.62, 0.36, 0.68, green),
            (0.70, 0.22, 0.46, 0.18, 0.52, green),
        ]
    body_w = S * (0.13 if small else 0.10)
    wick_w = max(S * (0.035 if small else 0.022), 1)
    for cx, bt, bb, wt, wb, col in candles:
        x = S * cx
        d.rectangle([x - wick_w / 2, S * wt, x + wick_w / 2, S * wb], fill=col)
        d.rounded_rectangle([x - body_w / 2, S * bt, x + body_w / 2, S * bb], S * 0.015, fill=col)
    d.rounded_rectangle([S * 0.16, S * 0.82, S * 0.84, S * 0.82 + S * (0.045 if small else 0.03)], S * 0.01, fill=white)

    return img.resize((size, size), Image.LANCZOS)


def bmp_frame(img):
    """32-bit BGRA DIB as stored inside .ico files (height doubled, bottom-up, plus AND mask)."""
    w, h = img.size
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = img.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))
    # 1-bit AND mask, rows padded to 4 bytes. Set bits = transparent (for
    # anything that ignores the alpha channel).
    row_bytes = ((w + 31) // 32) * 4
    and_mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(row_bytes)
        for x in range(w):
            if px[x, y][3] < 128:
                row[x // 8] |= 0x80 >> (x % 8)
        and_mask += row
    return header + bytes(xor) + bytes(and_mask)


def png_frame(img):
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def write_ico(frames, path):
    blobs = [png_frame(im) if im.width >= 256 else bmp_frame(im) for im in frames]
    out = bytearray(struct.pack('<HHH', 0, 1, len(frames)))
    offset = 6 + 16 * len(frames)
    for im, blob in zip(frames, blobs):
        w = 0 if im.width >= 256 else im.width  # 0 means 256 in the directory
        out += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    for blob in blobs:
        out += blob
    path.write_bytes(out)


if __name__ == '__main__':
    frames = [draw(s) for s in SIZES]
    (ROOT / 'assets').mkdir(exist_ok=True)
    write_ico(frames, ROOT / 'assets' / 'icon.ico')
    frames[-1].save(ROOT / 'assets' / 'icon.png')
    print(f"wrote assets/icon.ico ({(ROOT / 'assets' / 'icon.ico').stat().st_size // 1024} KB) and assets/icon.png")
