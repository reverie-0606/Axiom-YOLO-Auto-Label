from __future__ import annotations

import io
import os
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .dataset import export_dataset
from .imaging import EXTENSIONS, open_image, probe_image, thumbnail
from .jobs import Jobs
from .store import Store
from .video import VIDEO_EXTENSIONS, extraction_plan, extract_video, probe_video

ROOT = Path(__file__).resolve().parents[1]


def create_app(data_dir=None):
    store = Store(Path(data_dir or os.environ.get("AXIOM_DATA_DIR", ROOT / "data")))
    jobs = Jobs(store)
    app = FastAPI(title="Axiom YOLO Auto Label", docs_url=None, redoc_url=None)
    app.state.store, app.state.jobs = store, jobs
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def protect_local_api(request, call_next):
        origin = request.headers.get("origin")
        if origin and urlparse(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Cross-origin access is disabled."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409 if "changed" in str(exc) else 400)

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"detail": str(exc).strip("'")}, status_code=404)

    @app.exception_handler(OSError)
    async def io_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    def idle():
        if jobs.snapshot()["active"]:
            raise ValueError("A job is running. Wait for it to finish before changing this dataset.")

    @app.get("/api/health")
    def health():
        return {"app": "Axiom YOLO Auto Label", "version": "1.0.0"}

    @app.get("/api/projects")
    def projects():
        return store.projects()

    @app.post("/api/projects")
    def create(body: dict):
        return store.create_project(body.get("name", "Untitled dataset"))

    @app.get("/api/projects/{pid}")
    def project(pid: str):
        return store.project(pid)

    @app.patch("/api/projects/{pid}")
    def rename_project(pid: str, body: dict):
        return store.rename_project(pid, body.get("name"))

    @app.delete("/api/projects/{pid}")
    def delete_project(pid: str):
        with jobs.lock:
            job = jobs.snapshot()
            if job["active"] and job.get("project_id") == pid:
                raise ValueError("This project has an active job. Stop it before deleting the project.")
            return store.delete_project(pid)

    @app.put("/api/projects/{pid}/settings")
    def settings(pid: str, body: dict):
        with jobs.lock:
            idle()
            return store.save_settings(pid, body)

    @app.get("/api/projects/{pid}/images")
    def images(pid: str, page: int = Query(0, ge=0), limit: int = Query(48, ge=1, le=200),
               status: str = "all", search: str = ""):
        store.project(pid)
        return store.images(pid, page, limit, status, search)

    @app.post("/api/projects/{pid}/import")
    def import_paths(pid: str, body: dict):
        store.project(pid)
        paths = body.get("paths", [])
        if not isinstance(paths, list) or not paths or len(paths) > 10000 or any(not isinstance(p, str) for p in paths):
            raise ValueError("Provide one or more image or folder paths.")
        return jobs.start("import", pid, lambda: jobs.import_paths(pid, paths))

    @app.get("/api/projects/{pid}/selection")
    def image_selection(pid: str, status: str = "all", search: str = ""):
        store.project(pid)
        return {"items": store.image_selection(pid, status, search)}

    @app.post("/api/projects/{pid}/images/remove")
    def remove_images(pid: str, body: dict):
        images = body.get("images")
        if not isinstance(images, list) or not 1 <= len(images) <= 100000:
            raise ValueError("Select between 1 and 100,000 images to remove.")
        ids = set()
        for item in images:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"] or type(item.get("revision")) is not int or item["revision"] < 0:
                raise ValueError("Invalid image selection.")
            if item["id"] in ids:
                raise ValueError("Invalid image selection.")
            ids.add(item["id"])
        with jobs.lock:
            idle()
            store.project(pid)
            return store.remove_images(pid, images)

    @app.post("/api/projects/{pid}/upload")
    def upload(pid: str, files: list[UploadFile] = File(...)):
        store.project(pid)
        if len(files) > 100:
            raise ValueError("Upload at most 100 files per request.")
        added = errors = duplicates = 0
        messages = []
        # Reserve the job lock while ingesting uploads to prevent annotation/import races.
        with jobs.lock:
            idle()
            dest_dir = store.root / "imports" / pid
            dest_dir.mkdir(parents=True, exist_ok=True)
            for file in files:
                name = Path((file.filename or "image").replace("\\", "/")).name
                suffix = Path(name).suffix.lower()
                if suffix not in EXTENSIONS:
                    errors += 1
                    continue
                temp = dest_dir / f".{uuid.uuid4().hex}.tmp"
                try:
                    import hashlib
                    digest = hashlib.sha256()
                    size = 0
                    with temp.open("wb") as out:
                        while chunk := file.file.read(1024 * 1024):
                            size += len(chunk)
                            if size > 512 * 1024 * 1024:
                                raise ValueError("Image exceeds 512 MB.")
                            digest.update(chunk)
                            out.write(chunk)
                    w, h = probe_image(temp)
                    dest = dest_dir / f"{digest.hexdigest()}{suffix}"
                    if dest.exists():
                        temp.unlink()
                    else:
                        os.replace(temp, dest)
                    if store.add_image(pid, dest, name, w, h):
                        added += 1
                    else:
                        duplicates += 1
                except Exception as exc:
                    errors += 1
                    messages.append(f"{name}: {exc}")
                    temp.unlink(missing_ok=True)
                finally:
                    file.file.close()
        return {"added": added, "errors": errors, "duplicates": duplicates, "messages": messages}

    @app.get("/api/images/{iid}")
    def image(iid: str):
        return store.image(iid)

    @app.post('/api/projects/{pid}/videos/probe')
    def video_from_path(pid: str, body: dict):
        with jobs.lock:
            idle(); store.project(pid)
            path = body.get('path')
            if not isinstance(path, str) or not path.strip():
                raise ValueError('Provide a video file path.')
            return store.save_video(pid, probe_video(path))

    @app.post('/api/projects/{pid}/videos/upload')
    def upload_video(pid: str, file: UploadFile = File(...)):
        with jobs.lock:
            idle(); store.project(pid)
            name = Path((file.filename or 'video').replace('\\', '/')).name
            suffix = Path(name).suffix.lower()
            if suffix not in VIDEO_EXTENSIONS:
                raise ValueError('Unsupported video format.')
            folder = store.root / 'videos' / pid
            folder.mkdir(parents=True, exist_ok=True)
            temp = folder / f'.{uuid.uuid4().hex}.tmp'
            try:
                import hashlib
                digest = hashlib.sha256(); size = 0
                with temp.open('wb') as out:
                    while chunk := file.file.read(1024 * 1024):
                        size += len(chunk)
                        if size > 32 * 1024 ** 3:
                            raise ValueError('Video exceeds the 32 GB upload limit. Use a local file path instead.')
                        digest.update(chunk); out.write(chunk)
                dest = folder / f'{digest.hexdigest()}{suffix}'
                if dest.exists(): temp.unlink()
                else: os.replace(temp, dest)
                info = probe_video(dest); info['name'] = name
                return store.save_video(pid, info)
            finally:
                temp.unlink(missing_ok=True); file.file.close()

    @app.get('/api/videos/{vid}/preview')
    def video_preview(vid: str):
        video = store.video(vid)
        return FileResponse(video['path'])

    @app.post('/api/projects/{pid}/videos/extract')
    def extract_frames(pid: str, body: dict):
        with jobs.lock:
            idle(); store.project(pid)
            vid = body.get('video_id')
            if not isinstance(vid, str):
                raise ValueError('Choose a video before extracting frames.')
            video = store.video(vid)
            if video['project_id'] != pid:
                raise KeyError('Video not found.')
            plan = extraction_plan(video, body.get('start'), body.get('end'), body.get('interval'))
            return jobs.start('video import', pid, lambda: extract_video(store, video, plan, jobs.update, jobs.stop_event))

    @app.delete("/api/images/{iid}")
    def remove_image(iid: str, body: dict):
        revision = body.get("revision")
        if type(revision) is not int or revision < 0:
            raise ValueError("Image revision is required.")
        with jobs.lock:
            idle()
            return store.remove_image(iid, revision)

    @app.get("/api/images/{iid}/thumbnail")
    def thumb(iid: str):
        return FileResponse(thumbnail(store.image(iid), store.root), media_type="image/jpeg")

    @app.get("/api/images/{iid}/preview")
    def preview(iid: str):
        image = open_image(store.image(iid)["path"])
        image.thumbnail((2560, 2560))
        buf = io.BytesIO()
        image.save(buf, "JPEG", quality=92)
        return Response(buf.getvalue(), media_type="image/jpeg")

    @app.put("/api/images/{iid}/annotations")
    def annotations(iid: str, body: dict):
        revision = body.get("revision")
        if type(revision) is not int:
            raise ValueError("Image revision is required.")
        return store.save_boxes(iid, body.get("boxes"), revision)

    @app.post("/api/projects/{pid}/annotate")
    def annotate(pid: str, body: dict):
        p = store.project(pid)
        selected = body.get("image_ids")
        if selected is not None and (not isinstance(selected, list) or not selected or any(not isinstance(v, str) for v in selected)):
            raise ValueError("Invalid image selection.")
        return jobs.start("annotation", pid, lambda: jobs.annotate(p, selected))

    @app.post("/api/projects/{pid}/model")
    def model(pid: str):
        p = store.project(pid)
        return jobs.start("model loading", pid, lambda: jobs.engine.load(p["settings"], jobs.update, jobs.stop_event))

    @app.post("/api/model/unload")
    def unload():
        return jobs.start("model unload", None, jobs.engine.unload)

    @app.post("/api/projects/{pid}/export")
    def export(pid: str):
        p = store.project(pid)
        return jobs.start("export", pid, lambda: export_dataset(store, p, jobs.update, jobs.stop_event))

    @app.get("/api/exports/{eid}")
    def download_export(eid: str):
        if not re.fullmatch(r"[a-f0-9]{32}", eid):
            raise KeyError("Export not found.")
        path = store.root / "exports" / f"{eid}.zip"
        if not path.is_file():
            raise KeyError("Export not found.")
        return FileResponse(path, filename="axiom-yolo-dataset.zip", media_type="application/zip")

    @app.post("/api/projects/{pid}/train")
    def train(pid: str):
        p = store.project(pid)
        return jobs.start("training", pid, lambda: jobs.train(p))

    @app.get("/api/runs/{rid}/best")
    def best(rid: str):
        if not re.fullmatch(r"[a-f0-9]{32}", rid):
            raise KeyError("Checkpoint not found.")
        path = store.root / "runs" / rid / "train" / "weights" / "best.pt"
        if not path.is_file():
            raise KeyError("Checkpoint not found.")
        return FileResponse(path, filename="axiom-best.pt")

    @app.get("/api/job")
    def job():
        return jobs.snapshot()

    @app.post("/api/job/stop")
    def stop():
        return jobs.cancel()

    app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
    return app


app = create_app()
