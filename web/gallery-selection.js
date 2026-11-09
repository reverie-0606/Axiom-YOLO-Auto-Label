'use strict';
let selectionRequest = 0, selectionAnchor = null, galleryMarquee = null, suppressGalleryClick = false;

function clearImageSelection() {
  ++selectionRequest; state.selectingImages = false;
  state.imageSelection.clear(); selectionAnchor = null;
  renderImageSelection();
}
function renderImageSelection() {
  const count = state.imageSelection.size;
  const blocked = state.busy || state.uploading || state.deleting || state.reviewing || state.selectingImages;
  for (const card of $$('.image-card')) {
    const chosen = state.imageSelection.has(card.dataset.id);
    card.classList.toggle('chosen', chosen); card.setAttribute('aria-pressed', String(chosen));
    const check = card.querySelector('.card-select'); if (check) check.textContent = chosen ? '✓' : '';
  }
  text('#selection-count', state.selectingImages ? 'Selecting images…' : count ? t('{count} selected', {count}) : 'Drag thumbnails to select · Ctrl+A all · Backspace remove');
  $('#select-all-images').disabled = !state.total || state.deleting || state.selectingImages;
  $('#clear-image-selection').disabled = !count || state.deleting;
  $('#remove-selected-images').disabled = !count || blocked;
  $('#remove-image').disabled = blocked || !(count || state.editor);
  text('#remove-image', count > 1 ? t('Remove {count} images', {count}) : 'Remove image');
}
async function selectAllImages() {
  if (!state.project || !state.total || state.deleting || state.selectingImages) return;
  const request = ++selectionRequest, pid = state.project.id;
  state.selectingImages = true; state.imageSelectionFocus = true; renderImageSelection();
  try {
    const params = new URLSearchParams({status:state.filter, search:state.search});
    const result = await get(`/api/projects/${pid}/selection?${params}`);
    if (request !== selectionRequest || state.project.id !== pid) return;
    state.imageSelection = new Map(result.items.map(item => [item.id,item.revision]));
    state.selected = -1; renderBoxList(); draw();
  } finally {
    if (request === selectionRequest) { state.selectingImages = false; renderImageSelection(); }
  }
}
async function handleGalleryClick(event, item) {
  if (state.deleting || state.selectingImages) return;
  ++selectionRequest; state.imageSelectionFocus = true;
  if (event.ctrlKey || event.metaKey || event.target.closest('.card-select')) {
    if (state.imageSelection.has(item.id)) state.imageSelection.delete(item.id);
    else state.imageSelection.set(item.id,item.revision);
    selectionAnchor = item.id; renderImageSelection(); return;
  }
  if (event.shiftKey && selectionAnchor) {
    const start = state.items.findIndex(image => image.id === selectionAnchor);
    const end = state.items.findIndex(image => image.id === item.id);
    if (start >= 0 && end >= 0) {
      for (const image of state.items.slice(Math.min(start,end),Math.max(start,end)+1)) state.imageSelection.set(image.id,image.revision);
    } else state.imageSelection.set(item.id,item.revision);
  } else {
    state.imageSelection = new Map([[item.id,item.revision]]); selectionAnchor = item.id;
  }
  renderImageSelection(); await openImage(item.id,true);
}
async function removeSelectedImages(allowCurrent = false) {
  if (state.deleting || state.busy || state.uploading || state.reviewing || state.selectingImages) return;
  const chosen = new Map(state.imageSelection);
  const editor = state.editor;
  if (!chosen.size && allowCurrent && editor) chosen.set(editor.item.id,editor.revision);
  if (!chosen.size) return;
  state.deleting = true; renderWorkflow(); renderImageSelection();
  const index = Math.max(0,state.items.findIndex(item => chosen.has(item.id)));
  try {
    await flushEditor();
    if (editor && chosen.has(editor.item.id)) chosen.set(editor.item.id,editor.revision);
    const images = [...chosen].map(([id,revision]) => ({id,revision}));
    const result = await api(`/api/projects/${state.project.id}/images/remove`, {images});
    ++imageLoad; ++fetchCounter;
    if (editor && chosen.has(editor.item.id)) {
      clearTimeout(saveTimer); state.editor = null; state.selected = -1; state.drag = null;
    }
    clearImageSelection();
    renderEditor(); await refreshStats(); await loadGallery(false,index,true);
    toast(() => t('{count} images removed. Original files kept.', {count:result.removed}));
  } finally {
    state.deleting = false; renderWorkflow(); renderEditor(); renderImageSelection();
  }
}
function finishGalleryMarquee(cancelled = false) {
  const drag = galleryMarquee; if (!drag) return;
  galleryMarquee = null; cancelAnimationFrame(drag.frame);
  if (drag.active) {
    suppressGalleryClick = true;
    setTimeout(() => { suppressGalleryClick = false; },0);
    if (cancelled) state.imageSelection = drag.base;
    drag.overlay?.remove();
    if ($('#gallery').hasPointerCapture(drag.pointerId)) $('#gallery').releasePointerCapture(drag.pointerId);
    renderImageSelection();
  }
}
function updateGalleryMarquee() {
  const drag = galleryMarquee; if (!drag?.active) return;
  const gallery = $('#gallery'), rect = gallery.getBoundingClientRect();
  const x = Math.max(0,Math.min(drag.width,drag.clientX - rect.left + gallery.scrollLeft));
  const y = Math.max(0,Math.min(drag.height,drag.clientY - rect.top + gallery.scrollTop));
  const left = Math.min(drag.x,x), top = Math.min(drag.y,y), right = Math.max(drag.x,x), bottom = Math.max(drag.y,y);
  Object.assign(drag.overlay.style,{left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
  const selected = drag.additive ? new Map(drag.base) : new Map();
  for (const card of drag.cards) if (card.right > left && card.left < right && card.bottom > top && card.top < bottom) selected.set(card.id,card.revision);
  state.imageSelection = selected; renderImageSelection();
  const speed = drag.clientY < rect.top+20 ? -12 : drag.clientY > rect.bottom-20 ? 12 : 0;
  if (speed) {
    const before = gallery.scrollTop; gallery.scrollTop += speed;
    if (gallery.scrollTop !== before) drag.frame = requestAnimationFrame(updateGalleryMarquee);
  }
}
function initGallerySelection() {
  const gallery = $('#gallery');
  $('#select-all-images').onclick = guarded(selectAllImages);
  $('#clear-image-selection').onclick = () => { state.imageSelectionFocus = true; clearImageSelection(); };
  $('#remove-selected-images').onclick = guarded(() => removeSelectedImages());
  $('#remove-image').onclick = guarded(() => removeSelectedImages(true));
  gallery.addEventListener('dragstart',event => event.preventDefault());
  gallery.addEventListener('click',event => {
    if (suppressGalleryClick) { suppressGalleryClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  },true);
  gallery.addEventListener('pointerdown',event => {
    if (event.button !== 0 || event.pointerType === 'touch' || state.deleting || state.busy || state.uploading || state.selectingImages) return;
    if (event.offsetX >= gallery.clientWidth && event.target === gallery) return; // scrollbar
    const rect = gallery.getBoundingClientRect();
    galleryMarquee = {pointerId:event.pointerId,x:event.clientX-rect.left+gallery.scrollLeft,y:event.clientY-rect.top+gallery.scrollTop,
      startX:event.clientX,startY:event.clientY,clientX:event.clientX,clientY:event.clientY,base:new Map(state.imageSelection),
      additive:event.ctrlKey || event.metaKey || event.shiftKey,active:false,cards:[]};
    state.imageSelectionFocus = true;
  });
  gallery.addEventListener('pointermove',event => {
    const drag = galleryMarquee; if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientX = event.clientX; drag.clientY = event.clientY;
    if (!drag.active && Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<5) return;
    if (!drag.active) {
      ++selectionRequest; drag.active = true; gallery.setPointerCapture(event.pointerId);
      const rect = gallery.getBoundingClientRect();
      drag.cards = $$('.image-card').map(card => {
        const box = card.getBoundingClientRect(), item = state.items.find(image => image.id === card.dataset.id);
        return {id:item.id,revision:item.revision,left:box.left-rect.left+gallery.scrollLeft,right:box.right-rect.left+gallery.scrollLeft,
          top:box.top-rect.top+gallery.scrollTop,bottom:box.bottom-rect.top+gallery.scrollTop};
      });
      drag.width = gallery.clientWidth; drag.height = gallery.scrollHeight;
      drag.overlay = document.createElement('div'); drag.overlay.className = 'gallery-marquee'; gallery.append(drag.overlay);
    }
    event.preventDefault(); cancelAnimationFrame(drag.frame); updateGalleryMarquee();
  });
  window.addEventListener('pointerup',() => finishGalleryMarquee());
  window.addEventListener('pointercancel',() => finishGalleryMarquee(true));
  window.addEventListener('blur',() => finishGalleryMarquee(true));
  window.addEventListener('keydown',event => { if (event.key === 'Escape') finishGalleryMarquee(true); },true);
}
