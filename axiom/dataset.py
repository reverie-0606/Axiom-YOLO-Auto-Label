from __future__ import annotations

import hashlib
import json
import random
import uuid
import zipfile
from pathlib import Path

from .imaging import fit_image, map_box, open_image
from .store import atomic_json


def yolo_line(b):
    return f"{b['class_id']} {(b['x1'] + b['x2']) / 2:.8f} {(b['y1'] + b['y2']) / 2:.8f} {b['x2'] - b['x1']:.8f} {b['y2'] - b['y1']:.8f}\n"


def export_dataset(store, project, update, stop, make_zip=True):
    # Pending/error images are never silently exported as negative examples.
    items = [i for i in store.all_images(project["id"]) if i["status"] in ("auto", "reviewed")]
    if not items:
        raise ValueError("Label or review at least one image before exporting.")
    s = project["settings"]
    # Sort before shuffling so the same seed produces the same split across exports.
    items.sort(key=lambda i: i["id"])
    random.Random(s["seed"]).shuffle(items)
    val_count = min(len(items) - 1, max(1, round(len(items) * s["val_split"]))) if len(items) > 1 else 0
    export_id = uuid.uuid4().hex
    dest = store.root / "exports" / export_id
    for split in ("train", "val"):
        (dest / "images" / split).mkdir(parents=True)
        (dest / "labels" / split).mkdir(parents=True)
    manifest = []
    for n, item in enumerate(items):
        if stop.is_set():
            return None
        split = "val" if n < val_count else "train"
        image = open_image(item["path"])
        fitted, transform = fit_image(image, s["resize"])
        boxes = [map_box(b, image.size, fitted.size, transform) for b in item["boxes"]]
        name = item["id"]
        fitted.save(dest / "images" / split / f"{name}.jpg", quality=95, subsampling=0)
        (dest / "labels" / split / f"{name}.txt").write_text("".join(yolo_line(b) for b in boxes if b), encoding="utf-8", newline="\n")
        manifest.append({"id": item["id"], "source_name": item["name"], "split": split,
                         "revision": item["revision"], "status": item["status"]})
        update(stage="exporting", completed=n + 1, total=len(items), message=f"Exporting {n + 1}/{len(items)} · {item['name']}")
    yaml = "# Axiom YOLO Auto Label\ntrain: images/train\nval: images/val\nnc: " + str(len(project["classes"])) + "\nnames:\n"
    yaml += "".join(f"  {i}: {json.dumps(name)}\n" for i, name in enumerate(project["classes"]))
    (dest / "data.yaml").write_text(yaml, encoding="utf-8", newline="\n")
    (dest / "classes.txt").write_text("\n".join(project["classes"]) + "\n", encoding="utf-8", newline="\n")
    atomic_json(dest / "manifest.json", {"project": project["name"], "settings": s, "images": manifest})
    if make_zip:
        update(message="Packaging YOLO dataset…")
        with zipfile.ZipFile(dest.with_suffix(".zip"), "w", zipfile.ZIP_STORED) as archive:
            for f in dest.rglob("*"):
                if f.is_file():
                    archive.write(f, f.relative_to(dest).as_posix())
    return {"id": export_id, "directory": str(dest), "images": len(items), "train": len(items) - val_count,
            "val": val_count, "url": f"/api/exports/{export_id}" if make_zip else None}
