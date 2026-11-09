from __future__ import annotations

import hashlib
import io
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".avif", ".heic", ".heif", ".jfif", ".jpe", ".ppm", ".pgm", ".pbm", ".ico", ".tga"}
SIZES = {"1k": (1024, 1024), "720p": (1280, 720), "480p": (854, 480)}


def open_image(path):
    with Image.open(path) as im:
        im.seek(0)
        return ImageOps.exif_transpose(im).convert("RGB")


def probe_image(path):
    """Validate files and probe orientation without allocating a separate RGB copy."""
    with Image.open(path) as im:
        im.verify()
    # Some Pillow codecs consume/close the stream in verify(), and PNG's EXIF
    # accessor may load the image. Keep those operations on separate handles.
    with Image.open(path) as im:
        w, h = im.size
        if im.getexif().get(274) in (5, 6, 7, 8):
            w, h = h, w
        return w, h


def fit_image(image, mode):
    """Return input plus exact affine mapping from original to padded input."""
    if mode == "off":
        return image, (1.0, 1.0, 0, 0)
    tw, th = SIZES[mode]
    w, h = image.size
    scale = min(tw / w, th / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    px, py = (tw - nw) // 2, (th - nh) // 2
    canvas = Image.new("RGB", (tw, th), (24, 24, 24))
    canvas.paste(image.resize((nw, nh), Image.Resampling.LANCZOS), (px, py))
    return canvas, (nw / w, nh / h, px, py)


def map_box(box, original_size, input_size, mapping, inverse=False):
    ow, oh = original_size
    iw, ih = input_size
    sx, sy, px, py = mapping
    b = dict(box)
    if inverse:
        values = [(box["x1"] * iw - px) / sx / ow, (box["y1"] * ih - py) / sy / oh,
                  (box["x2"] * iw - px) / sx / ow, (box["y2"] * ih - py) / sy / oh]
    else:
        values = [(box["x1"] * ow * sx + px) / iw, (box["y1"] * oh * sy + py) / ih,
                  (box["x2"] * ow * sx + px) / iw, (box["y2"] * oh * sy + py) / ih]
    b.update(zip(("x1", "y1", "x2", "y2"), [max(0., min(1., v)) for v in values]))
    return b if b["x2"] > b["x1"] and b["y2"] > b["y1"] else None


def discover(paths, stop=None):
    seen = set()
    for raw in paths:
        p = Path(str(raw).strip().strip('"')).expanduser()
        if not p.exists():
            yield p, "Path does not exist."
            continue
        candidates = [p] if p.is_file() else (
            Path(root) / name for root, dirs, files in os.walk(p, followlinks=False)
            for name in files if Path(name).suffix.lower() in EXTENSIONS)
        for f in candidates:
            if stop and stop.is_set():
                return
            if f.suffix.lower() not in EXTENSIONS:
                yield f, "Unsupported image format."
                continue
            canonical = str(f.resolve())
            if canonical not in seen:
                seen.add(canonical)
                yield f.resolve(), None


def thumbnail(item, root):
    p = Path(item["path"])
    stat = p.stat()
    key = hashlib.sha256(f"{p}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()
    dest = root / "thumbnails" / f"{key}.jpg"
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        image = open_image(p)
        image.thumbnail((320, 200), Image.Resampling.BILINEAR)
        buf = io.BytesIO()
        image.save(buf, "JPEG", quality=78)
        temp = dest.with_suffix(f".{os.getpid()}.{__import__('threading').get_ident()}.tmp")
        temp.write_bytes(buf.getvalue())
        os.replace(temp, dest)
    return dest
