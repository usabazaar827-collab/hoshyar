'use strict';

const API_ROOT = '/api'; // Secure server-side proxy will be added before enabling live AI.
const PATHS = Object.freeze({
  save: '/hoshyar/lecture/segment',
  ask: '/hoshyar/lecture/ask',
  transcribe: '/hoshyar/voice/transcribe',
  speak: '/hoshyar/voice/speak'
});
const $ = id => document.getElementById(id);
const state = {
  mode: 'demo',
  sessionId: `classroom-${((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 30)}`,
  segments: [],
  lastAnswer: '',
  busy: false,
  recorder: null,
  stream: null,
  recordingType: null,
  startedAt: 0,
  timer: null,
  autoStop: null,
  currentAudio: null,
  currentAudioUrl: null,
  recorderPurpose: null
};

function value(id) { return $(id).value.trim(); }
function selected(id) { return $(id).value; }
function isoTime() { return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function looksSorani(text) { return /[\u0600-\u06ff]/.test(text); }
function isLive() { return state.mode === 'live'; }
function elapsed(ms) { const sec=Math.floor(ms/1000);return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }
let toastTimer;
function toast(message, error=false) {
  const box=$('toast');
  box.textContent=message; box.classList.toggle('error',error); box.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>box.classList.remove('show'),4700);
}
function setMode(next) {
  if (state.recorder?.state === 'recording') return toast('Stop the recording before switching modes.', true);
  if (next === 'live') return toast('Live AI is disabled in this public preview until authentication and the secure backend are ready.', true);
  state.mode=next;
  $('demoMode').classList.toggle('is-active', next==='demo');
  $('liveMode').classList.toggle('is-active', next==='live');
  $('demoMode').setAttribute('aria-pressed',String(next==='demo'));
  $('liveMode').setAttribute('aria-pressed',String(next==='live'));
  $('headerStatus').textContent=next==='demo'?'Interactive preview':'n8n live API mode';
  document.querySelector('.connection-dot').style.background=next==='demo'?'#57e3c3':'#e9ba65';
  toast(next==='demo'?'Demo mode: no AI requests or charges.':'Live mode: requires secure, published n8n endpoints.');
}

function validLectureId() {
  const id=value('lectureId');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error('Use 1–64 letters, numbers, dashes or underscores for the lecture ID.');
  }
  return id;
}
function makeForm(fields) {
  const f=new FormData();
  Object.entries(fields).forEach(([key,val])=>{ if(val !== undefined && val !== null) f.append(key,String(val)); });
  return f;
}
async function apiRequest(path, form, responseKind='json') {
  const controller=new AbortController();
  const watchdog=setTimeout(()=>controller.abort(),90000);
  try {
    const response=await fetch(API_ROOT+path,{method:'POST',body:form,signal:controller.signal});
    if(!response.ok) {
      let detail='';
      try { detail=(await response.text()).slice(0,240); } catch (_) {}
      if(response.status===404) throw new Error('This n8n webhook is not active yet. Publish the secured workflow first.');
      throw new Error(`n8n returned HTTP ${response.status}.${detail?' '+detail:''}`);
    }
    if(responseKind==='blob') return response.blob();
    const data=await response.json();
    if(data.ok === false) throw new Error(data.error || 'The workflow could not process that request.');
    return data;
  } catch (err) {
    if(err.name==='AbortError') throw new Error('The request took too long. Try a shorter clip.');
    if(err instanceof TypeError) throw new Error('Could not reach n8n. Check that the workflows are published and CORS allows this website.');
    throw err;
  } finally { clearTimeout(watchdog); }
}
function setBusy(b) {
  state.busy=b;
  $('saveNoteBtn').disabled=b;
  $('askButton').disabled=b;
  $('studentMic').disabled=b;
  $('teacherMic').disabled=b;
  $('speakBtn').disabled=b||!state.lastAnswer;
}
function readNotes(id) {
  try { const all=JSON.parse(sessionStorage.getItem('hoshyar-demo-notes')||'{}'); return Array.isArray(all[id])?all[id]:[]; } catch { return []; }
}
function saveStoredNotes() {
  try { const all=JSON.parse(sessionStorage.getItem('hoshyar-demo-notes')||'{}'); all[validLectureId()]=state.segments; sessionStorage.setItem('hoshyar-demo-notes',JSON.stringify(all)); } catch { toast('Unable to save browser notes; they may not survive a refresh.',true); }
}
function appendNote(text, fromVoice=false, restoring=false) {
  const note={text, time:isoTime(),fromVoice};
  state.segments.push(note);
  if(!isLive() && !restoring) saveStoredNotes();
  const list=$('savedNotes');
  if(state.segments.length===1) list.replaceChildren();
  const article=document.createElement('div'); article.className='note-item';
  const meta=document.createElement('small');meta.textContent=`${note.time}  ·  ${fromVoice?'Teacher recording':'Teacher notes'}`;
  const para=document.createElement('p');para.textContent=text;
  article.append(meta,para);list.prepend(article);
  $('segmentCount').textContent=`${state.segments.length} segment${state.segments.length===1?'':'s'}`;
}
async function saveNotes() {
  const text=value('lectureText');
  if(!text) return toast('Paste or type your teacher’s explanation first.',true);
  if(text.length>2500) return toast('A note must be 2,500 characters or less. Please split it.',true);
  try {
    const id=validLectureId();setBusy(true);
    if(isLive()) {
      await apiRequest(PATHS.save,makeForm({text,lectureId:id,sessionId:state.sessionId,speaker:'teacher',language:selected('listenLanguage')}));
    }
    appendNote(text);
    $('lectureText').value='';
    toast(isLive()?'Saved to Hoshyar lecture memory.':'Demo note added. It stays only in this browser session.');
  } catch(e){toast(e.message,true);} finally{setBusy(false);}
}
function addChat(text,role) {
  const msg=document.createElement('div');msg.className=`message ${role}${looksSorani(text)?' rtl':''}`;
  const by=document.createElement('div');by.className='who';by.textContent=role==='user'?'YOU':'HOSHYAR AI';
  const body=document.createElement('div');body.textContent=text;
  msg.append(by,body);$('conversation').append(msg);$('conversation').scrollTop=$('conversation').scrollHeight;
}
function sampleAnswer(question) {
  const transcript=state.segments.map(s=>s.text).join(' ');
  const lower=question.toLowerCase();
  const sorani=selected('replyLanguage')==='ku'||(selected('replyLanguage')==='auto'&&looksSorani(question));
  if(sorani) {
    return transcript
      ?`ئەمە وەڵامێکی نموونەییە (Demo)، نەک Gemini.\n\nمامۆستاکەت ئەم بابەتەی باس کردووە:\n«${transcript.slice(0,220)}»\n\nبۆ وەڵامی ڕاستەقینە و وردەکاری زیاتر، پێویستە وۆرکفلۆکانی n8n بە شێوەیەکی پارێزراو کارا بکرێن.`
      :'ئەمە تەنها دیمۆیە. یەکەم جار تێبینییەکانی مامۆستات زیاد بکە، پاشان پرسیار بکە. وەڵامی ڕاستەقینە پێویستی بە Gemini هەیە.';
  }
  if(!transcript) return 'DEMO EXAMPLE (not Gemini):\n\nI haven’t received any teacher notes yet. Try adding a lesson in the left panel, then ask your question again. In Live n8n mode, Gemini can answer from your saved lecture.';
  if((/ohm|voltage|current|resistance/i.test(lower)) && /ohm|voltage|current|resistance/i.test(transcript)) {
    return `DEMO EXAMPLE (not Gemini):\n\nThe teacher's notes mention: “${transcript.slice(0,180)}”\n\nHere is a simple explanation:\nVoltage is like the push that moves water. Current is how much flows. Resistance makes that flow harder.\n\nOhm’s Law: V = I × R.\n\nWhen Live mode is enabled, Gemini will generate the actual explanation using your lecture.`;
  }
  return `DEMO EXAMPLE (not Gemini):\n\nI found this in your teacher's notes:\n“${transcript.slice(0,280)}”\n\nStart by finding the main idea, then think of one everyday example. Ask “why” and “how” until each step makes sense.\n\nThis is a sample preview; Gemini will generate the real answer when Live mode is securely enabled.`;
}
async function askQuestion(event) {
  event?.preventDefault();
  const question=value('questionInput');
  if(!question) return toast('Please enter or record a question first.',true);
  if(question.length>1800) return toast('Please shorten your question to 1,800 characters.',true);
  try {
    const id=validLectureId();setBusy(true);
    addChat(question,'user');$('questionInput').value='';
    let answer;
    if(isLive()) {
      const result=await apiRequest(PATHS.ask,makeForm({lectureId:id,sessionId:state.sessionId,question,questionLanguage:selected('questionLanguage'),replyLanguage:selected('replyLanguage')}));
      answer=result.answer;
      if(typeof answer!=='string'||!answer.trim()) throw new Error('Gemini did not return an answer.');
    } else answer=sampleAnswer(question);
    state.lastAnswer=answer;
    addChat(answer,'assistant');
    $('speakBtn').disabled=false;
  } catch(e){addChat('Unable to answer: '+e.message,'assistant');toast(e.message,true);} finally{setBusy(false);}
}
async function playAnswer() {
  if(!state.lastAnswer) return;
  try {
    $('speakBtn').disabled=true;
    if(!isLive()) {
      if(looksSorani(state.lastAnswer)) return toast('Demo playback is for English only. ElevenLabs Kurdish voice works through the live integration.');
      if(!('speechSynthesis' in window)) throw new Error('Your browser does not support speech synthesis.');
      window.speechSynthesis.cancel();
      const speech=new SpeechSynthesisUtterance(state.lastAnswer.replace('DEMO EXAMPLE (not Gemini):',''));
      speech.lang='en-US';speech.rate=.92;
      speech.onend=()=>{$('speakBtn').disabled=false;};
      speech.onerror=()=>{$('speakBtn').disabled=false;};
      window.speechSynthesis.speak(speech);
      return;
    }
    const replyLanguage=selected('replyLanguage');
    const clean=state.lastAnswer.slice(0,1800);
    const mp3=await apiRequest(PATHS.speak,makeForm({text:clean,replyLanguage}),'blob');
    if(!mp3||!mp3.size) throw new Error('ElevenLabs returned an empty audio file.');
    if(state.currentAudio){state.currentAudio.pause();URL.revokeObjectURL(state.currentAudioUrl);}
    state.currentAudioUrl=URL.createObjectURL(mp3);
    state.currentAudio=new Audio(state.currentAudioUrl);
    state.currentAudio.onended=()=>{$('speakBtn').disabled=false;};
    state.currentAudio.onerror=()=>{$('speakBtn').disabled=false;toast('Cannot play the returned audio file.',true);};
    await state.currentAudio.play();
    toast('Playing Hoshyar’s ElevenLabs voice.');
  } catch(e){toast(e.message,true);} finally {if(!state.currentAudio||state.currentAudio.paused)$('speakBtn').disabled=false;}
}
function updateRecordingUI(on,purpose) {
  const teacher=purpose==='teacher';
  const btn=$(teacher?'teacherMic':'studentMic');
  btn.classList.toggle('is-recording',on);
  btn.setAttribute('aria-label',on?'Stop recording':`Record ${purpose} audio`);
  if(teacher) {
    $('teacherWave').parentElement.classList.toggle('is-recording',on);
    $('teacherRecordStatus').textContent=on?'Recording your teacher...':'Ready to listen';
    $('teacherRecordHint').textContent=on?'Press the microphone again to stop.':'Get permission first. Tap the mic to record.';
  } else {
    $('studentMic').classList.toggle('is-recording',on);
    $('studentMicLabel').textContent=on?'Stop recording':'Record question';
  }
}
function endAudioStream() {
  clearInterval(state.timer);clearTimeout(state.autoStop);
  if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}
}
async function toggleRecord(purpose) {
  if(state.recorder && state.recorder.state==='recording') {
    if(state.recorderPurpose!==purpose) return toast('Stop the other recording first.',true);
    state.recorder.stop();return;
  }
  if(state.busy) return;
  if(!isLive()) return toast('Microphone transcription is not available in demo mode. Please type your notes or question.', true);
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder) return toast('Microphone recording requires Chrome/Edge on localhost or HTTPS.',true);
  try {
    validLectureId();
    state.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    const options=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
    state.recordingType=options||'';
    const recorder=new MediaRecorder(state.stream,options?{mimeType:options}:undefined);
    const chunks=[];state.recorder=recorder;state.recorderPurpose=purpose;
    recorder.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data);};
    recorder.onerror=()=>{endAudioStream();updateRecordingUI(false,purpose);toast('The microphone recording failed.',true);};
    recorder.onstop=async()=>{
      endAudioStream();updateRecordingUI(false,purpose);
      state.recorder=null;state.recorderPurpose=null;
      const type=recorder.mimeType||state.recordingType||'audio/webm';
      const blob=new Blob(chunks,{type});
      if(blob.size<400) return toast('Audio clip was too short. Try again.',true);
      if(blob.size>10*1024*1024) return toast('Clip exceeds 10 MB. Please record shorter audio.',true);
      await handleRecordedAudio(blob,purpose);
    };
    recorder.start();state.startedAt=Date.now();
    updateRecordingUI(true,purpose);
    state.timer=setInterval(()=>{if(purpose==='teacher')$('teacherTimer').textContent=elapsed(Date.now()-state.startedAt);},200);
    state.autoStop=setTimeout(()=>{if(recorder.state==='recording') recorder.stop();},60000);
    toast(`Recording ${purpose==='teacher'?'teacher lecture':'student question'} — press again to stop.`);
  } catch(e) {endAudioStream();updateRecordingUI(false,purpose);toast(e.name==='NotAllowedError'?'Microphone permission denied. Please allow microphone access.':e.message,true);}
}
async function handleRecordedAudio(blob,purpose) {
  if(!isLive()) {
    const placeholder=purpose==='teacher'?'[Demo recording — no transcription. Switch to Live mode for ElevenLabs.]':'[Demo recording — type a question to try the assistant.]';
    if(purpose==='teacher')$('lectureText').value=placeholder;
    else $('questionInput').value=placeholder;
    toast('Recording captured in demo mode. It was not uploaded or transcribed.');return;
  }
  try {
    const lectureId=validLectureId();setBusy(true);
    const form=makeForm({lectureId,sessionId:state.sessionId,speaker:purpose,listeningLanguage:purpose==='teacher'?selected('listenLanguage'):selected('questionLanguage')});
    const ext=blob.type.includes('mp4')?'m4a':'webm';form.append('data',blob,`hoshyar-recording.${ext}`);
    const response=await apiRequest(PATHS.transcribe,form);
    const text=response.text||'';
    if(!text) throw new Error('ElevenLabs did not recognize any speech.');
    if(purpose==='teacher') {appendNote(text,true);toast('Teacher speech transcribed and saved to lecture memory.');}
    else { $('questionInput').value=text;toast('Question transcribed. Review it and click Ask Hoshyar.'); $('questionInput').focus(); }
  } catch(e){toast(e.message,true);} finally{setBusy(false);}
}
function resetForLecture() {
  state.segments=[];state.lastAnswer='';$('segmentCount').textContent='0 segments';
  $('savedNotes').innerHTML='<div class="empty-state"><span>▤</span><p>Your teacher’s notes will appear here.</p></div>';
  $('speakBtn').disabled=true;
  $('conversation').innerHTML='<div class="starter"><div class="assistant-avatar">✦</div><div class="starter-bubble"><strong>New lecture selected</strong><p>Add teacher notes, then start asking about the lesson.</p></div></div>';
  $('sideLectureName').textContent=value('lectureId')||'class-001';
  if(!isLive()) { const notes=readNotes(validLectureId()); notes.slice(-70).forEach(note=>appendNote(note.text, !!note.fromVoice, true)); }
  toast('Switched lecture. Notes are kept separately for each lecture ID.');
}
function start() {
  $('demoMode').addEventListener('click',()=>setMode('demo'));
  $('liveMode').addEventListener('click',()=>setMode('live'));
  $('saveNoteBtn').addEventListener('click',saveNotes);
  $('askForm').addEventListener('submit',askQuestion);
  $('speakBtn').addEventListener('click',playAnswer);
  $('teacherMic').addEventListener('click',()=>toggleRecord('teacher'));
  $('studentMic').addEventListener('click',()=>toggleRecord('student'));
  $('lectureId').addEventListener('change',resetForLecture);
  if(!isLive()) readNotes(validLectureId()).slice(-70).forEach(note=>appendNote(note.text,!!note.fromVoice,true));
  document.querySelectorAll('[data-scroll]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.nav-link').forEach(x=>x.classList.toggle('selected',x===b));
    document.getElementById(b.dataset.scroll)?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  document.querySelectorAll('[data-question]').forEach(button=>button.addEventListener('click',()=>{
    $('questionInput').value=button.dataset.question;$('questionInput').focus();
  }));
  $('helpBtn').addEventListener('click',()=>$('helpDialog').showModal());
  $('closeHelp').addEventListener('click',()=>$('helpDialog').close());
  window.addEventListener('beforeunload',()=>{if(state.recorder?.state==='recording')state.recorder.stop();endAudioStream();});
}
start();
