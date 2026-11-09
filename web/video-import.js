'use strict';
const VIDEO_FILE = /\.(mp4|mkv|mov|avi|webm|m4v|wmv|flv|ts|mts|m2ts|mpg|mpeg|ogv|3gp)$/i;
let videoQueue = [], videoSession = null, videoQueueProject = null, expectedVideoCloses = 0;

function formatVideoTime(seconds) {
  const value = Math.floor(Math.max(0,seconds)*1000)/1000;
  const whole = Math.floor(value), fraction = (value-whole).toFixed(3).slice(1).replace(/0+$/,'').replace(/\.$/,'');
  const end = String(whole%60).padStart(2,'0') + fraction;
  return whole >= 3600 ? `${Math.floor(whole/3600)}:${String(Math.floor(whole%3600/60)).padStart(2,'0')}:${end}` : `${Math.floor(whole/60)}:${end}`;
}
function parseVideoTime(raw) {
  const value = raw.trim().replace(',','.');
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)*60;
  const parts = value.split(':');
  if (![2,3].includes(parts.length) || !parts.every(v => /^\d+(?:\.\d+)?$/.test(v))) return NaN;
  const nums = parts.map(Number);
  if (nums.at(-1)>=60 || nums.slice(0,-1).some(v => !Number.isInteger(v)) || parts.length===3 && nums[1]>=60) return NaN;
  return parts.length===2 ? nums[0]*60+nums[1] : nums[0]*3600+nums[1]*60+nums[2];
}
function videoPlan() {
  const start = parseVideoTime($('#video-start').value), end = parseVideoTime($('#video-end').value), interval = Number($('#video-interval').value);
  const duration = videoSession?.metadata?.duration;
  if (![start,end,interval].every(Number.isFinite)) return {error:'Enter valid video start, end and interval values.'};
  if (interval<.05 || interval>86400) return {error:'The frame interval must be between 0.05 and 86400 seconds.'};
  if (start<0 || end<=start || start>=duration || end>duration+.02) return {error:'The clip must start before its end and stay within the video duration.'};
  const count = Math.max(1,Math.ceil((Math.min(end,duration)-start)/interval-1e-9));
  if (count>50000) return {error:'This clip would produce more than 50,000 images. Increase the interval or shorten the clip.'};
  return {start,end:Math.min(end,duration),interval,count};
}
function refreshVideoText() {
  const session = videoSession; if (!session) return;
  $('#video-name').textContent = session.name;
  text('#video-project',t('Frames will be added to {name}.',{name:session.projectName}));
  if (session.metadata) text('#video-meta',`${formatVideoTime(session.metadata.duration)} · ${session.metadata.width} × ${session.metadata.height}`);
  else text('#video-meta','Reading video metadata…');
  const pending = session.pending || session.uploading || session.starting;
  $('#video-fields').disabled = !!pending;
  for (const button of $$('#video-dialog [data-close]')) button.disabled = !!session.starting;
  const plan = session.metadata ? videoPlan() : {error:''};
  text('#video-estimate',plan.count ? t('{count} images will be extracted',{count:plan.count}) : '');
  text('#video-range-error',plan.error || '');
  $('#video-extract').disabled = !!pending || !plan.count || state.busy;
  text('#video-extract',plan.count ? t('Import {count} frames',{count:plan.count}) : 'Import frames');
  if (state.videoUploadProgress) renderVideoUploadProgress();
  else text('#video-status',session.pending ? 'Reading video metadata…' : '');
}
function renderVideoUploadProgress() {
  const progress = state.videoUploadProgress; if (!progress) return;
  const value = t('Uploading video · {percent}%',{percent:progress.percent});
  text('#video-status',value); text('#job-title',value); $('#job-detail').textContent = progress.name;
  $('#progress-fill').style.width = `${progress.percent}%`; text('#job-percent',`${progress.percent}%`);
}
function uploadVideoFile(session) {
  return new Promise((resolve,reject) => {
    const xhr = new XMLHttpRequest(); session.xhr = xhr; session.uploading = true;
    state.uploading = true; state.videoUploadProgress = {percent:0,name:session.name};
    renderWorkflow(); refreshVideoText();
    xhr.open('POST',`/api/projects/${session.pid}/videos/upload`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) { state.videoUploadProgress = {percent:Math.round(event.loaded/event.total*100),name:session.name}; renderVideoUploadProgress(); }
    };
    xhr.onload = () => {
      let data; try { data=JSON.parse(xhr.responseText); } catch (_) { data={}; }
      if (xhr.status>=200 && xhr.status<300) resolve(data);
      else reject(new Error(typeof data.detail==='string' ? data.detail : `Request failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Video upload failed. Please try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled','AbortError'));
    const form = new FormData(); form.append('file',session.file,session.file.name); xhr.send(form);
  }).finally(() => {
    session.uploading = false; session.xhr = null; state.uploading = false; state.videoUploadProgress = null;
    renderWorkflow(); if (videoSession===session) refreshVideoText();
  });
}
function readLocalVideo(session) {
  return new Promise(resolve => {
    const preview = $('#video-preview');
    let done=false;
    const finish = value => {
      if (done) return; done=true; clearTimeout(timer);
      preview.removeEventListener('loadedmetadata',loaded); preview.removeEventListener('error',failed); resolve(value);
    };
    const loaded = () => finish(Number.isFinite(preview.duration) && preview.duration>0 && preview.videoWidth>0 ?
      {duration:preview.duration,width:preview.videoWidth,height:preview.videoHeight} : null);
    const failed = () => finish(null);
    const timer = setTimeout(() => finish(null),3000);
    preview.addEventListener('loadedmetadata',loaded); preview.addEventListener('error',failed);
    session.objectURL = URL.createObjectURL(session.file); preview.src = session.objectURL;
  });
}
function releaseVideoPreview(session) {
  $('#video-preview').pause(); $('#video-preview').removeAttribute('src'); $('#video-preview').load();
  if (session?.objectURL) { URL.revokeObjectURL(session.objectURL); session.objectURL=null; }
}
function cancelVideoQueue() {
  videoQueue=[];
  if (videoSession) { videoSession.cancelled=true; videoSession.xhr?.abort(); releaseVideoPreview(videoSession); }
  videoSession=null;
  state.videoImportOpen=false; renderWorkflow();
}
async function openNextVideo() {
  if (!videoQueue.length) { videoSession=null; return; }
  if (state.project?.id!==videoQueueProject) { videoQueue=[]; throw new Error('Open the original project before importing the remaining videos.'); }
  const source = videoQueue.shift();
  const session = {pid:state.project.id,projectName:state.project.name,file:source.file,path:source.path,
    name:source.file?.name || source.path.split(/[\\/]/).at(-1).replaceAll('"',''),pending:true};
  videoSession=session; state.videoImportOpen=true; renderWorkflow();
  $('#video-start').value='0:00'; $('#video-end').value='';
  const saved=Number(localStorage.getItem('axiom.video.interval'));
  $('#video-interval').value=Number.isFinite(saved) && saved>=.05 && saved<=86400 ? saved : 1;
  show('#video-preview-hint',false); refreshVideoText(); $('#video-dialog').showModal();
  try {
    if (session.file) {
      session.metadata=await readLocalVideo(session);
      if (session.cancelled) return;
      if (!session.metadata) {
        show('#video-preview-hint',true);
        session.metadata=await uploadVideoFile(session);
      }
    } else {
      session.metadata=await api(`/api/projects/${session.pid}/videos/probe`,{path:session.path});
      if (!session.cancelled) $('#video-preview').src=`/api/videos/${session.metadata.id}/preview`;
    }
    if (session.cancelled) return;
    $('#video-end').value=formatVideoTime(session.metadata.duration);
    session.pending=false; refreshVideoText();
  } catch (error) {
    if (!session.cancelled) { session.pending=false; refreshVideoText(); toast(error.message,true); }
  }
}
async function waitForMediaJob(id) {
  for (;;) {
    const job=await get('/api/job');
    if (job.id!==id || !job.active) return job;
    await new Promise(resolve => setTimeout(resolve,400));
  }
}
async function importMediaFiles(files) {
  if (!state.project) throw new Error('Create or open a project before importing media.');
  if (state.busy || state.uploading || state.videoImportOpen || videoSession?.started) throw new Error('Wait for the current job to finish.');
  const images=files.filter(file => EXT.test(file.name));
  const videos=files.filter(file => VIDEO_FILE.test(file.name));
  if (!images.length && !videos.length) throw new Error('No supported images or videos found.');
  const pid=state.project.id;
  if (images.length) await uploadFiles(images);
  if (state.project?.id!==pid) throw new Error('Open the original project before importing the remaining videos.');
  if (videos.length) { videoQueueProject=pid; videoQueue=videos.map(file => ({file})); await openNextVideo(); }
}
async function importMediaPaths(paths) {
  if (!state.project) throw new Error('Create or open a project before importing media.');
  const pid=state.project.id, videos=paths.filter(path => VIDEO_FILE.test(path.replaceAll('"',''))), images=paths.filter(path => !videos.includes(path));
  await flushSettings(); await flushEditor();
  $('#import-dialog').close();
  if (images.length) {
    const job=await api(`/api/projects/${pid}/import`,{paths:images}); await poll();
    if (videos.length) { const result=await waitForMediaJob(job.id); if (result.stage==='error' || result.stage==='cancelled') return; }
  }
  if (videos.length) {
    if (state.project?.id!==pid) throw new Error('Open the original project before importing the remaining videos.');
    videoQueueProject=pid; videoQueue=videos.map(path => ({path})); await openNextVideo();
  }
}
function initVideoImport() {
  $('#choose-video').onclick=() => $('#video-input').click();
  $('#video-input').onchange=guarded(async event => { const files=[...event.target.files]; event.target.value=''; await importMediaFiles(files); });
  for (const input of $$('#video-fields input')) input.addEventListener('input',refreshVideoText);
  $('#video-start').addEventListener('change',() => {
    const value=parseVideoTime($('#video-start').value);
    if (Number.isFinite(value) && value>=0 && value<videoSession?.metadata?.duration) $('#video-preview').currentTime=value;
  });
  $('#video-set-start').onclick=() => { $('#video-start').value=formatVideoTime($('#video-preview').currentTime||0); refreshVideoText(); };
  $('#video-set-end').onclick=() => { $('#video-end').value=formatVideoTime($('#video-preview').currentTime||0); refreshVideoText(); };
  $('#video-preview').addEventListener('error',() => { if (videoSession && !videoSession.cancelled) show('#video-preview-hint',true); });
  $('#video-dialog').addEventListener('cancel',event => { if (videoSession?.starting) event.preventDefault(); });
  $('#video-dialog').addEventListener('close',() => {
    if (expectedVideoCloses) expectedVideoCloses--;
    else cancelVideoQueue();
    $('#video-input').value=''; $('#folder-input').value='';
  });
  $('#video-extract').onclick=guarded(async () => {
    const session=videoSession; if (!session || session.pending || session.uploading || session.starting) return;
    let plan=videoPlan(); if (plan.error) throw new Error(plan.error);
    try {
      if (!session.metadata.id) {
        const previousDuration=session.metadata.duration;
        session.metadata=await uploadVideoFile(session);
        if (session.cancelled) return;
        if (Math.abs(plan.end-previousDuration)<.02) $('#video-end').value=formatVideoTime(session.metadata.duration);
        plan=videoPlan(); if (plan.error) throw new Error(plan.error);
      }
      session.starting=true; refreshVideoText();
      await flushEditor(); await flushSettings();
      const job=await api(`/api/projects/${session.pid}/videos/extract`,{video_id:session.metadata.id,start:plan.start,end:plan.end,interval:plan.interval});
      localStorage.setItem('axiom.video.interval',String(plan.interval));
      session.started=true; session.starting=false; state.videoImportOpen=false;
      expectedVideoCloses++; $('#video-dialog').close(); releaseVideoPreview(session); changeWorkspaceView('label'); await poll();
      const result=await waitForMediaJob(job.id);
      await poll();
      session.started=false; videoSession=null;
      if (result.stage==='error' || result.stage==='cancelled') { videoQueue=[]; return; }
      if (videoQueue.length) await openNextVideo();
    } catch (error) {
      if (!session.cancelled && error.name!=='AbortError') throw error;
    } finally {
      session.starting=false;
      if (videoSession===session && !session.cancelled) refreshVideoText();
      renderWorkflow();
    }
  });
}
