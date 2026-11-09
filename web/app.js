'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const {t, message: localizeMessage} = window.AxiomI18n;
const classLabel = name => window.AxiomI18n.locale === 'en' ? name.replaceAll('_', ' ') : t(name);
const COLORS = ['#b9f58a', '#f18489', '#7fb1fa', '#c3a2ff'];
const EXT = /\.(jpe?g|png|webp|bmp|tiff?|gif|avif|hei[cf]|jfif|jpe|ppm|pgm|pbm|ico|tga)$/i;
const state = {project: null, items: [], page: 0, total: 0, filter: 'all', search: '', view: 'label',
  projects: [], projectActionPending: false,
  videoImportOpen: false, videoUploadProgress: null,
  editor: null, tool: 'select', selected: -1, zoom: 1, pan: {x: 0, y: 0}, drag: null,
  imageSelection: new Map(), imageSelectionFocus: true, selectingImages: false,
  space: false, activeClass: 0, job: {}, lastJob: '', busy: false, uploading: false, uploadProgress: null, reviewing: false, deleting: false, settingsDirty: false};
let settingTimer, saveTimer, toastTimer, searchTimer, imageLoad = 0, pollTimer;
let settingsChain = Promise.resolve();
let fetchCounter = 0;
let projectLoadRequest = 0;
let lastSaveMessage = 'Saved', lastSaveFailed = false, lastToastMessage = '';
const canvas = $('#editor'), ctx = canvas.getContext('2d');

async function api(path, body, method = 'POST') {
  const options = body === undefined && method === 'GET' ? {} : {method};
  if (body !== undefined) {
    options.body = body instanceof FormData ? body : JSON.stringify(body);
    if (!(body instanceof FormData)) options.headers = {'Content-Type': 'application/json'};
  }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  return data;
}
const get = path => api(path, undefined, 'GET');
function toast(message, error = false) {
  lastToastMessage = message;
  const el = $('#toast'); el.textContent = typeof message === 'function' ? message() : localizeMessage(message); el.classList.remove('hidden'); el.classList.toggle('error-toast', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), error ? 11000 : 4500);
}
function guarded(action) { return async (...args) => { try { await action(...args); } catch (e) { toast(e.message, true); } }; }
function text(el, content) { $(el).textContent = localizeMessage(content); }
function show(selector, visible) { $(selector).classList.toggle('hidden', !visible); }
function savedStatus(message = 'Saved', failed = false) {
  lastSaveMessage = message; lastSaveFailed = failed;
  const el = $('#save-status'); el.replaceChildren(); const dot = document.createElement('i');
  dot.style.background = failed ? '#f18489' : '#b9f58a'; el.append(dot, document.createTextNode(localizeMessage(message)));
}
function formatTime(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  value = Math.round(value); return value < 60 ? t('{count}s', {count:value}) : value < 3600 ? t('{minutes}m {seconds}s', {minutes:Math.floor(value/60), seconds:value%60}) : t('{hours}h {minutes}m', {hours:Math.floor(value/3600), minutes:Math.floor(value%3600/60)});
}

async function refreshProjects(selected) {
  const projects = await get('/api/projects'); state.projects = projects;
  if (!projects.length) { showNoProjects(); return; }
  const id = selected || localStorage.getItem('axiom.project');
  const active = projects.some(p => p.id === id) ? id : projects[0].id;
  populateProjectPicker(); await loadProject(active); renderProjectCards();
}
async function loadProject(id) {
  const request = ++projectLoadRequest;
  await flushEditor(); await flushSettings();
  const loaded = await get(`/api/projects/${id}`);
  if (request !== projectLoadRequest) return;
  ++imageLoad; ++fetchCounter;
  state.project = loaded; state.editor = null; state.page = 0; state.selected = -1;
  state.filter = 'all'; state.search = ''; $('#search').value = ''; state.settingsDirty = false;
  clearImageSelection();
  localStorage.setItem('axiom.project', id); $('#project-select').value = id;
  $$('#filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  renderSettings(); renderStats(); renderClasses(); renderEditor(); await loadGallery();
}
function renderStats() {
  const stats = state.project.stats;
  text('#dataset-count', stats.total.toLocaleString()); text('#count-all', stats.total);
  for (const key of ['pending', 'auto', 'reviewed', 'error']) text(`#count-${key}`, stats[key]);
  const locked = stats.auto + stats.reviewed > 0;
  for (const key of ['teams', 'heads']) $(`[data-setting="${key}"]`).disabled = locked || state.busy;
  show('#class-lock', locked);
  const entry = state.projects.find(project => project.id === state.project.id);
  if (entry) entry.stats = {...stats};
  renderWorkflow();
}
function eligibleImages() {
  if (!state.project) return 0;
  const s = state.project.stats;
  return s.pending + s.error + (state.project.settings.skip_done ? 0 : s.auto);
}
function renderWorkflow() {
  if (!state.project) {
    for (const id of ['run-auto','auto-settings','start-auto','export','start-training','import','load-model','unload-model']) $('#'+id).disabled = true;
    renderProjectAvailability(); return;
  }
  const stats = state.project.stats, count = eligibleImages(), busy = state.busy || state.uploading || state.deleting || state.projectActionPending || state.videoImportOpen;
  $('.workspace').classList.toggle('empty-workspace', state.view === 'label' && !stats.total);
  $('#run-auto').disabled = busy || !(stats.pending + stats.error + stats.auto);
  $('#auto-settings').disabled = busy;
  $('#start-auto').disabled = busy || !count;
  $('#export').disabled = busy || !(stats.auto + stats.reviewed);
  $('#start-training').disabled = busy || stats.auto + stats.reviewed < 2;
  $('#import').disabled = busy;
  $('#project-select').disabled = state.deleting || state.uploading;
  $('#new-project').disabled = state.deleting || state.uploading;
  $('#remove-image').disabled = busy || !state.editor || state.reviewing;
  text('#start-auto', count ? t(count === 1 ? 'Label {count} image' : 'Label {count} images', {count}) : 'No images to label');
  text('#auto-summary', count ? t(count === 1 ? '{count} image to label. Reviewed images are kept.' : '{count} images to label. Reviewed images are kept.', {count}) : stats.auto ? 'Turn off “Only new images” to label automatic results again.' : stats.total ? 'All images are reviewed. Your edits are kept.' : 'Add images to begin. Settings save automatically.');
  const hint = !stats.total ? 'Add your images to get started.' : stats.pending || stats.error ? 'Run Auto label, or draw your own boxes.' : stats.auto ? 'Check the boxes, then confirm each image.' : 'All images reviewed. Export your YOLO dataset.';
  text('#workflow-hint', hint);
  renderImageSelection();
  renderProjectAvailability();
}
async function refreshStats() {
  if (!state.project) return;
  const id = state.project.id; const latest = await get(`/api/projects/${id}`);
  if (state.project?.id !== id) return;
  state.project.stats = latest.stats; renderStats();
}
function renderClasses() {
  const names = state.project.classes;
  const select = $('#active-class'); select.replaceChildren(); $('#class-legend').replaceChildren();
  names.forEach((name, i) => {
    select.add(new Option(classLabel(name), i));
    const row = document.createElement('div'), dot = document.createElement('i'), label = document.createElement('span'), num = document.createElement('small');
    dot.className = 'class-swatch'; dot.style.color = COLORS[i % COLORS.length]; label.textContent = classLabel(name);
    num.textContent = String(i).padStart(2, '0'); row.append(dot, label, num); $('#class-legend').append(row);
  });
  state.activeClass = Math.min(state.activeClass, names.length - 1); select.value = state.activeClass;
  text('#class-count', String(names.length).padStart(2, '0')); renderBoxList();
  show('#active-class', names.length > 1);
  show('label[for="active-class"]', names.length > 1);
}
function renderSettings() {
  const settings = state.project.settings;
  $$('[data-setting]').forEach(el => {
    const value = settings[el.dataset.setting];
    if (el.classList.contains('segmented')) [...el.children].forEach(b => b.classList.toggle('active', b.dataset.value === String(value)));
    else if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
  });
  renderConditionalSettings();
}
function renderConditionalSettings() {
  const s = state.project.settings;
  show('#target-fields', s.describe && !s.teams); show('#team-fields', s.describe && s.teams);
  $('#model-settings summary span').textContent = `${s.model} · ${s.quantization === 'native' ? t('Native') : s.quantization.toUpperCase()}`;
}
function changeSetting(key, value) {
  if (state.busy) return;
  state.project.settings[key] = value; state.settingsDirty = true; renderConditionalSettings(); renderWorkflow();
  savedStatus('Saving settings…'); clearTimeout(settingTimer); settingTimer = setTimeout(() => flushSettings().catch(e => toast(e.message, true)), 550);
}
async function flushSettings() {
  clearTimeout(settingTimer);
  if (!state.settingsDirty || !state.project) return settingsChain;
  const project = state.project, settings = structuredClone(project.settings);
  state.settingsDirty = false;
  settingsChain = settingsChain.catch(() => {}).then(async () => {
    try {
      const updated = await api(`/api/projects/${project.id}/settings`, settings, 'PUT');
      if (state.project === project) {
        project.classes = updated.classes; project.stats = updated.stats;
        renderClasses(); renderStats();
        if (!state.settingsDirty) savedStatus();
      }
    } catch (e) {
      if (state.project === project) state.settingsDirty = true;
      savedStatus('Settings not saved', true); throw e;
    }
  });
  return settingsChain;
}
$$('.segmented').forEach(group => group.addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button || state.busy) return;
  [...group.children].forEach(b => b.classList.toggle('active', b === button));
  changeSetting(group.dataset.setting, button.dataset.value);
}));
$$('input[data-setting],select[data-setting],textarea[data-setting]').forEach(el => el.addEventListener('input', () => {
  changeSetting(el.dataset.setting, el.type === 'checkbox' ? el.checked : el.hasAttribute('data-number') ? Number(el.value) : el.value);
}));

async function loadGallery(autoOpen = false, preferredIndex = 0, allowDuringDelete = false) {
  if (state.deleting && !allowDuringDelete) return;
  const request = ++fetchCounter, pid = state.project.id;
  const params = new URLSearchParams({page: state.page, limit: 48, status: state.filter, search: state.search});
  const data = await get(`/api/projects/${pid}/images?${params}`);
  if (request !== fetchCounter || pid !== state.project.id) return;
  if (!data.items.length && state.page > 0) { state.page = Math.max(0,Math.ceil(data.total/48)-1); return loadGallery(autoOpen, 47, allowDuringDelete); }
  state.items = data.items; state.total = data.total;
  const el = $('#gallery'); el.replaceChildren();
  if (!data.items.length) { const empty = document.createElement('div'); empty.className = 'gallery-empty'; empty.textContent = t(state.search ? 'No matching images.' : 'Your images will appear here.'); el.append(empty); }
  for (const item of data.items) {
    const card = document.createElement('button'); card.className = 'image-card'; card.dataset.id = item.id;
    card.classList.toggle('active', state.editor?.item.id === item.id); card.title = `${item.name} · ${t(item.status)}${item.error ? '\n' + localizeMessage(item.error) : ''}`;
    const img = document.createElement('img'); img.src = `/api/images/${item.id}/thumbnail`; img.alt = ''; img.loading = 'lazy';
    img.draggable = false;
    const check = document.createElement('span'); check.className = 'card-select'; check.setAttribute('aria-hidden','true');
    const label = document.createElement('div'); label.className = 'card-label';
    const dot = document.createElement('i'); dot.className = `dot ${item.status}`;
    const name = document.createElement('span'); name.textContent = item.name;
    label.append(dot, name); card.append(img, label, check);
    if (item.boxes.length) { const count = document.createElement('span'); count.className = 'card-count'; count.textContent = item.boxes.length; card.append(count); }
    card.addEventListener('click', guarded(event => handleGalleryClick(event,item))); el.append(card);
  }
  const pageCount = Math.max(1, Math.ceil(data.total / 48));
  text('#page-info', `${t('{count} images', {count:data.total})}${data.total > 48 ? ` · ${state.page + 1}/${pageCount}` : ''}`);
  text('#library-title', {all: 'All images', pending: 'Pending', auto: 'Auto labeled', reviewed: 'Reviewed', error: 'Needs attention'}[state.filter]);
  $('#prev-page').disabled = state.page === 0; $('#next-page').disabled = (state.page + 1) * 48 >= data.total;
  renderNavigation();
  renderImageSelection();
  if ((autoOpen || !state.editor) && data.items.length) await openImage(data.items[Math.min(preferredIndex, data.items.length - 1)].id, false, allowDuringDelete);
}
async function openImage(id, keepImageSelection = false, allowDuringDelete = false) {
  if (state.deleting && !allowDuringDelete) return;
  if (state.editor?.item.id === id) return;
  await flushEditor(); const request = ++imageLoad;
  const item = await get(`/api/images/${id}`); const image = new Image();
  image.src = `/api/images/${id}/preview`;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Image could not be opened. Check the source path.')); });
  if (request !== imageLoad) return;
  state.editor = {item, image, boxes: structuredClone(item.boxes), revision: item.revision, dirty: false, saving: false, undo: [], redo: [], chain: Promise.resolve()};
  state.selected = -1; state.zoom = 1; state.pan = {x: 0, y: 0}; state.drag = null;
  if (!keepImageSelection) {
    state.imageSelection = new Map([[item.id,item.revision]]); state.imageSelectionFocus = true;
  }
  setTool(item.boxes.length ? 'select' : 'draw');
  $$('.image-card').forEach(card => card.classList.toggle('active', card.dataset.id === id));
  renderEditor();
  if (item.error) toast(item.error, true);
}
function renderEditor() {
  const ed = state.editor;
  show('#empty-stage', !ed); show('#image-meta', !!ed); show('#canvas-help', !!ed);
  $('#mark-reviewed').disabled = !ed || state.reviewing || state.deleting;
  $('#remove-image').disabled = !ed || state.reviewing || state.deleting || state.busy || state.uploading;
  $('#active-class').disabled = !ed;
  renderNavigation();
  if (ed) text('#image-meta', `${ed.item.name}  ·  ${ed.item.width} × ${ed.item.height}  ·  ${t(ed.item.status === 'auto' ? 'Auto labeled' : ed.item.status)}`);
  renderBoxList(); draw();
  setTool(state.tool);
  renderImageSelection();
}
function renderNavigation() {
  const index = state.items.findIndex(i => i.id === state.editor?.item.id);
  const position = index < 0 ? 0 : state.page * 48 + index + 1;
  text('#image-position', `${position} / ${state.total}`);
  $('#previous-image').disabled = !state.editor || index <= 0 && state.page === 0;
  $('#next-image').disabled = !state.editor || position >= state.total;
}
function viewTransform() {
  const ed = state.editor, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!ed) return {x: 0, y: 0, w: 1, h: 1};
  const fit = Math.min((w - 32) / ed.item.width, (h - 60) / ed.item.height);
  const iw = ed.item.width * fit * state.zoom, ih = ed.item.height * fit * state.zoom;
  return {x: (w - iw) / 2 + state.pan.x, y: (h - ih) / 2 + state.pan.y, w: iw, h: ih};
}
function draw() {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const ed = state.editor; if (!ed) return;
  const v = viewTransform(); ctx.drawImage(ed.image, v.x, v.y, v.w, v.h);
  for (let i = 0; i < ed.boxes.length; i++) {
    const b = ed.boxes[i], x = v.x + b.x1 * v.w, y = v.y + b.y1 * v.h, bw = (b.x2 - b.x1) * v.w, bh = (b.y2 - b.y1) * v.h;
    const color = COLORS[b.class_id % COLORS.length], selected = i === state.selected;
    ctx.fillStyle = color + (selected ? '22' : '0b'); ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = color; ctx.lineWidth = selected ? 2 : 1.2; ctx.strokeRect(x, y, bw, bh);
    const label = classLabel(state.project.classes[b.class_id] || 'target'); ctx.font = '11px "Segoe UI", "Microsoft JhengHei", sans-serif';
    const tw = ctx.measureText(label).width + 10, ty = Math.max(v.y, y - 17);
    ctx.fillStyle = color; ctx.fillRect(x, ty, tw, 17); ctx.fillStyle = '#101510'; ctx.fillText(label, x + 5, ty + 12);
    if (selected) for (const [hx, hy] of [[x, y], [x + bw, y], [x, y + bh], [x + bw, y + bh]]) { ctx.fillStyle = '#101510'; ctx.fillRect(hx - 3, hy - 3, 6, 6); ctx.strokeRect(hx - 3, hy - 3, 6, 6); }
  }
  if (state.drag?.kind === 'draw') {
    const {start, now} = state.drag; ctx.strokeStyle = COLORS[state.activeClass]; ctx.setLineDash([4, 3]);
    ctx.strokeRect(v.x + start.x * v.w, v.y + start.y * v.h, (now.x - start.x) * v.w, (now.y - start.y) * v.h); ctx.setLineDash([]);
  }
  $('#zoom-fit').textContent = state.zoom === 1 ? t('Fit') : `${Math.round(state.zoom * 100)}%`;
}
new ResizeObserver(draw).observe($('#stage'));
function point(event, clamp = true) {
  const rect = canvas.getBoundingClientRect(), v = viewTransform();
  const x = (event.clientX - rect.left - v.x) / v.w, y = (event.clientY - rect.top - v.y) / v.h;
  return clamp ? {x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y))} : {x, y};
}
function checkpoint() {
  const ed = state.editor; ed.undo.push(structuredClone(ed.boxes)); if (ed.undo.length > 80) ed.undo.shift(); ed.redo = [];
}
function changed() {
  const ed = state.editor; ed.dirty = true; savedStatus('Saving annotations…'); renderBoxList(); draw();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => flushEditor().catch(e => toast(e.message, true)), 450);
}
async function flushEditor(force = false) {
  clearTimeout(saveTimer); const ed = state.editor;
  if (!ed) return;
  // Serialize saves per image and take the latest snapshot when the queue runs.
  const run = async () => {
    if (!ed.dirty && !force) return;
    const boxes = structuredClone(ed.boxes); ed.dirty = false; ed.saving = true;
    try {
      const saved = await api(`/api/images/${ed.item.id}/annotations`, {boxes, revision: ed.revision}, 'PUT');
      ed.revision = saved.revision; ed.item = saved;
      if (state.imageSelection.has(saved.id)) state.imageSelection.set(saved.id,saved.revision);
      if (state.editor === ed) {
        if (!ed.dirty) savedStatus();
        renderEditor();
        const item = state.items.find(i => i.id === saved.id); if (item) Object.assign(item, saved);
        const card = $(`.image-card[data-id="${saved.id}"]`); if (card) { card.querySelector('.dot').className = 'dot reviewed'; }
      }
      await refreshStats();
    } catch (e) { ed.dirty = true; savedStatus('Save failed — edits retained', true); throw e; }
    finally { ed.saving = false; }
  };
  ed.chain = ed.chain.catch(() => {}).then(run); return ed.chain;
}
function renderBoxList() {
  const el = $('#box-list'), ed = state.editor; el.replaceChildren();
  text('#box-count', ed?.boxes.length || 0); $('#delete-box').disabled = !ed || state.selected < 0;
  $('#undo').disabled = !ed?.undo.length; $('#redo').disabled = !ed?.redo.length;
  if (!ed?.boxes.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = t(ed ? 'No boxes yet. Draw a box or run Auto label.' : 'Select an image to view its labels.'); el.append(p); return; }
  ed.boxes.forEach((box, i) => {
    const row = document.createElement('div'); row.className = 'box-row'; row.classList.toggle('selected', i === state.selected);
    const index = document.createElement('span'); index.className = 'box-index'; index.textContent = String(i + 1).padStart(2, '0');
    const swatch = document.createElement('i'); swatch.className = 'class-swatch'; swatch.style.color = COLORS[box.class_id];
    const select = document.createElement('select'); select.setAttribute('aria-label', t('Class of box {count}', {count:i+1}));
    select.disabled = state.project.classes.length === 1;
    state.project.classes.forEach((name, j) => select.add(new Option(classLabel(name), j))); select.value = box.class_id;
    select.addEventListener('change', () => { checkpoint(); box.class_id = Number(select.value); state.selected = i; changed(); });
    row.addEventListener('click', () => { state.selected = i; draw(); renderBoxList(); });
    select.addEventListener('click', e => e.stopPropagation()); row.append(index, swatch, select); el.append(row);
  });
}
function setTool(tool) { state.tool = tool; $('#tool-select').classList.toggle('active', tool === 'select'); $('#tool-draw').classList.toggle('active', tool === 'draw'); canvas.style.cursor = tool === 'draw' ? 'crosshair' : 'default'; text('#canvas-help', tool === 'draw' ? 'Drag to draw a box · Each change saves automatically' : 'Click a box to move it · Drag a corner to resize'); }
$('#tool-select').onclick = () => setTool('select'); $('#tool-draw').onclick = () => setTool('draw');
$('#active-class').onchange = e => { state.activeClass = Number(e.target.value); };
canvas.addEventListener('pointerdown', event => {
  if (!state.editor || state.deleting || (event.button !== 0 && event.button !== 1)) return;
  state.imageSelectionFocus = false;
  const ed = state.editor, p = point(event, false); canvas.setPointerCapture(event.pointerId);
  if (state.space || event.button === 1) { state.drag = {kind: 'pan', x: event.clientX, y: event.clientY, pan: {...state.pan}}; return; }
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
  if (state.tool === 'draw') { state.drag = {kind: 'draw', start: p, now: p}; draw(); return; }
  const v = viewTransform(), selected = ed.boxes[state.selected];
  if (selected) {
    for (const [kx, ky] of [['x1', 'y1'], ['x2', 'y1'], ['x1', 'y2'], ['x2', 'y2']]) {
      if (Math.abs((p.x - selected[kx]) * v.w) < 9 && Math.abs((p.y - selected[ky]) * v.h) < 9) {
        state.drag = {kind: 'resize', kx, ky, box: {...selected}, start: p, index: state.selected, before: structuredClone(ed.boxes)}; return;
      }
    }
  }
  let found = -1;
  for (let i = ed.boxes.length - 1; i >= 0; i--) { const b = ed.boxes[i]; if (p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2) { found = i; break; } }
  state.selected = found;
  if (found >= 0) state.drag = {kind: 'move', box: {...ed.boxes[found]}, start: p, index: found, before: structuredClone(ed.boxes)};
  renderBoxList(); draw();
});
canvas.addEventListener('pointermove', event => {
  const d = state.drag; if (!d) return;
  if (d.kind === 'pan') { state.pan = {x: d.pan.x + event.clientX - d.x, y: d.pan.y + event.clientY - d.y}; draw(); return; }
  const p = point(event); d.now = p;
  if (d.kind === 'move') {
    const b = d.box, dx = Math.max(-b.x1, Math.min(1 - b.x2, p.x - d.start.x)), dy = Math.max(-b.y1, Math.min(1 - b.y2, p.y - d.start.y));
    Object.assign(state.editor.boxes[d.index], {x1: b.x1 + dx, x2: b.x2 + dx, y1: b.y1 + dy, y2: b.y2 + dy});
  } else if (d.kind === 'resize') {
    const b = state.editor.boxes[d.index]; b[d.kx] = d.kx === 'x1' ? Math.min(p.x, b.x2 - 0.001) : Math.max(p.x, b.x1 + 0.001);
    b[d.ky] = d.ky === 'y1' ? Math.min(p.y, b.y2 - 0.001) : Math.max(p.y, b.y1 + 0.001);
  }
  draw();
});
function endPointer(event) {
  const d = state.drag; if (!d) return;
  if (d.kind === 'draw' && event.type !== 'pointercancel') {
    const p = point(event), v = viewTransform(), x1 = Math.min(p.x, d.start.x), y1 = Math.min(p.y, d.start.y), x2 = Math.max(p.x, d.start.x), y2 = Math.max(p.y, d.start.y);
    if ((x2 - x1) * v.w >= 3 && (y2 - y1) * v.h >= 3) { checkpoint(); state.editor.boxes.push({class_id: state.activeClass, x1, y1, x2, y2}); state.selected = state.editor.boxes.length - 1; changed(); }
  } else if (d.before) {
    if (event.type === 'pointercancel') state.editor.boxes = d.before;
    else if (JSON.stringify(d.before) !== JSON.stringify(state.editor.boxes)) { state.editor.undo.push(d.before); state.editor.redo = []; changed(); }
  }
  state.drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); draw();
}
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
function removeBox() { if (!state.editor || state.selected < 0) return; checkpoint(); state.editor.boxes.splice(state.selected, 1); state.selected = -1; changed(); }
function undo(redo = false) {
  const ed = state.editor; if (!ed) return; const source = redo ? ed.redo : ed.undo, dest = redo ? ed.undo : ed.redo;
  if (!source.length) return; dest.push(structuredClone(ed.boxes)); ed.boxes = source.pop(); state.selected = -1; changed();
}
$('#delete-box').onclick = removeBox; $('#undo').onclick = () => undo(); $('#redo').onclick = () => undo(true);
$('#manual-inspector').addEventListener('pointerdown', event => {
  if (!event.target.closest('#remove-image,#mark-reviewed')) state.imageSelectionFocus = false;
});
$('#mark-reviewed').onclick = guarded(async () => {
  if (state.reviewing) return;
  state.reviewing = true; $('#mark-reviewed').disabled = true;
  try {
    await flushEditor(true); const previous = state.editor.item.id;
    await navigate(1); await loadGallery();
    toast(state.editor.item.id === previous ? 'Reviewed and saved. You reached the last image.' : 'Reviewed and saved.');
  } finally { state.reviewing = false; $('#mark-reviewed').disabled = !state.editor; }
});
function zoom(factor) { state.zoom = Math.max(0.4, Math.min(8, state.zoom * factor)); draw(); }
$('#zoom-in').onclick = () => zoom(1.25); $('#zoom-out').onclick = () => zoom(0.8);
$('#zoom-fit').onclick = () => { state.zoom = 1; state.pan = {x: 0, y: 0}; draw(); };
canvas.addEventListener('wheel', event => { if (!state.editor) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); }, {passive: false});
async function navigate(direction) {
  const index = state.items.findIndex(i => i.id === state.editor?.item.id), next = index + direction;
  if (next >= 0 && next < state.items.length) await openImage(state.items[next].id);
  else if (direction > 0 && (state.page + 1) * 48 < state.total) { state.page++; await loadGallery(); await openImage(state.items[0].id); }
  else if (direction < 0 && state.page > 0) { state.page--; await loadGallery(); await openImage(state.items.at(-1).id); }
}
$('#previous-image').onclick = guarded(() => navigate(-1));
$('#next-image').onclick = guarded(() => navigate(1));
window.addEventListener('keydown', guarded(async event => {
  if (event.target.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (state.view !== 'label') return;
  if (state.deleting) { if (event.key === 'Backspace' || event.key === 'Delete') event.preventDefault(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && state.view === 'label') {
    event.preventDefault(); if (!event.repeat) await selectAllImages(); return;
  }
  if (event.code === 'Space') { event.preventDefault(); state.space = true; canvas.style.cursor = 'grab'; }
  if (event.key.toLowerCase() === 'b') setTool('draw'); if (event.key.toLowerCase() === 'v') setTool('select');
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    if (!event.repeat) { if (state.imageSelectionFocus && state.view === 'label') await removeSelectedImages(); else removeBox(); }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
    event.preventDefault(); if (event.key.toLowerCase() === 's') await flushEditor(); else undo(event.key.toLowerCase() === 'y' || event.shiftKey);
  }
  if (event.key === 'ArrowRight') { event.preventDefault(); await navigate(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); await navigate(-1); }
  if (event.key === 'Escape') { state.selected = -1; clearImageSelection(); renderBoxList(); draw(); }
  if (/^[1-4]$/.test(event.key) && Number(event.key) <= state.project.classes.length) { state.activeClass = Number(event.key) - 1; $('#active-class').value = state.activeClass; }
}));
window.addEventListener('keyup', event => { if (event.code === 'Space') { state.space = false; canvas.style.cursor = state.tool === 'draw' ? 'crosshair' : 'default'; } });
window.addEventListener('blur', () => { state.space = false; });
window.addEventListener('beforeunload', event => { if (state.editor?.dirty || state.editor?.saving || state.settingsDirty || state.uploading) { event.preventDefault(); event.returnValue = ''; } });

$('#project-select').addEventListener('change', guarded(async e => { try { await loadProject(e.target.value); } catch (err) { e.target.value = state.project.id; throw err; } }));
$$('#filters button').forEach(button => button.addEventListener('click', guarded(async () => {
  state.filter = button.dataset.filter; state.page = 0; clearImageSelection();
  $$('#filters button').forEach(b => b.classList.toggle('active', b === button)); await loadGallery();
})));
$('#search').oninput = () => { clearTimeout(searchTimer); clearImageSelection(); searchTimer = setTimeout(guarded(async () => { state.search = $('#search').value; state.page = 0; await loadGallery(); }), 250); };
$('#prev-page').onclick = guarded(async () => { if (state.page > 0) { state.page--; await loadGallery(); } });
$('#next-page').onclick = guarded(async () => { if ((state.page + 1) * 48 < state.total) { state.page++; await loadGallery(); } });
const importDialog = $('#import-dialog');
function showImport() { if (state.busy || state.uploading) { toast('Wait for the current job to finish.', true); return; } importDialog.showModal(); }
$('#import').onclick = showImport; $('#empty-import').onclick = showImport;
$$('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#choose-files').onclick = () => $('#file-input').click(); $('#choose-folder').onclick = () => $('#folder-input').click();
$('#import-path-button').onclick = guarded(async () => {
  const paths = $('#import-paths').value.split(/\r?\n/).map(p => p.trim()).filter(Boolean); if (!paths.length) throw new Error('Paste an image or folder path.');
  await importMediaPaths(paths);
});
async function uploadFiles(files) {
  if (state.busy || state.uploading) throw new Error('Wait for the current job to finish.');
  files = files.filter(f => EXT.test(f.name)); if (!files.length) throw new Error('No supported images found.');
  await flushSettings(); await flushEditor(); const pid = state.project.id;
  state.uploading = true; importDialog.close(); let added = 0, skipped = 0, messages = [];
  setBusy(true);
  try {
    for (let i = 0; i < files.length; i += 32) {
      state.uploadProgress = {done:i, total:files.length}; renderUploadProgress();
      const body = new FormData(); files.slice(i, i + 32).forEach(file => body.append('files', file, file.name));
      const result = await api(`/api/projects/${pid}/upload`, body); added += result.added; skipped += result.duplicates + result.errors;
      messages.push(...result.messages);
    }
    toast(() => t('{count} images imported{skipped}.', {count:added,skipped:skipped ? t(' · {count} duplicates or unsupported files skipped', {count:skipped}) : ''}));
    if (messages.length) { text('#activity-log', messages.join('\n')); show('#activity-panel', true); }
  } finally {
    state.uploading = false; state.uploadProgress = null; await refreshStats(); await loadGallery(); await poll();
    $('#file-input').value = ''; $('#folder-input').value = '';
  }
}
function renderUploadProgress() {
  if (state.videoUploadProgress) { renderVideoUploadProgress(); return; }
  const progress = state.uploadProgress;
  if (!progress) return;
  text('#job-title', t('Importing images · {done}/{total}', progress));
  text('#job-detail', 'Copying files into the local workspace');
  $('#progress-fill').style.width = `${100 * progress.done / progress.total}%`;
}
for (const selector of ['#file-input', '#folder-input']) $(selector).addEventListener('change', guarded(e => importMediaFiles([...e.target.files])));
let dragDepth = 0;
document.addEventListener('dragenter', e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); dragDepth++; show('#drop-overlay', true); });
document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', e => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) show('#drop-overlay', false); });
async function collectEntry(entry) {
  if (entry.isFile) return [await new Promise((resolve, reject) => entry.file(resolve, reject))];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader(), files = []; let chunk;
  do { chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); for (const child of chunk) files.push(...await collectEntry(child)); } while (chunk.length);
  return files;
}
document.addEventListener('drop', guarded(async e => {
  e.preventDefault(); dragDepth = 0; show('#drop-overlay', false);
  // Capture entries synchronously; browser drag data is unavailable after awaiting.
  const entries = [...(e.dataTransfer.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = [...e.dataTransfer.files]; let files = [];
  if (entries.length) for (const entry of entries) files.push(...await collectEntry(entry)); else files = fallback;
  await importMediaFiles(files);
}));

async function startJob(kind) {
  await flushEditor(); await flushSettings();
  await api(`/api/projects/${state.project.id}/${kind}`, kind === 'annotate' ? {} : undefined); await poll();
}
function openAutoSettings() { if (!state.busy && !state.uploading) { renderWorkflow(); $('#auto-dialog').showModal(); } }
$('#run-auto').onclick = openAutoSettings;
$('#auto-settings').onclick = openAutoSettings;
$('#start-auto').onclick = guarded(async () => {
  const s = state.project.settings;
  if (s.describe && (s.teams ? !s.teammate.trim() || !s.enemy.trim() : !s.target.trim())) {
    const field = s.teams ? (!s.teammate.trim() ? $('#teammate') : $('#enemy')) : $('#target');
    field.focus(); throw new Error(s.teams ? 'Describe both teammates and enemies.' : 'Describe what Axiom should find.');
  }
  await startJob('annotate'); $('#auto-dialog').close();
});
$('#performance-settings').append($('#model-info'));
const skipRow = $('[data-setting="skip_done"]').closest('label');
skipRow.querySelector('span').textContent = t('Only new images');
skipRow.nextElementSibling?.remove();
$('#settings-fields').insertBefore(skipRow, $('#model-settings'));
$('#settings-form').addEventListener('submit', e => e.preventDefault());
$('#load-model').onclick = guarded(() => startJob('model'));
$('#unload-model').onclick = guarded(async () => { await api('/api/model/unload'); await poll(); });
$('#export').onclick = guarded(() => startJob('export')); $('#start-training').onclick = guarded(() => startJob('train'));
$('#stop-job').onclick = guarded(async () => { await api('/api/job/stop'); await poll(); });
$('#activity-toggle').onclick = () => $('#activity-panel').classList.toggle('hidden'); $('#activity-close').onclick = () => show('#activity-panel', false);
$$('.tab').forEach(button => button.onclick = guarded(async () => {
  changeWorkspaceView(button.dataset.view);
  if (state.view === 'projects') {
    state.projects = await get('/api/projects'); populateProjectPicker(); renderProjectCards();
  }
}));
function setBusy(busy) {
  state.busy = busy;
  for (const id of ['settings-fields', 'train-fields']) $("#" + id).disabled = busy;
  for (const id of ['run-auto', 'load-model', 'unload-model', 'export', 'start-training', 'import']) $('#' + id).disabled = busy;
  renderStats();
}
async function poll() {
  if (state.uploading) return;
  const job = await get('/api/job'), wasActive = state.job.active; state.job = job;
  if (!state.project) return;
  renderJobStatus(job);
  const progressKey = `${job.id}:${job.completed}:${job.active}`;
  if (progressKey !== state.lastJob) {
    state.lastJob = progressKey; await refreshStats();
    if (job.project_id === state.project.id && ['import', 'annotation', 'video import'].includes(job.kind)) {
      await loadGallery();
      if (state.editor && !state.editor.dirty && !state.editor.saving && !state.drag) {
        const latest = await get(`/api/images/${state.editor.item.id}`);
        if (latest.revision !== state.editor.revision) { state.editor.item = latest; state.editor.boxes = structuredClone(latest.boxes); state.editor.revision = latest.revision; state.editor.undo = []; state.editor.redo = []; state.selected = -1; renderEditor(); }
      }
    }
    if (wasActive && !job.active && job.stage === 'error') toast(job.message, true);
  }
}
function renderJobStatus(job) {
  if (!job?.model_info) return;
  setBusy(job.active); show('#stop-job', job.active);
  $('#job-indicator').classList.toggle('busy', job.active); $('#job-indicator').classList.toggle('failed', job.stage === 'error');
  text('#job-title', job.message);
  const parts = [];
  if (job.total) parts.push(t(job.kind === 'training' ? '{done}/{total} epochs' : '{done}/{total} images', {done:job.completed,total:job.total}));
  if (job.elapsed) parts.push(formatTime(job.elapsed));
  if (job.rate) parts.push(t('{rate} img/s', {rate:job.rate.toFixed(2)}));
  if (job.active && job.eta != null) parts.push(t('ETA {time}', {time:formatTime(job.eta)}));
  if (job.errors) parts.push(t('{count} errors', {count:job.errors}));
  text('#job-detail', parts.join(' · ') || 'Import images to get started');
  const percent = job.total ? Math.min(100, Math.round(job.completed / job.total * 100)) : job.stage === 'complete' ? 100 : 0;
  $('#progress-fill').style.width = `${percent}%`; $('.job-progress').classList.toggle('indeterminate', job.active && (!job.total || job.stage === 'loading'));
  text('#job-percent', job.active && job.stage === 'loading' ? '…' : job.total || job.stage === 'complete' ? `${percent}%` : '—');
  const info = job.model_info; const modelEl = $('#model-info'); modelEl.querySelector('.dot').className = `dot ${info.loaded ? 'reviewed' : 'pending'}`;
  modelEl.querySelector('strong').textContent = t(info.name); modelEl.querySelector('small').textContent = info.loaded ? `${localizeMessage(info.mode)}${info.memory_mb ? ` · ${info.memory_mb} MB` : ''}` : t('Loaded on demand');
  show('#download-export', !!job.result?.url); if (job.result?.url) $('#download-export').href = job.result.url;
  show('#checkpoint', !!job.result?.checkpoint); if (job.result?.checkpoint) $('#checkpoint').href = job.result.checkpoint;
  if (job.logs.length) text('#activity-log', job.logs.map(l => `${l.time}  ${localizeMessage(l.message)}`).join('\n\n'));
  if (job.kind === 'training') {
    text('#train-epoch', `${job.completed} / ${job.total}`); const last = job.history.at(-1);
    if (last) { text('#train-loss', last.loss.toFixed(4)); const m = last['metrics/mAP50(B)']; text('#train-map', m == null ? '—' : (m * 100).toFixed(1) + '%'); }
    drawChart(job.history);
  }
}
function drawChart(history) {
  const el = $('#loss-chart'); if (!el.clientWidth || !el.clientHeight) return;
  const dpr = devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight; el.width = w * dpr; el.height = h * dpr;
  const c = el.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, w, h); show('#chart-empty', !history.length);
  const pad = {l: 36, r: 14, t: 12, b: 24}, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const max = history.length ? Math.max(...history.map(r => r.loss), 0.001) * 1.1 : 1;
  c.font = '9px Segoe UI'; c.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const y = pad.t + ph * i / 4; c.strokeStyle = '#272f37'; c.beginPath(); c.moveTo(pad.l, y); c.lineTo(w - pad.r, y); c.stroke(); c.fillStyle = '#63717f'; c.fillText((max * (1 - i / 4)).toFixed(2), pad.l - 7, y + 3); }
  if (!history.length) return;
  c.strokeStyle = '#b9f58a'; c.lineWidth = 2; c.beginPath();
  history.forEach((r, i) => { const x = pad.l + i / Math.max(1, history.length - 1) * pw, y = pad.t + (1 - r.loss / max) * ph; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  history.forEach((r, i) => { if (history.length > 80 && i % Math.ceil(history.length / 50)) return; const x = pad.l + i / Math.max(1, history.length - 1) * pw, y = pad.t + (1 - r.loss / max) * ph; c.fillStyle = '#b9f58a'; c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill(); });
  c.fillStyle = '#6e7c87'; c.textAlign = 'left'; c.fillText(t('Epoch {count}', {count:1}), pad.l, h - 4); c.textAlign = 'right'; c.fillText(t('Epoch {count}', {count:history.at(-1).epoch}), w - pad.r, h - 4);
}
document.addEventListener('axiom-language-change', () => {
  savedStatus(lastSaveMessage, lastSaveFailed);
  if (!$('#toast').classList.contains('hidden')) $('#toast').textContent = typeof lastToastMessage === 'function' ? lastToastMessage() : localizeMessage(lastToastMessage);
  skipRow.querySelector('span').textContent = t('Only new images');
  renderProjectCards();
  refreshVideoText();
  if ($('#project-dialog').open) {
    text('#project-dialog-title',projectEditId ? 'Rename project' : 'New project');
    text('#create-project',projectEditId ? 'Save name' : 'Create project');
  }
  if ($('#delete-project-dialog').open) {
    const project = state.projects.find(item => item.id === projectDeleteId);
    if (project) text('#delete-project-detail',t('This removes the project and its {count} images and labels. Original files are kept.',{count:project.stats.total}));
  }
  if (!state.projects.length) populateProjectPicker();
  if (!state.project) return;
  renderConditionalSettings(); renderStats(); renderClasses(); renderEditor();
  const pageCount = Math.max(1, Math.ceil(state.total / 48));
  text('#page-info', `${t('{count} images', {count:state.total})}${state.total > 48 ? ` · ${state.page+1}/${pageCount}` : ''}`);
  text('#library-title', {all:'All images',pending:'Pending',auto:'Auto labeled',reviewed:'Reviewed',error:'Needs attention'}[state.filter]);
  for (const card of $$('.image-card')) {
    const item = state.items.find(image => image.id === card.dataset.id);
    if (item) card.title = `${item.name} · ${t(item.status)}${item.error ? '\n' + localizeMessage(item.error) : ''}`;
  }
  const empty = $('#gallery .gallery-empty');
  if (empty) empty.textContent = t(state.search ? 'No matching images.' : 'Your images will appear here.');
  if (state.uploading) renderUploadProgress(); else renderJobStatus(state.job);
  drawChart(state.job.history || []);
});
new ResizeObserver(() => drawChart(state.job.history || [])).observe($('#loss-chart'));
initGallerySelection();
initProjects();
initVideoImport();
async function tick() { try { await poll(); } catch (e) { text('#job-title', 'Connection interrupted — reconnecting…'); } finally { pollTimer = setTimeout(tick, state.busy ? 1000 : 2500); } }
(async () => {
  try {
    await refreshProjects();
    const view = localStorage.getItem('axiom.view');
    if (['projects','label','train'].includes(view)) changeWorkspaceView(view);
    await tick();
  } catch (e) { toast(e.message, true); }
})();
