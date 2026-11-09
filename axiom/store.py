from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MIN_VISION_PIXELS = 1003520

DEFAULTS = {
    "model": "2B", "quantization": "native", "resize": "off",
    "game": "", "describe": True, "target": "player characters",
    "teams": False, "teammate": "Friendly player characters with blue team indicators",
    "enemy": "Enemy player characters with red team indicators", "heads": False,
    "batch_size": 1, "max_tokens": 1024, "max_pixels": 2073600,
    "skip_done": True, "val_split": 0.2, "seed": 42,
    "train_model": "yolo11n.pt", "epochs": 50, "train_imgsz": 640, "train_batch": 8,
}


def classes(settings):
    body = ["teammate", "enemy"] if settings["teams"] else ["target"]
    return body + ([f"{name}_head" for name in body] if settings["heads"] else [])


def validate_settings(raw):
    s = {**DEFAULTS, **{k: v for k, v in raw.items() if k in DEFAULTS}}
    for key, choices in {"model": ("2B", "4B"), "quantization": ("native", "fp8", "q4"),
                         "resize": ("off", "1k", "720p", "480p")}.items():
        if s[key] not in choices:
            raise ValueError(f"Invalid {key}.")
    for k in ("teams", "heads", "describe", "skip_done"):
        if type(s[k]) is not bool:
            raise ValueError(f"{k} must be a boolean.")
    for k, lo, hi in [("batch_size", 1, 8), ("max_tokens", 128, 4096),
                      ("max_pixels", MIN_VISION_PIXELS, 8388608), ("epochs", 1, 1000),
                      ("train_imgsz", 128, 2048), ("train_batch", 1, 64), ("seed", 0, 2147483647)]:
        if isinstance(s[k], bool) or int(s[k]) != float(s[k]) or not lo <= int(s[k]) <= hi:
            raise ValueError(f"{k} must be an integer between {lo} and {hi}.")
        s[k] = int(s[k])
    s["val_split"] = float(s["val_split"])
    if not math.isfinite(s["val_split"]) or not 0.05 <= s["val_split"] <= 0.5:
        raise ValueError("Validation split must be between 5% and 50%.")
    for k in ("game", "target", "teammate", "enemy"):
        s[k] = str(s[k]).strip()[:2000]
    if s["train_model"] not in ("yolo11n.pt", "yolo11s.pt", "yolo11m.pt", "yolov8n.pt", "yolov8s.pt"):
        raise ValueError("Invalid YOLO training model.")
    return s


def validate_boxes(boxes, names):
    if not isinstance(boxes, list) or len(boxes) > 2000:
        raise ValueError("Expected a list of at most 2,000 boxes.")
    result = []
    for b in boxes:
        c = b.get("class_id")
        if type(c) is not int or not 0 <= c < len(names):
            raise ValueError("Invalid annotation class.")
        xy = [float(b[k]) for k in ("x1", "y1", "x2", "y2")]
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in xy):
            raise ValueError("Box coordinates must be finite normalized values in [0, 1].")
        if xy[2] <= xy[0] or xy[3] <= xy[1]:
            raise ValueError("A box must have a positive width and height.")
        result.append(dict(zip(("class_id", "x1", "y1", "x2", "y2"), [c, *xy])))
    return result


class Store:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.db = root / "axiom.sqlite3"
        new_database = not self.db.exists()
        self.lock = threading.RLock()
        with self.connect() as con:
            con.executescript("""
            CREATE TABLE IF NOT EXISTS projects(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS images(
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
                path TEXT NOT NULL, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
                boxes TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
                revision INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
                created REAL NOT NULL, updated REAL NOT NULL,
                UNIQUE(project_id,path));
            CREATE INDEX IF NOT EXISTS idx_project_images ON images(project_id,created,id);
            CREATE INDEX IF NOT EXISTS idx_project_status ON images(project_id,status);
            CREATE TABLE IF NOT EXISTS videos(
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
                path TEXT NOT NULL, name TEXT NOT NULL, duration REAL NOT NULL,
                width INTEGER NOT NULL, height INTEGER NOT NULL, fingerprint TEXT NOT NULL,
                UNIQUE(project_id,path));
            """)
            # Upgrade older presets so their settings still match the picker
            # and can be saved after the minimum vision budget was raised.
            con.execute("""UPDATE projects SET settings=json_set(settings,'$.max_pixels',?)
                WHERE json_type(settings,'$.max_pixels') IN ('integer','real')
                AND json_extract(settings,'$.max_pixels')<?""", (MIN_VISION_PIXELS, MIN_VISION_PIXELS))
        if new_database and not self.projects():
            self.create_project("Untitled dataset")

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.db, timeout=30)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA foreign_keys=ON")
        try:
            with con:
                yield con
        finally:
            con.close()

    def projects(self):
        with self.connect() as con:
            rows = con.execute("""SELECT p.id,p.name,p.created,COUNT(i.id) AS total,
                COALESCE(SUM(i.status='reviewed'),0) AS reviewed,
                COALESCE(SUM(i.status='auto'),0) AS auto
                FROM projects p LEFT JOIN images i ON i.project_id=p.id
                GROUP BY p.id ORDER BY p.created,p.id""").fetchall()
            return [{"id": r["id"], "name": r["name"], "created": r["created"],
                     "stats": {"total": r["total"], "reviewed": r["reviewed"], "auto": r["auto"]}} for r in rows]

    @staticmethod
    def project_name(name):
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Project name is required.")
        if len(name.strip()) > 100:
            raise ValueError("Project name must be at most 100 characters.")
        return name.strip()

    def create_project(self, name):
        name = self.project_name(name)
        pid = uuid.uuid4().hex
        with self.connect() as con:
            con.execute("INSERT INTO projects VALUES(?,?,?,?)", (pid, name, json.dumps(DEFAULTS), time.time()))
        return self.project(pid)

    def rename_project(self, pid, name):
        name = self.project_name(name)
        with self.lock, self.connect() as con:
            if not con.execute("UPDATE projects SET name=? WHERE id=?", (name, pid)).rowcount:
                raise KeyError("Project not found.")
        return self.project(pid)

    def delete_project(self, pid):
        with self.lock, self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            if not con.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
                raise KeyError("Project not found.")
            removed = con.execute("DELETE FROM images WHERE project_id=?", (pid,)).rowcount
            con.execute("DELETE FROM videos WHERE project_id=?", (pid,))
            con.execute("DELETE FROM projects WHERE id=?", (pid,))
        return {"removed": pid, "images": removed}

    def save_video(self, pid, video):
        with self.lock, self.connect() as con:
            previous = con.execute("SELECT id FROM videos WHERE project_id=? AND path=?", (pid, video['path'])).fetchone()
            vid = previous['id'] if previous else uuid.uuid4().hex
            con.execute("""INSERT INTO videos VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(project_id,path) DO UPDATE SET name=excluded.name,duration=excluded.duration,
                width=excluded.width,height=excluded.height,fingerprint=excluded.fingerprint""",
                (vid, pid, video['path'], video['name'], video['duration'], video['width'], video['height'], video['fingerprint']))
        return self.video(vid)

    def video(self, vid):
        with self.connect() as con:
            row = con.execute("SELECT * FROM videos WHERE id=?", (vid,)).fetchone()
            if not row:
                raise KeyError('Video not found.')
            return dict(row)

    def project(self, pid):
        with self.connect() as con:
            row = con.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
            if not row:
                raise KeyError("Project not found.")
            p = dict(row)
            p["settings"] = {**DEFAULTS, **json.loads(p["settings"])}
            p["classes"] = classes(p["settings"])
            p["stats"] = self._stats(con, pid)
            return p

    def _stats(self, con, pid):
        counts = {r[0]: r[1] for r in con.execute(
            "SELECT status,COUNT(*) FROM images WHERE project_id=? GROUP BY status", (pid,))}
        return {"total": sum(counts.values()), **{k: counts.get(k, 0) for k in ("pending", "auto", "reviewed", "error")},
                "boxes": con.execute("SELECT COALESCE(SUM(json_array_length(boxes)),0) FROM images WHERE project_id=?", (pid,)).fetchone()[0]}

    def save_settings(self, pid, settings):
        s = validate_settings(settings)
        with self.lock, self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT settings FROM projects WHERE id=?", (pid,)).fetchone()
            if not row:
                raise KeyError("Project not found.")
            previous = {**DEFAULTS, **json.loads(row[0])}
            if classes(previous) != classes(s):
                count = con.execute("SELECT COUNT(*) FROM images WHERE project_id=? AND (status IN ('auto','reviewed') OR boxes!='[]')", (pid,)).fetchone()[0]
                if count:
                    raise ValueError("Class layout is locked after labeling. Create a new dataset to change team or head classes.")
            con.execute("UPDATE projects SET settings=? WHERE id=?", (json.dumps(s), pid))
        return self.project(pid)

    def add_image(self, pid, path, name, width, height):
        now = time.time()
        with self.connect() as con:
            cur = con.execute("INSERT OR IGNORE INTO images(id,project_id,path,name,width,height,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                              (uuid.uuid4().hex, pid, str(path), name, width, height, now, now))
            return cur.rowcount > 0

    @staticmethod
    def decode(row):
        item = dict(row)
        item["boxes"] = json.loads(item["boxes"])
        return item

    def image(self, iid):
        with self.connect() as con:
            r = con.execute("SELECT * FROM images WHERE id=?", (iid,)).fetchone()
            if not r:
                raise KeyError("Image not found.")
            return self.decode(r)

    def images(self, pid, page=0, limit=48, status="all", search=""):
        query = "project_id=?"
        args = [pid]
        if status != "all":
            query += " AND status=?"
            args.append(status)
        if search:
            query += " AND name LIKE ? ESCAPE '\\'"
            args.append("%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        with self.connect() as con:
            total = con.execute(f"SELECT COUNT(*) FROM images WHERE {query}", args).fetchone()[0]
            rows = con.execute(f"SELECT * FROM images WHERE {query} ORDER BY created,id LIMIT ? OFFSET ?", [*args, limit, page * limit]).fetchall()
            return {"total": total, "items": [self.decode(r) for r in rows]}

    def all_images(self, pid):
        with self.connect() as con:
            return [self.decode(r) for r in con.execute("SELECT * FROM images WHERE project_id=? ORDER BY created,id", (pid,))]

    def image_selection(self, pid, status="all", search=""):
        query, args = "project_id=?", [pid]
        if status != "all":
            query += " AND status=?"
            args.append(status)
        if search:
            query += " AND name LIKE ? ESCAPE '\\'"
            args.append("%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        with self.connect() as con:
            return [dict(row) for row in con.execute(
                f"SELECT id,revision FROM images WHERE {query} ORDER BY created,id", args)]

    def remove_images(self, pid, images):
        """Validate the full selection before one atomic delete. Files stay intact."""
        expected = {item["id"]: item["revision"] for item in images}
        ids = list(expected)
        chunks = [ids[i:i + 500] for i in range(0, len(ids), 500)]
        with self.lock, self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            for chunk in chunks:
                placeholders = ",".join("?" for _ in chunk)
                rows = con.execute(f"SELECT id,revision FROM images WHERE project_id=? AND id IN ({placeholders})", [pid, *chunk]).fetchall()
                if len(rows) != len(chunk) or any(row["revision"] != expected[row["id"]] for row in rows):
                    raise ValueError("Some selected images changed or were removed. Select them again before removing.")
            for chunk in chunks:
                placeholders = ",".join("?" for _ in chunk)
                con.execute(f"DELETE FROM images WHERE project_id=? AND id IN ({placeholders})", [pid, *chunk])
        return {"removed": len(ids), "project_id": pid}

    def remove_image(self, iid, revision):
        """Remove membership and labels without touching source or upload files."""
        with self.lock, self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT project_id,revision FROM images WHERE id=?", (iid,)).fetchone()
            if not row:
                raise KeyError("Image not found.")
            if row["revision"] != revision:
                raise ValueError("This image changed in another editor. Reload it before removing it.")
            con.execute("DELETE FROM images WHERE id=?", (iid,))
            return {"removed": iid, "project_id": row["project_id"]}

    def save_boxes(self, iid, boxes, revision, status="reviewed", error="", expected_settings=None):
        with self.lock, self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            r = con.execute("SELECT i.project_id,p.settings FROM images i JOIN projects p ON p.id=i.project_id WHERE i.id=?", (iid,)).fetchone()
            if not r:
                raise KeyError("Image not found.")
            s = {**DEFAULTS, **json.loads(r["settings"])}
            if expected_settings is not None and classes(s) != classes(expected_settings):
                raise ValueError("Class settings changed while annotating. Result was not saved.")
            valid = validate_boxes(boxes, classes(s))
            cur = con.execute("UPDATE images SET boxes=?,status=?,revision=revision+1,error=?,updated=? WHERE id=? AND revision=?",
                              (json.dumps(valid), status, error, time.time(), iid, revision))
            if not cur.rowcount:
                raise ValueError("This image changed in another editor. Reload it before saving.")
        return self.image(iid)

    def set_error(self, iid, message):
        with self.connect() as con:
            con.execute("UPDATE images SET error=?,status=CASE WHEN status='pending' THEN 'error' ELSE status END WHERE id=?", (message[:2000], iid))


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    os.replace(temp, path)
