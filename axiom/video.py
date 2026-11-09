"""Bounded-memory video probing and sampled frame import using bundled FFmpeg."""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import subprocess
import time
from pathlib import Path

from .imaging import probe_image
from .store import atomic_json

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.ogv', '.3gp'}


def ffmpeg_executable():
    # Prefer a known modern bundled binary over potentially ancient PATH installations.
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        found = shutil.which('ffmpeg')
        if not found:
            raise ValueError('Video import requires FFmpeg. Run Setup.bat to install it.')
        return found


def probe_video(raw_path):
    path = Path(str(raw_path).strip().strip('"')).expanduser().resolve()
    if not path.is_file():
        raise ValueError('Video file not found.')
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError('Unsupported video format.')
    result = subprocess.run([ffmpeg_executable(), '-hide_banner', '-i', str(path)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30,
                            encoding='utf-8', errors='replace')
    output = result.stderr
    duration = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', output)
    streams = [line for line in output.splitlines() if 'Video:' in line and 'attached pic' not in line]
    dimensions = re.search(r'(?:^|,\s*)(\d{1,6})x(\d{1,6})(?=[,\s\[])', streams[0].split('Video:', 1)[1]) if streams else None
    if not duration or not dimensions:
        raise ValueError('Could not read video duration or dimensions. The file may be damaged or unsupported.')
    seconds = int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])
    width, height = map(int, dimensions.groups())
    # ffprobe can provide finer precision than FFmpeg's human-readable duration.
    probe = shutil.which('ffprobe')
    if probe:
        try:
            metadata = subprocess.run([probe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)],
                                      capture_output=True, timeout=10, encoding='utf-8', errors='replace')
            precise = float(json.loads(metadata.stdout)['format']['duration'])
            if metadata.returncode == 0 and math.isfinite(precise) and precise > 0:
                seconds = precise
        except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
            pass
    rotation = re.search(r'rotation of\s+(-?[\d.]+)', output)
    if rotation and round(float(rotation[1])) % 180:
        width, height = height, width
    if not math.isfinite(seconds) or seconds <= 0 or width <= 0 or height <= 0:
        raise ValueError('The video has no readable frames.')
    stat = path.stat()
    fingerprint = hashlib.sha256(f'{path}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
    return {'path': str(path), 'name': path.name, 'duration': seconds, 'width': width, 'height': height,
            'fingerprint': fingerprint}


def extraction_plan(video, start, end, interval):
    try:
        if any(isinstance(v, bool) for v in (start, end, interval)):
            raise ValueError()
        start, end, interval = float(start), float(end), float(interval)
    except (TypeError, ValueError):
        raise ValueError('Enter valid video start, end and interval values.')
    if not all(math.isfinite(v) for v in (start, end, interval)):
        raise ValueError('Enter valid video start, end and interval values.')
    if not 0.05 <= interval <= 86400:
        raise ValueError('The frame interval must be between 0.05 and 86400 seconds.')
    if start < 0 or end <= start or start >= video['duration'] or end > video['duration'] + .02:
        raise ValueError('The clip must start before its end and stay within the video duration.')
    end = min(end, video['duration'])
    count = max(1, math.ceil((end - start) / interval - 1e-9))
    if count > 50000:
        raise ValueError('This clip would produce more than 50,000 images. Increase the interval or shorten the clip.')
    return {'start': start, 'end': end, 'interval': interval, 'count': count}


def extract_video(store, video, plan, update, stop):
    source = Path(video['path'])
    if not source.is_file():
        raise ValueError('Video file not found.')
    stat = source.stat()
    fingerprint = hashlib.sha256(f'{source}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
    if fingerprint != video['fingerprint']:
        raise ValueError('The video file changed. Import it again before extracting frames.')
    key = hashlib.sha256(json.dumps([fingerprint, plan['start'], plan['end'], plan['interval']]).encode()).hexdigest()[:32]
    folder = store.root / 'frames' / video['project_id'] / key
    folder.mkdir(parents=True, exist_ok=True)
    completed = added = duplicates = 0
    total = plan['count']
    started = time.monotonic()

    def ingest_available():
        nonlocal completed, added, duplicates
        while completed < total:
            if stop.is_set():
                break
            path = folder / f'frame_{completed + 1:08d}.jpg'
            if not path.is_file():
                break
            w, h = probe_image(path)
            timestamp = plan['start'] + completed * plan['interval']
            name = f"{Path(video['name']).stem} [{timestamp:.3f}s].jpg"
            if store.add_image(video['project_id'], path, name, w, h):
                added += 1
            else:
                duplicates += 1
            completed += 1
            rate = completed / max(.001, time.monotonic() - started)
            update(stage='extracting', completed=completed, total=total, rate=round(rate, 3),
                   eta=round((total - completed) / rate),
                   message=f"Extracting video frames · {completed}/{total} · {video['name']}")

    update(stage='extracting', completed=0, total=total, message=f"Extracting video frames · 0/{total} · {video['name']}")
    ingest_available()  # Reuse cached frames and resume an interrupted extraction.
    if completed < total and not stop.is_set():
        remaining_start = plan['start'] + completed * plan['interval']
        command = [ffmpeg_executable(), '-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-y',
                   '-ss', f'{remaining_start:.9f}', '-threads', '2', '-i', str(source),
                   '-t', f"{plan['end'] - remaining_start:.9f}", '-map', '0:v:0', '-an', '-sn', '-dn',
                   '-filter_threads', '1', '-vf', f"fps=1/{plan['interval']:.9f}:start_time=0:round=up:eof_action=pass",
                   '-frames:v', str(total - completed), '-q:v', '3', '-threads', '2',
                   '-start_number', str(completed + 1), '-atomic_writing', '1', str(folder / 'frame_%08d.jpg')]
        error_path = folder / 'ffmpeg.log'
        with error_path.open('w', encoding='utf-8') as errors:
            proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=errors)
            try:
                while proc.poll() is None:
                    ingest_available()
                    if stop.wait(.1):
                        proc.terminate()
                        break
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()
                ingest_available()
                if proc.returncode and not stop.is_set():
                    detail = error_path.read_text(encoding='utf-8', errors='replace')[-1800:]
                    raise ValueError('Video frame extraction failed. ' + detail)
            finally:
                if proc.poll() is None:
                    proc.terminate()
                    try: proc.wait(timeout=5)
                    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    if not completed and not stop.is_set():
        raise ValueError('The selected clip contains no decodable frames.')
    atomic_json(folder / 'clip.json', {'video': video['name'], **plan, 'saved': completed, 'complete': not stop.is_set()})
    if not stop.is_set():
        update(completed=completed, total=completed, eta=0)
    return {'added': added, 'duplicates': duplicates, 'frames': completed, 'requested': total, 'video': video['name']}
