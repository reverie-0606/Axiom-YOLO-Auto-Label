import subprocess
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from axiom.app import create_app
from axiom.store import Store
from axiom.video import extract_video, extraction_plan, ffmpeg_executable, probe_video


@pytest.fixture(scope='module')
def color_video(tmp_path_factory):
    root = tmp_path_factory.mktemp('video')
    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]
    for n in range(40):
        Image.new('RGB', (160, 120), colors[n // 10]).save(root / f'frame_{n:03d}.png')
    path = root / 'Time colors 測試.mp4'
    result = subprocess.run([ffmpeg_executable(), '-hide_banner', '-loglevel', 'error', '-y',
        '-framerate', '10', '-i', str(root / 'frame_%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)],
        capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return path


def wait_job(client):
    import time
    for _ in range(300):
        job = client.get('/api/job').json()
        if not job['active']: return job
        time.sleep(.03)
    pytest.fail('Video job did not finish')


def test_real_video_timestamps_cache_and_annotations(color_video, tmp_path):
    store = Store(tmp_path / 'data')
    pid = store.projects()[0]['id']
    info = probe_video(color_video)
    assert info['duration'] == pytest.approx(4, abs=.02)
    assert (info['width'], info['height']) == (160, 120)
    video = store.save_video(pid, info)
    plan = extraction_plan(video, .5, 3.1, 1)
    result = extract_video(store, video, plan, lambda **kw: None, threading.Event())
    assert result['frames'] == result['added'] == 3
    images = store.all_images(pid)
    for item, color, time in zip(images, [(255,0,0), (0,255,0), (0,0,255)], ['0.500s','1.500s','2.500s']):
        pixel = Image.open(item['path']).getpixel((80,60))
        assert max(abs(a-b) for a,b in zip(pixel,color)) < 15, (item['name'], pixel, color)
        assert time in item['name']
    store.save_boxes(images[0]['id'], [], 0)
    again = extract_video(store, video, plan, lambda **kw: None, threading.Event())
    assert again['added'] == 0 and again['duplicates'] == 3
    assert store.image(images[0]['id'])['revision'] == 1
    # A second range starts at its requested time, not at the preceding keyframe.
    later = extraction_plan(video, 1.2, 3.8, 1)
    assert extract_video(store, video, later, lambda **kw: None, threading.Event())['added'] == 3
    for item, color in zip(store.all_images(pid)[3:], [(0,255,0),(0,0,255),(255,255,0)]):
        pixel = Image.open(item['path']).getpixel((80,60))
        assert max(abs(a-b) for a,b in zip(pixel,color)) < 15


def test_video_api_upload_range_and_project_isolation(color_video, tmp_path):
    with TestClient(create_app(tmp_path/'data')) as client:
        pid = client.get('/api/projects').json()[0]['id']
        original = color_video.read_bytes()
        uploaded = client.post(f'/api/projects/{pid}/videos/upload', files={'file': ('../clip.mp4',original,'video/mp4')})
        assert uploaded.status_code == 200, uploaded.text
        video = uploaded.json()
        assert video['name'] == 'clip.mp4' and Path(video['path']).is_relative_to(tmp_path/'data'/'videos')
        preview = client.get(f"/api/videos/{video['id']}/preview", headers={'Range':'bytes=0-15'})
        assert preview.status_code == 206 and preview.content == original[:16]
        other = client.post('/api/projects',json={'name':'Other'}).json()['id']
        payload = {'video_id':video['id'],'start':.5,'end':3.1,'interval':1}
        assert client.post(f'/api/projects/{other}/videos/extract',json=payload).status_code == 404
        for changes in [{'start':-1}, {'end':0}, {'end':99}, {'interval':0}, {'interval':True}, {'interval':'nan'}]:
            assert client.post(f'/api/projects/{pid}/videos/extract',json={**payload,**changes}).status_code == 400
        assert client.post(f'/api/projects/{pid}/videos/extract',json=payload).status_code == 200
        job = wait_job(client)
        assert job['stage'] == 'complete' and job['result']['added'] == 3, job
        assert client.get(f'/api/projects/{pid}/images').json()['total'] == 3
        assert client.post(f'/api/projects/{pid}/videos/extract',json=payload).status_code == 200
        assert wait_job(client)['result']['duplicates'] == 3
        assert client.delete(f'/api/projects/{pid}').status_code == 200
        assert client.get(f"/api/videos/{video['id']}/preview").status_code == 404
        assert Path(video['path']).read_bytes() == original and color_video.read_bytes() == original


def test_cancel_before_extraction_then_resume(color_video, tmp_path):
    store = Store(tmp_path/'data'); pid = store.projects()[0]['id']
    video = store.save_video(pid,probe_video(color_video)); plan = extraction_plan(video,0,4,1)
    stop = threading.Event(); stop.set()
    assert extract_video(store,video,plan,lambda **kw:None,stop)['frames'] == 0
    assert store.all_images(pid) == []
    stop.clear()
    assert extract_video(store,video,plan,lambda **kw:None,stop)['frames'] == 4


def test_stop_during_extraction_preserves_frames_and_resumes(color_video, tmp_path):
    store = Store(tmp_path/'data'); pid = store.projects()[0]['id']
    video = store.save_video(pid,probe_video(color_video)); plan = extraction_plan(video,0,4,.05)
    stop = threading.Event()
    def update(**state):
        if state.get('completed') == 2: stop.set()
    stopped = extract_video(store,video,plan,update,stop)
    assert stopped['frames'] == 2 and len(store.all_images(pid)) == 2
    stop.clear()
    resumed = extract_video(store,video,plan,lambda **kw:None,stop)
    assert resumed['frames'] == 80 and resumed['added'] == 78 and resumed['duplicates'] == 2
