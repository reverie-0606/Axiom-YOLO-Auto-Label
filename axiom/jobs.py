from __future__ import annotations

import collections
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

from .dataset import export_dataset
from .imaging import discover, probe_image
from .inference import Engine, prompts
from .store import atomic_json


class Jobs:
    def __init__(self, store):
        self.store = store
        self.engine = Engine()
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.current = {"id": None, "active": False, "kind": "idle", "stage": "idle", "message": "Ready when you are.",
                        "completed": 0, "total": 0, "errors": 0, "elapsed": 0, "rate": 0, "eta": None, "result": None, "history": []}
        self.logs = collections.deque(maxlen=120)
        self.started = 0
        self.last_persist = 0
        self.state_file = store.root / "last-job.json"
        if self.state_file.exists():
            try:
                old = json.loads(self.state_file.read_text(encoding="utf-8"))
                if old.get("active"):
                    old.update(active=False, stage="interrupted", message="Previous job was interrupted. Saved labels are intact; run again to resume.")
                self.current.update(old)
            except (OSError, ValueError):
                pass

    def update(self, **fields):
        with self.lock:
            self.current.update(fields)
            if self.current["active"]:
                self.current["elapsed"] = round(time.monotonic() - self.started, 1)
            if time.monotonic() - self.last_persist > 2:
                self.persist()

    def log(self, message):
        with self.lock:
            self.logs.append({"time": time.strftime("%H:%M:%S"), "message": str(message)[:2000]})

    def persist(self):
        atomic_json(self.state_file, self.current)
        self.last_persist = time.monotonic()

    def snapshot(self):
        with self.lock:
            state = dict(self.current)
            if state["active"]:
                state["elapsed"] = round(time.monotonic() - self.started, 1)
            state["logs"] = list(self.logs)
            state["model_info"] = dict(self.engine.info)
            return state

    def start(self, kind, pid, action):
        with self.lock:
            if self.current["active"]:
                raise ValueError("Another job is running. Stop it or wait for it to finish.")
            self.stop_event.clear()
            self.started = time.monotonic()
            self.logs.clear()
            self.current = {"id": uuid.uuid4().hex, "project_id": pid, "kind": kind, "active": True, "stage": "starting",
                            "message": f"Starting {kind}…", "completed": 0, "total": 0, "errors": 0,
                            "elapsed": 0, "rate": 0, "eta": None, "result": None, "history": []}
            self.persist()

            def run():
                try:
                    result = action()
                    if self.stop_event.is_set():
                        self.update(stage="cancelled", message="Stopped. Completed work has been saved.", result=result)
                    else:
                        self.update(stage="complete", message=f"{kind.capitalize()} complete.", result=result)
                except Exception as exc:
                    self.log(traceback.format_exc())
                    self.update(stage="error", message=str(exc)[:2000])
                finally:
                    self.update(active=False, elapsed=round(time.monotonic() - self.started, 1))
                    with self.lock:
                        self.persist()
            self.thread = threading.Thread(target=run, daemon=True, name=f"axiom-{kind}")
            self.thread.start()
            return self.snapshot()

    def cancel(self):
        self.stop_event.set()
        self.update(message="Stopping after the current operation. Downloads may finish their current request.")
        return self.snapshot()

    def import_paths(self, pid, paths):
        added = duplicate = errors = 0
        for n, (p, error) in enumerate(discover(paths, self.stop_event)):
            if self.stop_event.is_set():
                break
            try:
                if error:
                    raise ValueError(error)
                w, h = probe_image(p)
                if self.store.add_image(pid, p, p.name, w, h):
                    added += 1
                else:
                    duplicate += 1
            except Exception as exc:
                errors += 1
                self.log(f"{p.name}: {exc}")
            self.update(stage="importing", completed=n + 1, total=0, errors=errors,
                        message=f"Scanning images · {added} added · {duplicate} duplicates · {errors} skipped")
        return {"added": added, "duplicates": duplicate, "errors": errors}

    def annotate(self, project, selected=None):
        s = project["settings"]
        prompts(s)  # validate descriptions before downloading weights
        items = self.store.all_images(project["id"])
        if selected is not None:
            items = [i for i in items if i["id"] in selected]
        if s["skip_done"]:
            items = [i for i in items if i["status"] not in ("reviewed", "auto")]
        if not items:
            raise ValueError("No pending images. Turn off Skip labeled images to rerun automatic labels.")
        # Manual reviews are always protected, even when rerunning automatic labels.
        items = [i for i in items if i["status"] != "reviewed"]
        if not items:
            raise ValueError("All selected images have manual reviews. Reviewed images are protected from automatic replacement.")
        self.update(total=len(items))
        self.engine.load(s, self.update, self.stop_event)
        done = errors = 0
        start = time.monotonic()
        batch_size = s["batch_size"]
        while done < len(items) and not self.stop_event.is_set():
            batch = items[done:done + batch_size]
            self.update(stage="annotating", message=f"Labeling {done + 1}–{done + len(batch)} of {len(items)}…")
            try:
                results = self.engine.predict(batch, s, self.stop_event)
                if results is None or self.stop_event.is_set():
                    break
                for item, boxes in zip(batch, results):
                    try:
                        self.store.save_boxes(item["id"], boxes, item["revision"], status="auto", expected_settings=s)
                    except ValueError as exc:
                        self.log(f"{item['name']}: {exc} (existing edits preserved)")
                        errors += 1
            except Exception as exc:
                import torch
                if isinstance(exc, torch.cuda.OutOfMemoryError) and batch_size > 1:
                    batch_size = max(1, batch_size // 2)
                    torch.cuda.empty_cache()
                    self.log(f"VRAM limit reached. Retrying with batch size {batch_size}.")
                    continue
                # A corrupt image or malformed response must not discard a whole batch.
                if len(batch) > 1:
                    batch_size = 1
                    self.log(f"Retrying images individually: {exc}")
                    continue
                errors += 1
                self.store.set_error(batch[0]["id"], str(exc))
                self.log(f"{batch[0]['name']}: {exc}")
            done += len(batch)
            rate = done / max(0.001, time.monotonic() - start)
            self.update(completed=done, errors=errors, rate=round(rate, 3), eta=round((len(items) - done) / rate))
        return {"processed": done, "errors": errors, "saved": done - errors}

    def train(self, project):
        if not importlib.util.find_spec("ultralytics"):
            raise RuntimeError("Training requires Ultralytics. Run Setup.bat to install dependencies.")
        dataset = export_dataset(self.store, project, self.update, self.stop_event, make_zip=False)
        if not dataset or self.stop_event.is_set():
            return None
        if dataset["train"] < 1 or dataset["val"] < 1:
            raise ValueError("Training needs at least two labeled/reviewed images for separate training and validation sets.")
        self.engine.unload()
        run_id = uuid.uuid4().hex
        run_dir = self.store.root / "runs" / run_id
        run_dir.mkdir(parents=True)
        config = {"settings": project["settings"], "dataset": dataset["directory"], "run_dir": str(run_dir)}
        atomic_json(run_dir / "config.json", config)
        status_file = run_dir / "progress.json"
        self.update(stage="training", completed=0, total=project["settings"]["epochs"], message="Starting YOLO training…", history=[])
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with (run_dir / "training.log").open("w", encoding="utf-8") as output:
            proc = subprocess.Popen([sys.executable, "-m", "axiom.train_worker", str(run_dir / "config.json")],
                                    cwd=Path(__file__).resolve().parents[1], stdout=output, stderr=subprocess.STDOUT,
                                    creationflags=flags)
            last = None
            while proc.poll() is None:
                if self.stop_event.is_set():
                    (run_dir / "stop").touch()
                if status_file.exists():
                    try:
                        state = json.loads(status_file.read_text(encoding="utf-8"))
                        if state != last:
                            self.update(**state)
                            last = state
                    except (OSError, ValueError):
                        pass
                time.sleep(0.4)
            if status_file.exists():
                try:
                    self.update(**json.loads(status_file.read_text(encoding="utf-8")))
                except (ValueError, OSError):
                    pass
            if proc.returncode:
                tail = (run_dir / "training.log").read_text(encoding="utf-8", errors="replace")[-3500:]
                self.log(tail)
                raise RuntimeError("YOLO training failed. See the activity log for details.")
        best = run_dir / "train" / "weights" / "best.pt"
        return {"run_id": run_id, "directory": str(run_dir), "checkpoint": f"/api/runs/{run_id}/best" if best.exists() else None}
