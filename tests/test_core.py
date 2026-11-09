import io
import json
import threading
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from axiom.app import create_app
from axiom.dataset import export_dataset
from axiom.imaging import fit_image, map_box, open_image, probe_image
from axiom.inference import parse_boxes, prompts
from axiom.store import DEFAULTS, Store, classes


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "data")) as c:
        yield c


def project(client):
    return client.get('/api/projects').json()[0]['id']


def wait_job(client):
    for _ in range(200):
        state = client.get('/api/job').json()
        if not state['active']:
            return state
        time.sleep(.02)
    pytest.fail('Job did not finish')


def import_image(client, tmp_path, mode='PNG'):
    path = tmp_path / f'frame-{mode}.png'
    Image.new('RGB', (200, 100), '#53714a').save(path, mode)
    pid = project(client)
    assert client.post(f'/api/projects/{pid}/import', json={'paths': [str(path)]}).status_code == 200
    assert wait_job(client)['stage'] == 'complete'
    return client.get(f'/api/projects/{pid}/images').json()['items'][0]


def test_manual_save_conflict_and_recovery(client, tmp_path):
    item = import_image(client, tmp_path)
    b = {'class_id': 0, 'x1': .1, 'y1': .2, 'x2': .6, 'y2': .9}
    path = f"/api/images/{item['id']}/annotations"
    r = client.put(path, json={'boxes': [b], 'revision': 0})
    assert r.status_code == 200 and r.json()['revision'] == 1
    assert client.put(path, json={'boxes': [], 'revision': 0}).status_code == 409
    assert client.get(f"/api/images/{item['id']}").json()['boxes'] == [b]
    assert client.put(path, json={'boxes': [{**b, 'x2': .01}], 'revision': 1}).status_code == 400
    assert client.put(path, json={'boxes': [{**b, 'class_id': 9}], 'revision': 1}).status_code == 400
    reopened = Store(client.app.state.store.root)
    assert reopened.image(item['id'])['boxes'] == [b]


@pytest.mark.parametrize('uploaded', [False, True])
def test_remove_image_preserves_files_and_allows_reimport(client, tmp_path, uploaded):
    pid = project(client)
    if uploaded:
        buf = io.BytesIO(); Image.new('RGB', (200, 100)).save(buf, 'PNG')
        client.post(f'/api/projects/{pid}/upload', files=[('files', ('sample.png', buf.getvalue(), 'image/png'))])
        item = client.get(f'/api/projects/{pid}/images').json()['items'][0]
    else:
        item = import_image(client, tmp_path)
    original = Path(item['path']).read_bytes()
    b = {'class_id': 0, 'x1': .1, 'y1': .2, 'x2': .6, 'y2': .9}
    client.put(f"/api/images/{item['id']}/annotations", json={'boxes': [b], 'revision': 0})
    endpoint = f"/api/images/{item['id']}"
    assert client.request('DELETE', endpoint, json={'revision': 0}).status_code == 409
    assert client.request('DELETE', endpoint, json={'revision': 1}).status_code == 200
    assert client.get(endpoint).status_code == 404
    assert client.get(endpoint + '/preview').status_code == 404
    assert Path(item['path']).read_bytes() == original
    assert client.get(f'/api/projects/{pid}').json()['stats'] == {
        'total': 0, 'pending': 0, 'auto': 0, 'reviewed': 0, 'error': 0, 'boxes': 0}
    reopened = Store(client.app.state.store.root)
    assert reopened.all_images(pid) == []
    assert client.request('DELETE', endpoint, json={'revision': 1}).status_code == 404
    client.post(f'/api/projects/{pid}/import', json={'paths': [item['path']]})
    wait_job(client)
    restored = client.get(f'/api/projects/{pid}/images').json()['items'][0]
    assert restored['id'] != item['id'] and restored['boxes'] == [] and restored['status'] == 'pending'


def test_remove_image_blocked_during_jobs_and_requires_revision(client, tmp_path):
    item = import_image(client, tmp_path)
    endpoint = f"/api/images/{item['id']}"
    for body in [{}, {'revision': True}, {'revision': -1}]:
        assert client.request('DELETE', endpoint, json=body).status_code == 400
    jobs = client.app.state.jobs
    gate = threading.Event()
    jobs.start('test', item['project_id'], lambda: gate.wait(5))
    try:
        assert client.request('DELETE', endpoint, json={'revision': 0}).status_code == 400
        assert client.get(endpoint).status_code == 200
    finally:
        gate.set()
        wait_job(client)


def test_bulk_removal_is_atomic_and_project_scoped(client, tmp_path):
    pid = project(client)
    for n in range(3):
        Image.new('RGB', (64, 48), (n, 30, 40)).save(tmp_path / f'bulk-{n}.png')
    client.post(f'/api/projects/{pid}/import', json={'paths': [str(tmp_path)]})
    wait_job(client)
    selection = client.get(f'/api/projects/{pid}/selection').json()['items']
    assert len(selection) == 3 and set(selection[0]) == {'id', 'revision'}
    client.put(f"/api/images/{selection[1]['id']}/annotations", json={'boxes': [], 'revision': 0})
    endpoint = f'/api/projects/{pid}/images/remove'
    assert client.post(endpoint, json={'images': selection}).status_code == 409
    assert client.get(f'/api/projects/{pid}/images').json()['total'] == 3
    other = client.post('/api/projects', json={'name': 'Other'}).json()['id']
    assert client.post(f'/api/projects/{other}/images/remove', json={'images': selection}).status_code == 409
    filtered = client.get(f'/api/projects/{pid}/selection?status=reviewed&search=bulk-1').json()['items']
    assert filtered == [{'id': selection[1]['id'], 'revision': 1}]
    fresh = client.get(f'/api/projects/{pid}/selection').json()['items']
    for invalid in [[], [fresh[0], fresh[0]], [{'id': fresh[0]['id'], 'revision': True}]]:
        assert client.post(endpoint, json={'images': invalid}).status_code == 400
    assert client.post(endpoint, json={'images': fresh}).json()['removed'] == 3
    assert client.get(f'/api/projects/{pid}').json()['stats']['total'] == 0
    assert len(list(tmp_path.glob('bulk-*.png'))) == 3


def test_bulk_removal_handles_sqlite_chunk_boundaries(client, tmp_path):
    store = client.app.state.store
    pid = project(client)
    for n in range(505): store.add_image(pid, tmp_path / f'{n}.png', f'{n}.png', 1, 1)
    selection = client.get(f'/api/projects/{pid}/selection').json()['items']
    assert len(selection) == 505
    gate = threading.Event(); jobs = client.app.state.jobs
    jobs.start('test', pid, lambda: gate.wait(5))
    try:
        assert client.post(f'/api/projects/{pid}/images/remove', json={'images': selection}).status_code == 400
    finally:
        gate.set(); wait_job(client)
    assert client.post(f'/api/projects/{pid}/images/remove', json={'images': selection}).json()['removed'] == 505
    assert store.all_images(pid) == []


def test_project_management_preserves_isolation_and_source_files(client, tmp_path):
    item = import_image(client, tmp_path)
    original = Path(item['path']).read_bytes()
    first = item['project_id']
    second = client.post('/api/projects', json={'name': 'Second 項目'}).json()['id']
    # The same original file can belong to separate projects with independent labels/settings.
    client.post(f'/api/projects/{second}/import', json={'paths': [item['path']]}); wait_job(client)
    other_image = client.get(f'/api/projects/{second}/images').json()['items'][0]
    client.put(f"/api/images/{item['id']}/annotations", json={'boxes': [], 'revision': 0})
    settings = {**DEFAULTS, 'game': 'Project B', 'heads': True}
    client.put(f'/api/projects/{second}/settings', json=settings)
    renamed = client.patch(f'/api/projects/{first}', json={'name': 'Renamed 項目'}).json()
    assert renamed['name'] == 'Renamed 項目' and renamed['stats']['reviewed'] == 1
    listed = {p['id']: p for p in client.get('/api/projects').json()}
    assert listed[first]['stats']['total'] == listed[second]['stats']['total'] == 1
    assert listed[first]['stats']['reviewed'] == 1 and listed[second]['stats']['reviewed'] == 0
    assert client.get(f'/api/projects/{first}').json()['settings']['heads'] is False
    assert client.delete(f'/api/projects/{first}').json()['images'] == 1
    assert client.get(f'/api/projects/{first}').status_code == 404
    assert client.get(f"/api/images/{item['id']}").status_code == 404
    assert client.get(f"/api/images/{other_image['id']}").status_code == 200
    assert client.get(f'/api/projects/{second}').json()['settings'] == settings
    assert Path(item['path']).read_bytes() == original
    assert client.delete(f'/api/projects/{second}').status_code == 200
    assert client.get('/api/projects').json() == []
    assert Store(client.app.state.store.root).projects() == []  # no deleted project recreated at restart
    assert client.post('/api/projects', json={'name': 'Fresh start'}).status_code == 200


def test_project_deletion_protects_the_running_project(client, tmp_path):
    first = project(client)
    second = client.post('/api/projects', json={'name': 'Other'}).json()['id']
    for name in ['', '  ', None, 'x' * 101]:
        assert client.post('/api/projects', json={'name': name}).status_code == 400
        assert client.patch(f'/api/projects/{first}', json={'name': name}).status_code == 400
    assert client.patch('/api/projects/missing', json={'name': 'Name'}).status_code == 404
    gate = threading.Event(); jobs = client.app.state.jobs
    jobs.start('test', first, lambda: gate.wait(5))
    try:
        assert client.delete(f'/api/projects/{first}').status_code == 400
        assert client.delete(f'/api/projects/{second}').status_code == 200
        assert client.patch(f'/api/projects/{first}', json={'name': 'Still running'}).status_code == 200
    finally:
        gate.set(); wait_job(client)


def test_class_layout_and_prompts(client, tmp_path):
    pid = project(client)
    s = {**DEFAULTS, 'teams': True, 'heads': True, 'game': 'Test Arena'}
    r = client.put(f'/api/projects/{pid}/settings', json=s)
    assert r.json()['classes'] == ['teammate', 'enemy', 'teammate_head', 'enemy_head']
    q = prompts(s)
    assert len(q) == 4 and 'full bodies' in q[0] and 'heads only' in q[2]
    assert s['teammate'] in q[0] and s['enemy'] in q[1] and 'Test Arena' in q[3]
    item = import_image(client, tmp_path)
    client.put(f"/api/images/{item['id']}/annotations", json={'boxes': [], 'revision': 0})
    assert client.put(f'/api/projects/{pid}/settings', json={**s, 'teams': False}).status_code == 400
    assert len(prompts({**s, 'describe': False})) == 4


def test_resize_round_trip():
    im = Image.new('RGB', (1920, 1080))
    original = {'class_id': 0, 'x1': .1, 'y1': .2, 'x2': .6, 'y2': .9}
    for mode, dims in [('off', (1920, 1080)), ('1k', (1024, 1024)), ('720p', (1280, 720)), ('480p', (854, 480))]:
        fitted, affine = fit_image(im, mode)
        assert fitted.size == dims
        input_box = map_box(original, im.size, fitted.size, affine)
        result = map_box(input_box, im.size, fitted.size, affine, inverse=True)
        for key in ('x1', 'y1', 'x2', 'y2'):
            assert result[key] == pytest.approx(original[key], abs=1e-9)


def test_exif_and_additional_codecs(tmp_path):
    exif = Image.Exif(); exif[274] = 6
    path = tmp_path / 'rotated.jpg'
    Image.new('RGB', (300, 100)).save(path, exif=exif)
    assert probe_image(path) == open_image(path).size == (100, 300)
    for fmt, suffix in [('HEIF', '.heic'), ('TGA', '.tga'), ('PPM', '.ppm')]:
        path = tmp_path / f'image{suffix}'
        Image.new('RGB', (64, 48)).save(path, fmt)
        assert probe_image(path) == open_image(path).size == (64, 48)


def test_export_yolo_and_negative_images(client, tmp_path):
    item = import_image(client, tmp_path)
    pid = project(client)
    # A reviewed empty image is a valid negative. Pending images are excluded.
    for n in range(2):
        Image.new('RGB', (100, 200), (n, 30, 40)).save(tmp_path / f'extra{n}.jpg')
    client.post(f'/api/projects/{pid}/import', json={'paths': [str(tmp_path)]})
    wait_job(client)
    all_items = client.get(f'/api/projects/{pid}/images').json()['items']
    b = {'class_id': 0, 'x1': .1, 'y1': .2, 'x2': .6, 'y2': .9}
    client.put(f"/api/images/{item['id']}/annotations", json={'boxes': [b], 'revision': 0})
    negative = next(i for i in all_items if i['id'] != item['id'])
    client.put(f"/api/images/{negative['id']}/annotations", json={'boxes': [], 'revision': 0})
    client.post(f'/api/projects/{pid}/export')
    job = wait_job(client)
    assert job['stage'] == 'complete', job
    assert job['result']['images'] == 2 and job['result']['train'] == job['result']['val'] == 1
    response = client.get(job['result']['url'])
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        labels = [z.read(f).decode() for f in z.namelist() if f.endswith('.txt') and f.startswith('labels/')]
        assert '' in labels and '0 0.35000000 0.55000000 0.50000000 0.70000000\n' in labels
        assert len([f for f in z.namelist() if f.endswith('.jpg')]) == 2
        assert 'train: images/train' in z.read('data.yaml').decode()
        assert z.read('classes.txt').decode() == 'target\n'


def test_formats_duplicates_and_bad_inputs(client, tmp_path):
    for fmt, ext in [('PNG', 'png'), ('JPEG', 'jpg'), ('WEBP', 'webp'), ('BMP', 'bmp'), ('TIFF', 'tif'), ('GIF', 'gif'), ('AVIF', 'avif')]:
        Image.new('RGB', (63, 41)).save(tmp_path / f'測試-{fmt}.{ext}', fmt)
    (tmp_path / 'broken.png').write_text('bad image')
    pid = project(client)
    client.post(f'/api/projects/{pid}/import', json={'paths': [str(tmp_path), str(tmp_path)]})
    job = wait_job(client)
    assert job['result']['added'] == 7 and job['result']['errors'] == 1
    client.post(f'/api/projects/{pid}/import', json={'paths': [str(tmp_path)]})
    job = wait_job(client)
    assert job['result']['duplicates'] == 7 and job['result']['added'] == 0
    item = client.get(f'/api/projects/{pid}/images').json()['items'][0]
    assert client.get(f"/api/images/{item['id']}/thumbnail").status_code == 200
    assert client.get(f"/api/images/{item['id']}/preview").status_code == 200


def test_upload_deduplicates_and_protects_paths(client, tmp_path):
    pid = project(client)
    buf = io.BytesIO(); Image.new('RGB', (100, 200)).save(buf, 'PNG'); raw = buf.getvalue()
    for _ in range(2):
        r = client.post(f'/api/projects/{pid}/upload', files=[('files', ('../../escape.png', raw, 'image/png'))])
        assert r.status_code == 200
    items = client.get(f'/api/projects/{pid}/images').json()['items']
    assert len(items) == 1 and items[0]['name'] == 'escape.png'
    assert Path(items[0]['path']).is_relative_to(client.app.state.store.root / 'imports')
    assert client.post('/api/projects', json={'name': 'x'}, headers={'origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/health', headers={'host': 'evil.example'}).status_code == 400


def test_model_output_parser():
    raw = '<ref>person</ref><box><10><20><450><900>,<500><100><990><999></box><|im_end|>'
    assert len(parse_boxes(raw, 2)) == 2
    assert parse_boxes(raw, 2)[0] == {'class_id': 2, 'x1': .01, 'y1': .02, 'x2': .45, 'y2': .9}
    assert parse_boxes('None<|im_end|>', 0) == []
    assert parse_boxes('<ref>person</ref><box>None</box>', 0) == []
    with pytest.raises(ValueError): parse_boxes('<box><10><20><400></box>', 0)
    with pytest.raises(ValueError): parse_boxes('I see three people', 0)


def test_fp8_cuda_math():
    import torch
    if not torch.cuda.is_available(): pytest.skip('CUDA unavailable')
    from axiom.inference import make_fp8_linear
    torch.manual_seed(5)
    layer = torch.nn.Linear(256, 128, device='cuda', dtype=torch.bfloat16)
    for fast, fused in [(False, False), (True, False), (True, True)]:
        if fast and torch.cuda.get_device_capability() < (8, 9):
            continue
        quant = make_fp8_linear(layer, fast)
        if not fused: quant.decode_kernel = None
        assert quant.weight.dtype == torch.float8_e4m3fn
        # Decode, small batches and prefill, including padding boundaries and a
        # non-contiguous input. Compare to native math, not the implementation.
        for rows in [1, 3, 10, 16, 17, 64]:
            x = torch.randn(2, rows, 256, device='cuda', dtype=torch.bfloat16)[0:1]
            with torch.inference_mode():
                expected, actual = layer(x).float(), quant(x).float()
            assert actual.shape == expected.shape
            assert ((expected - actual).square().mean().sqrt() / expected.square().mean().sqrt()).item() < .08
        x = torch.randn(1, 256, 3, device='cuda', dtype=torch.bfloat16).transpose(1, 2)
        with torch.inference_mode():
            assert torch.allclose(quant(x).float(), layer(x).float(), atol=.08, rtol=.08)


@pytest.mark.parametrize('dtype_name', ['bfloat16', 'float16'])
def test_fused_fp8_decode_quantization(dtype_name):
    import torch
    if not torch.cuda.is_available(): pytest.skip('CUDA unavailable')
    from axiom.fp8 import decode_quantizer, quantize_decode
    dtype = getattr(torch, dtype_name)
    kernel = decode_quantizer(torch.cuda.current_device(), dtype)
    if kernel is None: pytest.skip('NVRTC / CUDA headers unavailable')
    torch.manual_seed(17)
    for rows, columns in [(1, 2560), (3, 9728), (16, 256), (1, 128)]:
        x = torch.randn(rows, columns, device='cuda', dtype=dtype)
        if columns == 128: x.zero_()
        quant, scale = quantize_decode(x, kernel)
        reference_scale = x.float().abs().amax().clamp_min(1e-12).reshape(1) / 448.
        reference = (x.float() / reference_scale).clamp(-448, 448).to(torch.float8_e4m3fn)
        assert torch.equal(scale, reference_scale)
        assert torch.equal(quant[:rows].float(), reference.float())
        assert not quant[rows:].float().count_nonzero().item()


def test_fused_fp8_compiler_fallback(monkeypatch, caplog):
    import torch
    if not torch.cuda.is_available(): pytest.skip('CUDA unavailable')
    from axiom.fp8 import decode_quantizer
    def unavailable(*args, **kwargs):
        raise RuntimeError('CUDA headers unavailable')
    monkeypatch.setattr(torch.cuda, '_compile_kernel', unavailable)
    assert decode_quantizer.__wrapped__(torch.cuda.current_device(), torch.bfloat16) is None
    assert 'using CUDA scaled GEMM' in caplog.text
