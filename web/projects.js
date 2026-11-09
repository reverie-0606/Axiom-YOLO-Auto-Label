'use strict';
let projectEditId = null, projectDeleteId = null;

function changeWorkspaceView(view) {
  if (view !== 'projects' && !state.project) view = 'projects';
  state.view = view;
  localStorage.setItem('axiom.view',view);
  for (const button of $$('.tab')) button.classList.toggle('active',button.dataset.view === view);
  show('#projects-view',view === 'projects'); show('#label-view',view === 'label'); show('#train-view',view === 'train');
  show('#manual-inspector',view === 'label'); show('#training-settings',view === 'train');
  $('.workspace').classList.toggle('projects-workspace',view === 'projects');
  show('#export',view !== 'projects'); show('#save-status',view !== 'projects');
  renderWorkflow(); renderProjectCards();
  if (view === 'train') drawChart(state.job.history || []); else if (view === 'label') draw();
}
function renderProjectAvailability() {
  const locked = state.projectActionPending || state.deleting || state.uploading || state.videoImportOpen;
  $('#project-select').disabled = locked || !state.projects.length;
  $('#new-project').disabled = locked; $('#new-project-section').disabled = locked;
  $('#empty-new-project').disabled = locked;
  for (const button of $$('.tab')) button.disabled = locked || button.dataset.view !== 'projects' && !state.project;
  for (const button of $$('.project-open,.project-rename,.project-delete')) {
    button.disabled = locked || button.classList.contains('project-delete') && state.job.active && state.job.project_id === button.dataset.id;
  }
}
function renderProjectCards() {
  const list = $('#project-list'); list.replaceChildren();
  show('#projects-empty',!state.projects.length);
  text('#project-count',t('{count} projects',{count:state.projects.length}));
  for (const project of state.projects) {
    const stats = project.stats || {total:0,reviewed:0};
    const card = document.createElement('article'); card.className = 'project-card'; card.dataset.id = project.id;
    card.classList.toggle('current',state.project?.id === project.id);
    const open = document.createElement('button'); open.className = 'project-open'; open.dataset.id = project.id;
    const top = document.createElement('div'); top.className = 'project-card-top';
    const symbol = document.createElement('span'); symbol.className = 'project-symbol'; symbol.textContent = '▦';
    const badge = document.createElement('span'); badge.className = 'project-current'; badge.textContent = state.project?.id === project.id ? t('Current project') : '';
    top.append(symbol,badge);
    const title = document.createElement('h2'); title.textContent = project.name; title.title = project.name;
    const counts = document.createElement('p'); counts.className = 'project-card-counts';
    counts.textContent = t(stats.total === 1 ? '{count} image' : '{count} images',{count:stats.total}) + ' · ' + t('{count} reviewed',{count:stats.reviewed});
    const enter = document.createElement('span'); enter.className = 'project-enter'; enter.textContent = t('Open project →');
    open.append(top,title,counts,enter);
    open.onclick = guarded(async () => {
      if (state.projectActionPending) return;
      state.projectActionPending = true; renderProjectAvailability();
      try { await loadProject(project.id); changeWorkspaceView('label'); }
      finally { state.projectActionPending = false; renderWorkflow(); }
    });
    const actions = document.createElement('div'); actions.className = 'project-card-actions';
    const rename = document.createElement('button'); rename.className = 'project-rename'; rename.dataset.id = project.id;
    rename.textContent = t('Rename'); rename.setAttribute('aria-label',t('Rename project: {name}',{name:project.name}));
    rename.onclick = () => openProjectEditor(project);
    const remove = document.createElement('button'); remove.className = 'project-delete'; remove.dataset.id = project.id;
    remove.textContent = t('Delete'); remove.setAttribute('aria-label',t('Delete project: {name}',{name:project.name}));
    remove.onclick = () => {
      projectDeleteId = project.id; $('#delete-project-name').textContent = project.name;
      text('#delete-project-detail',t('This removes the project and its {count} images and labels. Original files are kept.',{count:stats.total}));
      $('#delete-project-dialog').showModal();
    };
    actions.append(rename,remove); card.append(open,actions); list.append(card);
  }
  renderProjectAvailability();
}
function populateProjectPicker() {
  const select = $('#project-select'); select.replaceChildren();
  if (!state.projects.length) select.add(new Option(t('No project selected'),''));
  for (const project of state.projects) select.add(new Option(project.name,project.id));
  if (state.project) select.value = state.project.id;
}
function showNoProjects() {
  clearTimeout(saveTimer); clearTimeout(settingTimer); ++imageLoad; ++fetchCounter;
  state.project = state.editor = null; state.items = []; state.total = 0; state.page = 0;
  state.selected = -1; state.settingsDirty = false; clearImageSelection();
  localStorage.removeItem('axiom.project'); populateProjectPicker();
  $('#gallery').replaceChildren(); $('#active-class').replaceChildren(); $('#class-legend').replaceChildren();
  for (const id of ['dataset-count','count-all','count-pending','count-auto','count-reviewed','count-error','class-count']) text('#'+id,'0');
  renderEditor(); changeWorkspaceView('projects');
}
function openProjectEditor(project = null) {
  if (state.projectActionPending || state.deleting || state.uploading) return;
  projectEditId = project?.id || null;
  text('#project-dialog-title',project ? 'Rename project' : 'New project');
  text('#create-project',project ? 'Save name' : 'Create project');
  $('#project-name').value = project?.name || ''; $('#project-dialog').showModal(); $('#project-name').focus();
  if (project) $('#project-name').select();
}
function initProjects() {
  $('#new-project').onclick = () => openProjectEditor();
  $('#new-project-section').onclick = () => openProjectEditor();
  $('#empty-new-project').onclick = () => openProjectEditor();
  $('#project-form').onsubmit = guarded(async event => {
    event.preventDefault();
    if (state.projectActionPending) return;
    const name = $('#project-name').value.trim(); if (!name) throw new Error('Enter a project name.');
    state.projectActionPending = true; $('#create-project').disabled = true; renderProjectAvailability();
    try {
      await flushEditor(); await flushSettings();
      if (projectEditId) {
        const renamed = await api(`/api/projects/${projectEditId}`,{name},'PATCH');
        if (state.project?.id === renamed.id) state.project.name = renamed.name;
        state.projects = await get('/api/projects'); populateProjectPicker(); renderProjectCards();
        toast('Project renamed.');
      } else {
        const created = await api('/api/projects',{name});
        await refreshProjects(created.id); changeWorkspaceView('label'); toast('Project created.');
      }
      $('#project-dialog').close();
    } finally {
      state.projectActionPending = false; $('#create-project').disabled = false; renderWorkflow();
    }
  });
  $('#confirm-delete-project').onclick = guarded(async () => {
    if (!projectDeleteId || state.projectActionPending) return;
    state.projectActionPending = true; $('#confirm-delete-project').disabled = true; renderProjectAvailability();
    try {
      await flushEditor(); await flushSettings();
      await api(`/api/projects/${projectDeleteId}`,undefined,'DELETE');
      const wasCurrent = state.project?.id === projectDeleteId;
      if (wasCurrent) {
        state.project = state.editor = null; state.settingsDirty = false;
        clearTimeout(saveTimer); clearTimeout(settingTimer); ++imageLoad; ++fetchCounter;
        await refreshProjects();
      } else {
        state.projects = await get('/api/projects'); populateProjectPicker(); renderProjectCards();
      }
      $('#delete-project-dialog').close(); changeWorkspaceView('projects'); toast('Project deleted. Original files kept.');
      projectDeleteId = null;
    } finally {
      state.projectActionPending = false; $('#confirm-delete-project').disabled = false; renderWorkflow();
    }
  });
}
