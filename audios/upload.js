const RECORDER_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2'
];
const RECORDING_COUNTDOWN_SECONDS = 3;

let supabaseClient = null;
let audioBucket = 'audios';
let getSongId = () => null;
let getAudiosSongColumn = () => 'relational_song_id';
let reloadAudios = () => {};
let getUserParam = () => null;

let mediaRecorder = null;
let recorderStream = null;
let recordedChunks = [];
let recordingBlob = null;
let recordingObjectUrl = null;
let recorderMimeType = 'audio/webm';
let isUploadingRecording = false;
let recorderElements = null;
let recorderCountdownTimer = null;
let recorderCountdownRemaining = 0;
let isRecorderCountdownActive = false;

export function initializeUploadModule(options = {}) {
  supabaseClient = options.supabase || null;
  audioBucket = options.audioBucket || 'audios';
  getSongId = typeof options.getSongId === 'function' ? options.getSongId : (() => null);
  getAudiosSongColumn = typeof options.getAudiosSongColumn === 'function' ? options.getAudiosSongColumn : (() => 'relational_song_id');
  reloadAudios = typeof options.reloadAudios === 'function' ? options.reloadAudios : (() => {});
  getUserParam = typeof options.getUserParam === 'function' ? options.getUserParam : (() => null);
}

function ensureRecorderElements() {
  if (recorderElements) return recorderElements;
  const section = document.querySelector('[data-recorder-section]');
  if (!section) return null;
  recorderElements = {
    section,
    titleInput: section.querySelector('[data-recorder-field="title"]'),
    toggleButton: section.querySelector('[data-recorder-action="toggle"]'),
    uploadButton: section.querySelector('[data-recorder-action="upload"]'),
    discardButton: section.querySelector('[data-recorder-action="discard"]'),
    conditionalButtons: Array.from(section.querySelectorAll('[data-recorder-visibility]')),
    previewEl: section.querySelector('[data-recorder-preview]'),
    statusEl: section.querySelector('[data-recorder-status]'),
    initialized: false
  };
  return recorderElements;
}

export function setRecorderStatus(message, tone = 'neutral') {
  const elements = ensureRecorderElements();
  if (!elements?.statusEl) return;
  elements.statusEl.textContent = message;
  elements.statusEl.dataset.tone = tone;
}

export function setDefaultRecorderStatus() {
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  if (recordingBlob) return;
  if (!getSongId()) {
    setRecorderStatus('Select a track before recording.', 'warning');
    return;
  }
  setRecorderStatus('Press "Record" to start and add a title when you are ready.', 'neutral');
}

function cancelRecordingCountdown(options = {}) {
  const { silent = false, skipUiUpdate = false } = options;
  if (recorderCountdownTimer) {
    clearInterval(recorderCountdownTimer);
    recorderCountdownTimer = null;
  }
  const wasActive = isRecorderCountdownActive;
  recorderCountdownRemaining = 0;
  isRecorderCountdownActive = false;
  if (wasActive && !silent) {
    setDefaultRecorderStatus();
  }
  if (!skipUiUpdate) {
    updateRecorderUi();
  }
}

function beginRecordingCountdown() {
  cancelRecordingCountdown({ silent: true, skipUiUpdate: true });
  isRecorderCountdownActive = true;
  recorderCountdownRemaining = RECORDING_COUNTDOWN_SECONDS;
  setRecorderStatus(`Recording starts in ${recorderCountdownRemaining}...`, 'info');
  updateRecorderUi();

  if (recorderCountdownRemaining <= 0) {
    cancelRecordingCountdown({ silent: true, skipUiUpdate: true });
    void startRecordingCore();
    return;
  }

  recorderCountdownTimer = window.setInterval(() => {
    recorderCountdownRemaining -= 1;
    if (recorderCountdownRemaining <= 0) {
      cancelRecordingCountdown({ silent: true, skipUiUpdate: true });
      setRecorderStatus('Starting recording...', 'info');
      void startRecordingCore();
      return;
    }
    setRecorderStatus(`Recording starts in ${recorderCountdownRemaining}...`, 'info');
    updateRecorderUi();
  }, 1000);
}

export function updateRecorderUi() {
  const elements = ensureRecorderElements();
  if (!elements) return;
  const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
  const hasRecording = !!recordingBlob;
  const isCountingDown = isRecorderCountdownActive;

  if (elements.toggleButton) {
    const showToggle = isRecording || !hasRecording || isCountingDown;
    elements.toggleButton.hidden = !showToggle;
    if (!showToggle && document.activeElement === elements.toggleButton) {
      elements.toggleButton.blur();
    }

    if (isCountingDown) {
      elements.toggleButton.disabled = false;
      const displayNumber = recorderCountdownRemaining > 0 ? recorderCountdownRemaining : 0;
      elements.toggleButton.textContent = String(displayNumber);
      elements.toggleButton.setAttribute('aria-pressed', 'false');
      elements.toggleButton.setAttribute('aria-label', `Recording starts in ${displayNumber}`);
      elements.toggleButton.classList.add('recorder-button--primary');
      elements.toggleButton.classList.remove('recorder-button--destructive');
    } else if (isRecording) {
      elements.toggleButton.disabled = false;
      elements.toggleButton.textContent = 'Stop';
      elements.toggleButton.setAttribute('aria-pressed', 'true');
      elements.toggleButton.setAttribute('aria-label', 'Stop');
      elements.toggleButton.classList.add('recorder-button--destructive');
      elements.toggleButton.classList.remove('recorder-button--primary');
    } else {
      const canRecord = !!getSongId() && !isUploadingRecording && !hasRecording;
      elements.toggleButton.disabled = !canRecord;
      elements.toggleButton.textContent = 'Record';
      elements.toggleButton.setAttribute('aria-pressed', 'false');
      elements.toggleButton.setAttribute('aria-label', 'Start recording');
      elements.toggleButton.classList.add('recorder-button--primary');
      elements.toggleButton.classList.remove('recorder-button--destructive');
    }
  }
  if (elements.conditionalButtons?.length) {
    elements.conditionalButtons.forEach((button) => {
      const visibility = button.dataset.recorderVisibility;
      const shouldShow = visibility === 'hasRecording' ? hasRecording : true;
      button.hidden = !shouldShow;
      if (!shouldShow && document.activeElement === button) {
        button.blur();
      }
    });
  }
  elements.uploadButton.disabled = !hasRecording || isUploadingRecording;
  elements.discardButton.disabled = !hasRecording || isRecording || isUploadingRecording;
  elements.titleInput.disabled = isRecording || isUploadingRecording;

  if (elements.previewEl) {
    elements.previewEl.classList.toggle('recorder-section__preview--visible', hasRecording && !!recordingObjectUrl);
    if (!hasRecording) {
      elements.previewEl.pause();
      elements.previewEl.removeAttribute('src');
      elements.previewEl.load();
    } else if (recordingObjectUrl) {
      elements.previewEl.src = recordingObjectUrl;
    }
  }
}

function cleanupRecorderStream() {
  if (recorderStream) {
    try {
      recorderStream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.debug('No se pudieron detener todas las pistas de la grabación:', err);
    }
  }
  recorderStream = null;
}

function resetRecordingState(options = {}) {
  const { keepInput = true, silent = false } = options;
  cancelRecordingCountdown({ silent: true, skipUiUpdate: true });
  if (recordingObjectUrl) {
    URL.revokeObjectURL(recordingObjectUrl);
    recordingObjectUrl = null;
  }
  recordingBlob = null;
  recordedChunks = [];
  const elements = ensureRecorderElements();
  if (elements) {
    if (!keepInput) {
      elements.titleInput.value = '';
    }
    if (elements.previewEl) {
      elements.previewEl.pause();
      elements.previewEl.removeAttribute('src');
      elements.previewEl.load();
      elements.previewEl.classList.remove('recorder-section__preview--visible');
    }
  }
  if (!silent) {
    setDefaultRecorderStatus();
  }
  updateRecorderUi();
}

function handleRecorderDataAvailable(event) {
  if (event?.data && event.data.size > 0) {
    recordedChunks.push(event.data);
  }
}

function handleRecorderStopped() {
  cleanupRecorderStream();
  if (mediaRecorder) {
    mediaRecorder.removeEventListener('dataavailable', handleRecorderDataAvailable);
    mediaRecorder.removeEventListener('stop', handleRecorderStopped);
  }
  mediaRecorder = null;

  if (!recordedChunks.length) {
    resetRecordingState({ keepInput: true, silent: true });
    setRecorderStatus('No audio was captured. Please try again.', 'warning');
    return;
  }

  recordingBlob = new Blob(recordedChunks, { type: recorderMimeType || 'audio/webm' });
  recordedChunks = [];
  if (recordingObjectUrl) {
    URL.revokeObjectURL(recordingObjectUrl);
  }
  recordingObjectUrl = URL.createObjectURL(recordingBlob);
  updateRecorderUi();
  setRecorderStatus('Recording ready. Add a title, then upload or discard.', 'success');
}

function determineFileExtension(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

function slugifyFileName(input) {
  if (!input) return '';
  return input
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

async function fetchNextAudioId() {
  try {
    const { data, error } = await supabaseClient
      .from('audios')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    if (error) throw error;

    const lastId = data && data[0] ? Number(data[0].id) : 0;
    const nextId = Number.isFinite(lastId) && lastId > 0 ? lastId + 1 : 1;
    return nextId;
  } catch (err) {
    console.error('Unable to obtain the next audio id:', err);
    return null;
  }
}

async function startRecording() {
  const elements = ensureRecorderElements();
  if (!elements) return;

  if (isRecorderCountdownActive) {
    cancelRecordingCountdown();
    setRecorderStatus('Recording countdown canceled.', 'info');
    return;
  }

  if (!getSongId()) {
    setRecorderStatus('Select a track before recording.', 'warning');
    return;
  }

  if (recordingBlob) {
    setRecorderStatus('Upload or discard the current recording before making a new one.', 'warning');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setRecorderStatus('This browser does not support audio recording.', 'error');
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    setRecorderStatus('There is already a recording in progress.', 'warning');
    return;
  }

  if (isUploadingRecording) {
    setRecorderStatus('Wait for the current upload to finish before starting a new recording.', 'warning');
    return;
  }

  resetRecordingState({ keepInput: true, silent: true });
  updateRecorderUi();
  beginRecordingCountdown();
}

async function startRecordingCore() {
  const elements = ensureRecorderElements();
  if (!elements) return;

  if (!getSongId()) {
    setRecorderStatus('Select a track before recording.', 'warning');
    updateRecorderUi();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setRecorderStatus('This browser does not support audio recording.', 'error');
    updateRecorderUi();
    return;
  }

  try {
    setRecorderStatus('Requesting microphone access...', 'info');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorderStream = stream;
    recordedChunks = [];

    let selectedMimeType = '';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      selectedMimeType = RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    }

    mediaRecorder = selectedMimeType ? new MediaRecorder(stream, { mimeType: selectedMimeType }) : new MediaRecorder(stream);
    recorderMimeType = mediaRecorder.mimeType || selectedMimeType || 'audio/webm';

    mediaRecorder.addEventListener('dataavailable', handleRecorderDataAvailable);
    mediaRecorder.addEventListener('stop', handleRecorderStopped);

    mediaRecorder.start();
    setRecorderStatus('Recording... tap "Stop" when you are done.', 'info');
  } catch (err) {
    console.error('Unable to start recording:', err);
    cleanupRecorderStream();
    mediaRecorder = null;
    resetRecordingState({ keepInput: true, silent: true });
    setRecorderStatus('Could not access the microphone. Check your permissions.', 'error');
  }

  updateRecorderUi();
}

function stopRecording() {
  cancelRecordingCountdown({ silent: true, skipUiUpdate: true });
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  try {
    mediaRecorder.stop();
    setRecorderStatus('Processing the recording...', 'info');
  } catch (err) {
    console.error('Error while stopping the recording:', err);
    setRecorderStatus('The recording could not be stopped.', 'error');
  }
  updateRecorderUi();
}

function discardRecording() {
  cancelRecordingCountdown({ silent: true, skipUiUpdate: true });
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    setRecorderStatus('Stop the recording before discarding it.', 'warning');
    return;
  }
  resetRecordingState({ keepInput: true, silent: true });
  setRecorderStatus('Recording discarded. You can try again.', 'info');
}

async function uploadRecording() {
  if (!recordingBlob) {
    setRecorderStatus('There is no recording to upload.', 'warning');
    return;
  }
  const songId = getSongId();
  if (!songId) {
    setRecorderStatus('Select a track before uploading the recording.', 'warning');
    return;
  }

  const elements = ensureRecorderElements();
  if (!elements) return;

  const titleValue = elements.titleInput.value.trim();
  if (!titleValue) {
    setRecorderStatus("Don't forget to enter a title.", 'warning');
    elements.titleInput.focus();
    return;
  }

  const nextAudioId = await fetchNextAudioId();
  if (!nextAudioId) {
    setRecorderStatus('Could not prepare the new audio record. Please try again later.', 'error');
    return;
  }

  const extension = determineFileExtension(recordingBlob.type || recorderMimeType);
  const safeName = slugifyFileName(titleValue).slice(0, 48) || 'recording';
  const fileName = `${safeName}.${extension}`;
  const storageName = `${nextAudioId}-${fileName}`;
  const filePath = `${audioBucket}/${storageName}`;
  const uploaderId = (() => {
    const raw = getUserParam();
    if (!raw) return null;
    const numericId = Number(raw);
    return Number.isFinite(numericId) ? numericId : raw;
  })();

  isUploadingRecording = true;
  updateRecorderUi();
  setRecorderStatus('Uploading recording...', 'info');

  try {
    const { error: uploadError } = await supabaseClient
      .storage
      .from(audioBucket)
      .upload(filePath, recordingBlob, {
        cacheControl: '3600',
        upsert: false,
        contentType: recordingBlob.type || recorderMimeType || 'audio/webm'
      });

    if (uploadError) {
      console.error('Error uploading the recording:', uploadError);
      setRecorderStatus('The recording could not be uploaded. Please try again.', 'error');
      return;
    }

    const insertPayload = {
      id: nextAudioId,
      instrument: titleValue,
      detail: 'recording',
      name: storageName,
      uploader_id: uploaderId,
      url: filePath
    };
    const songColumnForInsert = getAudiosSongColumn();
    insertPayload[songColumnForInsert] = songId;

    const { error: insertError } = await supabaseClient
      .from('audios')
      .insert(insertPayload);

    if (insertError) {
      console.error('Error saving the recording record:', insertError);
      setRecorderStatus('The recording was uploaded, but could not be saved in the database.', 'error');
      return;
    }

    setRecorderStatus('Recording uploaded successfully.', 'success');
    resetRecordingState({ keepInput: false, silent: true });
    reloadAudios({ skipRealtimeSetup: true });
  } catch (err) {
    console.error('Unexpected error while uploading the recording:', err);
    setRecorderStatus('An error occurred while uploading the recording.', 'error');
  } finally {
    isUploadingRecording = false;
    updateRecorderUi();
  }
}

export function initRecorderControls() {
  const elements = ensureRecorderElements();
  if (!elements || elements.initialized || !elements.toggleButton) return;
  elements.initialized = true;

  elements.toggleButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  });
  elements.uploadButton.addEventListener('click', (event) => {
    event.preventDefault();
    uploadRecording();
  });
  elements.discardButton.addEventListener('click', (event) => {
    event.preventDefault();
    discardRecording();
  });

  setDefaultRecorderStatus();
  updateRecorderUi();
}

export function initUploadFab() {
  const fab = document.getElementById('upload-audio-fab');
  const fileInput = document.getElementById('audio-file-input');

  if (!fab || !fileInput) return;

  fab.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    console.log('Archivo de audio seleccionado:', file.name, file.type, file.size);
    // TODO: manejar carga de audio y UI relacionada
  });
}
