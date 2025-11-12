const RECORDER_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2'
];

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
let recordingStartTime = null;
let recordingTimerInterval = null;

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
    titleLabel: section.querySelector('[data-recorder-title-label]'),
    toggleButton: section.querySelector('[data-recorder-action="toggle"]'),
    discardButton: section.querySelector('[data-recorder-action="discard"]'),
    timerEl: section.querySelector('[data-recorder-timer]'),
    previewEl: section.querySelector('[data-recorder-preview]'),
    initialized: false
  };
  return recorderElements;
}

export function setDefaultRecorderStatus() {
  // No status messages needed anymore
}

function updateRecordingTimer() {
  const elements = ensureRecorderElements();
  if (!elements?.timerEl || !recordingStartTime) return;
  
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  elements.timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function startRecordingTimer() {
  recordingStartTime = Date.now();
  const elements = ensureRecorderElements();
  if (elements?.timerEl) {
    elements.timerEl.hidden = false;
    updateRecordingTimer();
  }
  recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
}

function stopRecordingTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
  recordingStartTime = null;
  const elements = ensureRecorderElements();
  if (elements?.timerEl) {
    elements.timerEl.hidden = true;
  }
}

export function updateRecorderUi() {
  const elements = ensureRecorderElements();
  if (!elements) return;
  const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
  const hasRecording = !!recordingBlob;

  if (elements.toggleButton) {
    const canRecord = !!getSongId() && !isUploadingRecording;
    elements.toggleButton.disabled = !canRecord;

    if (isRecording) {
      // Recording in progress - show red square with "Stop"
      elements.toggleButton.classList.remove('recorder-button--round', 'recorder-button--primary', 'recorder-button--success');
      elements.toggleButton.classList.add('recorder-button--square', 'recorder-button--primary');
      elements.toggleButton.textContent = 'Stop';
    } else if (hasRecording) {
      // Recording stopped - show green square with "Save"
      elements.toggleButton.classList.remove('recorder-button--round', 'recorder-button--primary');
      elements.toggleButton.classList.add('recorder-button--square', 'recorder-button--success');
      elements.toggleButton.textContent = 'Save';
    } else {
      // Initial state - show red circle with "Record"
      elements.toggleButton.classList.remove('recorder-button--square', 'recorder-button--success');
      elements.toggleButton.classList.add('recorder-button--round', 'recorder-button--primary');
      elements.toggleButton.textContent = 'Record';
    }
  }

  // Show erase button when recording or has recording
  if (elements.discardButton) {
    elements.discardButton.hidden = !isRecording && !hasRecording;
    elements.discardButton.disabled = isUploadingRecording;
  }

  // Show title input only after stopping recording
  if (elements.titleLabel) {
    elements.titleLabel.hidden = !hasRecording;
  }

  if (elements.titleInput) {
    elements.titleInput.disabled = isUploadingRecording;
  }

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
  const { keepInput = true } = options;
  stopRecordingTimer();
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
  updateRecorderUi();
}

function handleRecorderDataAvailable(event) {
  if (event?.data && event.data.size > 0) {
    recordedChunks.push(event.data);
  }
}

function handleRecorderStopped() {
  stopRecordingTimer();
  cleanupRecorderStream();
  if (mediaRecorder) {
    mediaRecorder.removeEventListener('dataavailable', handleRecorderDataAvailable);
    mediaRecorder.removeEventListener('stop', handleRecorderStopped);
  }
  mediaRecorder = null;

  if (!recordedChunks.length) {
    resetRecordingState({ keepInput: true });
    return;
  }

  recordingBlob = new Blob(recordedChunks, { type: recorderMimeType || 'audio/webm' });
  recordedChunks = [];
  if (recordingObjectUrl) {
    URL.revokeObjectURL(recordingObjectUrl);
  }
  recordingObjectUrl = URL.createObjectURL(recordingBlob);
  updateRecorderUi();
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

  if (!getSongId()) return;
  if (recordingBlob) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  if (isUploadingRecording) return;

  resetRecordingState({ keepInput: true });

  try {
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
    startRecordingTimer();
    updateRecorderUi();
  } catch (err) {
    console.error('Unable to start recording:', err);
    cleanupRecorderStream();
    mediaRecorder = null;
    resetRecordingState({ keepInput: true });
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  try {
    mediaRecorder.stop();
  } catch (err) {
    console.error('Error while stopping the recording:', err);
  }
  updateRecorderUi();
}

function discardRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording without saving
    if (mediaRecorder) {
      mediaRecorder.removeEventListener('dataavailable', handleRecorderDataAvailable);
      mediaRecorder.removeEventListener('stop', handleRecorderStopped);
      try {
        mediaRecorder.stop();
      } catch (err) {
        console.error('Error stopping recording:', err);
      }
    }
    cleanupRecorderStream();
    mediaRecorder = null;
    recordedChunks = [];
  }
  resetRecordingState({ keepInput: true });
}

async function uploadRecording() {
  if (!recordingBlob) return;
  const songId = getSongId();
  if (!songId) return;

  const elements = ensureRecorderElements();
  if (!elements) return;

  const titleValue = elements.titleInput.value.trim();
  if (!titleValue) {
    elements.titleInput.focus();
    return;
  }

  const nextAudioId = await fetchNextAudioId();
  if (!nextAudioId) return;

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
      return;
    }

    resetRecordingState({ keepInput: false });
    reloadAudios({ skipRealtimeSetup: true });
  } catch (err) {
    console.error('Unexpected error while uploading the recording:', err);
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
    } else if (recordingBlob) {
      uploadRecording();
    } else {
      startRecording();
    }
  });
  
  elements.discardButton.addEventListener('click', (event) => {
    event.preventDefault();
    discardRecording();
  });

  updateRecorderUi();
}
