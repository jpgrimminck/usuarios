import {
  isFallbackRecorderAvailable,
  startFallbackRecording,
  stopFallbackRecording,
  isFallbackRecording,
  cleanupFallbackRecording
} from './fallback-recorder.js';

// Audio recording configuration - PCM direct capture
const AUDIO_CONFIG = {
  sampleRate: 44100,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
};

// PCM recording variables
let pcmAudioContext = null;
let pcmScriptProcessor = null;
let pcmSourceNode = null;
let pcmSamples = [];
let pcmSampleRate = 44100;
let isRecordingPcm = false;
let usingFallbackRecorder = false; // Track if we're using fallback

// Encode mono PCM samples to stereo WAV (duplicates mono to both L and R channels)
function encodePcmToStereoWav(samples, sampleRate) {
  const numChannels = 2; // Stereo output
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const bufferSize = 44 + dataSize;
  
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  
  // Write WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write interleaved stereo data (duplicate mono sample to both channels)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    // Left channel
    view.setInt16(offset, intSample, true);
    offset += 2;
    // Right channel (same as left)
    view.setInt16(offset, intSample, true);
    offset += 2;
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

// Cleanup PCM recording resources
function cleanupPcmRecording() {
  isRecordingPcm = false;
  if (pcmScriptProcessor) {
    pcmScriptProcessor.disconnect();
    pcmScriptProcessor = null;
  }
  if (pcmSourceNode) {
    pcmSourceNode.disconnect();
    pcmSourceNode = null;
  }
  if (pcmAudioContext && pcmAudioContext.state !== 'closed') {
    pcmAudioContext.close().catch(() => {});
    pcmAudioContext = null;
  }
}

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
let recorderMimeType = 'audio/wav';
let isUploadingRecording = false;
let recorderElements = null;
let recordingStartTime = null;
let recordingTimerInterval = null;
let pendingTitleFocus = false;
let viewportResizeHandler = null;
let keepRecorderVisible = false;
let recorderViewportBaseHeight = null;

// Pending uploads storage key
const PENDING_UPLOADS_KEY = 'usuarios:pendingAudioUploads';

// Get pending uploads from localStorage
function getPendingUploads() {
  try {
    const stored = localStorage.getItem(PENDING_UPLOADS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Error reading pending uploads:', e);
    return [];
  }
}

// Save pending uploads to localStorage
function savePendingUploads(uploads) {
  try {
    localStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(uploads));
  } catch (e) {
    console.error('Error saving pending uploads:', e);
  }
}

// Add a pending upload
function addPendingUpload(upload) {
  const uploads = getPendingUploads();
  uploads.push(upload);
  savePendingUploads(uploads);
}

// Remove a pending upload by tempId
function removePendingUpload(tempId) {
  const uploads = getPendingUploads();
  const filtered = uploads.filter(u => u.tempId !== tempId);
  savePendingUploads(filtered);
}

// Convert blob to base64 for storage
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Convert base64 back to blob
function base64ToBlob(base64, mimeType) {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

// Build an optimistic audio card for pending upload
function buildPendingUploadCard(pendingUpload) {
  const container = document.createElement('div');
  container.className = 'audio-card audio-card--pending flex flex-col gap-4 rounded-lg bg-gray-800 p-4';
  container.dataset.pendingId = pendingUpload.tempId;
  container.dataset.status = 'uploading';
  
  // Always show uploading status
  const statusHtml = `<span class="pending-upload__status pending-upload__status--uploading">
      <span class="material-symbols-outlined">cloud_upload</span>
      <span>Subiendo...</span>
     </span>`;

  const seekSeconds = 3;
  container.innerHTML = `
    <div class="audio-card__header">
      <p class="audio-card__title text-lg font-semibold text-white">
        ${pendingUpload.title || 'Audio sin nombre'}
        ${statusHtml}
      </p>
      <div class="audio-card__controls" data-role="controls">
        <button type="button" class="flex items-center justify-center rounded-full bg-gray-700 text-white transition-colors hover:bg-gray-600" data-role="rewind-button" aria-label="Retroceder ${seekSeconds} segundos" title="Retroceder ${seekSeconds} segundos">
          <span class="material-symbols-outlined text-3xl">fast_rewind</span>
        </button>
        <button type="button" class="flex items-center justify-center rounded-full bg-[var(--primary-color)] text-white" data-role="play-button" aria-label="Reproducir o pausar" title="Reproducir o pausar">
          <span class="material-symbols-outlined text-4xl">play_arrow</span>
        </button>
        <button type="button" class="flex items-center justify-center rounded-full bg-gray-700 text-white transition-colors hover:bg-gray-600" data-role="forward-button" aria-label="Avanzar ${seekSeconds} segundos" title="Avanzar ${seekSeconds} segundos">
          <span class="material-symbols-outlined text-3xl">fast_forward</span>
        </button>
      </div>
    </div>
    <div class="audio-slider" data-visualizer="slider">
      <div class="audio-slider__track" data-role="slider-track">
        <div class="audio-slider__fill" data-role="slider-fill"></div>
      </div>
    </div>
  `;
  
  // Set up audio playback for pending upload
  const playButton = container.querySelector('[data-role="play-button"]');
  const rewindButton = container.querySelector('[data-role="rewind-button"]');
  const forwardButton = container.querySelector('[data-role="forward-button"]');
  const sliderTrack = container.querySelector('[data-role="slider-track"]');
  const sliderFill = container.querySelector('[data-role="slider-fill"]');
  
  // Create hidden audio element for playback
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  
  // Use the blob URL if available, otherwise convert from base64
  if (pendingUpload.blobUrl) {
    audio.src = pendingUpload.blobUrl;
  } else if (pendingUpload.base64Data) {
    const blob = base64ToBlob(pendingUpload.base64Data, pendingUpload.mimeType || 'audio/wav');
    const url = URL.createObjectURL(blob);
    audio.src = url;
    // Store for later cleanup
    container.dataset.blobUrl = url;
  }
  
  container.appendChild(audio);
  
  // Expand/collapse functionality
  const expandPendingCard = () => {
    // Collapse any other expanded cards (including regular ones)
    document.querySelectorAll('.audio-card--expanded, .audio-card--controls-visible').forEach(card => {
      if (card !== container) {
        card.classList.remove('audio-card--expanded', 'audio-card--controls-visible');
      }
    });
    container.classList.add('audio-card--expanded', 'audio-card--controls-visible');
  };
  
  const collapsePendingCard = () => {
    container.classList.remove('audio-card--expanded', 'audio-card--controls-visible');
  };
  
  // Click on card to expand/collapse
  container.addEventListener('click', (event) => {
    // Don't toggle if clicking on controls or actions
    if (event.target.closest('[data-role="play-button"], [data-role="rewind-button"], [data-role="forward-button"], .audio-card__controls, .pending-upload__actions')) return;
    
    if (container.classList.contains('audio-card--expanded')) {
      collapsePendingCard();
    } else {
      expandPendingCard();
    }
  });
  
  if (playButton) {
    playButton.addEventListener('click', (event) => {
      event.stopPropagation();
      expandPendingCard();
      if (audio.paused) {
        audio.play();
        const icon = playButton.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = 'pause';
      } else {
        audio.pause();
        const icon = playButton.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = 'play_arrow';
      }
    });
  }
  
  if (rewindButton) {
    rewindButton.addEventListener('click', (event) => {
      event.stopPropagation();
      expandPendingCard();
      audio.currentTime = Math.max(0, audio.currentTime - seekSeconds);
    });
  }
  
  if (forwardButton) {
    forwardButton.addEventListener('click', (event) => {
      event.stopPropagation();
      expandPendingCard();
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + seekSeconds);
    });
  }
  
  audio.addEventListener('ended', () => {
    const icon = playButton?.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = 'play_arrow';
    if (sliderFill) sliderFill.style.width = '0%';
  });
  
  audio.addEventListener('timeupdate', () => {
    if (audio.duration && sliderFill) {
      sliderFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    }
  });
  
  if (sliderTrack) {
    sliderTrack.addEventListener('click', (e) => {
      const rect = sliderTrack.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      if (audio.duration) {
        audio.currentTime = percent * audio.duration;
      }
    });
  }
  
  return container;
}

// Render all pending upload cards
export function renderPendingUploads() {
  const container = document.querySelector('.space-y-4');
  if (!container) return;
  
  const currentSongId = getSongId();
  const uploads = getPendingUploads().filter(u => String(u.songId) === String(currentSongId));
  
  // Remove existing pending cards
  container.querySelectorAll('.audio-card--pending').forEach(card => card.remove());
  
  // Add pending cards in their alphabetically correct position
  uploads.forEach(upload => {
    const card = buildPendingUploadCard(upload);
    insertCardAlphabetically(container, card, upload.title);
  });
}

// Insert a card in alphabetical order within the user's audio section
function insertCardAlphabetically(container, card, title) {
  const titleLower = (title || '').toLowerCase();
  
  // Find user's section header (not "Otros usuarios")
  const allHeaders = Array.from(container.querySelectorAll('h3'));
  const otherUsersHeader = allHeaders.find(h => h.textContent.includes('Otros usuarios'));
  const userHeader = allHeaders.find(h => !h.textContent.includes('Otros usuarios'));
  
  // Find the user's section div
  let userSection = userHeader?.closest('.mb-6');
  let otherUsersSection = otherUsersHeader?.closest('.mb-6');
  
  // If user section doesn't exist, we need to create it
  if (!userSection) {
    // Create user section
    userSection = document.createElement('div');
    userSection.className = 'mb-6';
    
    // Get user name from localStorage or use default
    let userName = 'ti';
    try {
      const raw = window.localStorage.getItem('usuarios:authorizedProfile');
      if (raw) {
        const payload = JSON.parse(raw);
        if (payload?.userName) {
          userName = payload.userName;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    const headerEl = document.createElement('h3');
    headerEl.className = 'text-2xl font-semibold text-white mb-3';
    headerEl.textContent = `Audios de ${userName}`;
    userSection.appendChild(headerEl);
    
    // Insert at the beginning of container, before "Otros usuarios" if it exists
    if (otherUsersSection) {
      container.insertBefore(userSection, otherUsersSection);
    } else {
      container.insertBefore(userSection, container.firstChild);
    }
  }
  
  // Get all audio cards in the user's section (not pending ones)
  const userCards = Array.from(userSection.querySelectorAll('.audio-card'))
    .filter(c => !c.classList.contains('audio-card--pending'));
  
  // Find the right position alphabetically
  let insertBefore = null;
  for (const existingCard of userCards) {
    const existingTitleEl = existingCard.querySelector('.audio-card__title');
    // Extract just the title text, excluding status badges
    let existingTitle = '';
    if (existingTitleEl) {
      // Clone to avoid modifying the original
      const clone = existingTitleEl.cloneNode(true);
      // Remove status elements
      clone.querySelectorAll('.pending-upload__status, .audio-card__format').forEach(el => el.remove());
      existingTitle = clone.textContent?.trim()?.toLowerCase() || '';
    }
    if (titleLower.localeCompare(existingTitle) < 0) {
      insertBefore = existingCard;
      break;
    }
  }
  
  if (insertBefore) {
    userSection.insertBefore(card, insertBefore);
  } else {
    // Insert at end of user section
    userSection.appendChild(card);
  }
}

// Perform the actual upload
async function performUpload(uploadData) {
  const { base64Data, mimeType, title, songId, songColumn, uploaderId, nextAudioId } = uploadData;
  
  // Convert base64 back to blob
  const blob = base64ToBlob(base64Data, mimeType);
  
  const extension = determineFileExtension(mimeType);
  const safeName = slugifyFileName(title).slice(0, 48) || 'recording';
  const fileName = `${safeName}.${extension}`;
  const storageName = `${nextAudioId}-${fileName}`;
  const filePath = `${audioBucket}/${storageName}`;
  
  // Upload to storage
  const { error: uploadError } = await supabaseClient
    .storage
    .from(audioBucket)
    .upload(filePath, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType || 'audio/webm'
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Insert database record
  const insertPayload = {
    id: nextAudioId,
    detail: 'recording',
    name: title,
    uploader_id: uploaderId,
    url: filePath
  };
  insertPayload[songColumn] = songId;

  const { error: insertError } = await supabaseClient
    .from('audios')
    .insert(insertPayload);

  if (insertError) {
    throw new Error(`Database insert failed: ${insertError.message}`);
  }
  
  return true;
}

// Resume pending uploads on page load
export async function resumePendingUploads() {
  const currentSongId = getSongId();
  if (!currentSongId) return;
  
  const uploads = getPendingUploads().filter(
    u => String(u.songId) === String(currentSongId)
  );
  
  for (const upload of uploads) {
    attemptUploadWithRetry(upload);
  }
}

// Attempt upload with automatic retry on failure
async function attemptUploadWithRetry(upload, retryDelay = 3000) {
  try {
    await performUpload(upload);
    // Success - remove from pending and reload
    removePendingUpload(upload.tempId);
    const card = document.querySelector(`[data-pending-id="${upload.tempId}"]`);
    if (card) card.remove();
    reloadAudios({ skipRealtimeSetup: true });
  } catch (err) {
    console.warn('Upload failed, will retry:', err.message);
    // Wait and retry
    setTimeout(() => {
      attemptUploadWithRetry(upload, Math.min(retryDelay * 1.5, 30000)); // Increase delay, max 30s
    }, retryDelay);
  }
}

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
  const previewEl = section.querySelector('[data-recorder-preview]');
  recorderElements = {
    section,
    dynamicContainer: section.querySelector('[data-recorder-dynamic]'),
    titleInput: section.querySelector('[data-recorder-field="title"]'),
    titleLabel: section.querySelector('[data-recorder-title-label]'),
    toggleButton: section.querySelector('[data-recorder-action="toggle"]'),
    discardButton: section.querySelector('[data-recorder-action="discard"]'),
    playButton: section.querySelector('[data-recorder-play]'),
    timerEl: section.querySelector('[data-recorder-timer]'),
    previewEl,
    previewAudio: previewEl?.querySelector('[data-recorder-audio]'),
    previewSlider: previewEl?.querySelector('[data-recorder-slider]'),
    previewFill: previewEl?.querySelector('[data-recorder-fill]'),
    previewTime: previewEl?.querySelector('[data-recorder-time]'),
    initialized: false
  };
  return recorderElements;
}

function focusRecorderTitle(options = {}) {
  const { preventScroll = false } = options;
  const elements = ensureRecorderElements();
  if (!elements?.titleInput || elements.titleInput.disabled) return;
  try {
    if (preventScroll) {
      elements.titleInput.focus({ preventScroll: true });
    } else {
      elements.titleInput.focus();
    }
  } catch (_) {
    elements.titleInput.focus();
  }
  if (typeof elements.titleInput.select === 'function') {
    elements.titleInput.select();
  } else if (typeof elements.titleInput.setSelectionRange === 'function') {
    const length = elements.titleInput.value.length;
    elements.titleInput.setSelectionRange(length, length);
  }
}

function queueFocusOnTitle() {
  keepRecorderVisible = true;
  attachViewportWatcher();

  const focusAndReveal = () => {
    focusRecorderTitle({ preventScroll: false });
    const elements = ensureRecorderElements();
    if (elements?.titleInput?.scrollIntoView) {
      try {
        elements.titleInput.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      } catch (_) {
        elements.titleInput.scrollIntoView();
      }
    }
    ensureRecorderVisible({ behavior: 'auto', force: true, target: 'dynamic' });
  };

  focusAndReveal();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(focusAndReveal);
  }
  setTimeout(focusAndReveal, 180);
  setTimeout(() => ensureRecorderVisible({ behavior: 'smooth', force: true, target: 'dynamic' }), 420);
}

function ensureRecorderVisible(options = {}) {
  const elements = ensureRecorderElements();
  if (!elements) return;

  const hostSection = elements.section;
  if (hostSection) {
    applyRecorderViewportOffset();
  }

  const { behavior = 'smooth', force = false, target = 'button' } = options;
  if (!force && !keepRecorderVisible) return;

  if (hostSection) {
    try {
      const position = window.getComputedStyle(hostSection).position;
      if (position === 'fixed') {
        return;
      }
    } catch (_) {
      // continue if computed style fails
    }
  }

  const targetElement = target === 'dynamic' && elements.dynamicContainer
    ? elements.dynamicContainer
    : elements.toggleButton;

  if (!targetElement) return;

  const targetRect = targetElement.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const visualViewportHeight = window.visualViewport ? window.visualViewport.height : viewportHeight;
  const dynamicFooter = Math.max(0, viewportHeight - visualViewportHeight);
  const safeViewportHeight = Math.max(0, viewportHeight - dynamicFooter);
  const bottomMargin = target === 'dynamic' ? 96 : 32;
  const bottomLimit = safeViewportHeight - bottomMargin;
  const topMargin = 24;

  if (targetRect.bottom > bottomLimit) {
    const scrollAmount = targetRect.bottom - bottomLimit;
    window.scrollBy({ top: scrollAmount, behavior });
  } else if (targetRect.top < topMargin) {
    window.scrollBy({ top: targetRect.top - topMargin, behavior });
  }
}

function applyRecorderViewportOffset() {
  const elements = ensureRecorderElements();
  if (!elements?.section) return;

  // Only apply offset if the title input is focused (keyboard likely open)
  if (elements.titleInput && document.activeElement !== elements.titleInput) {
    elements.section.style.transform = '';
    return;
  }

  if (!window.visualViewport) {
    elements.section.style.transform = '';
    return;
  }

  const { height: visualHeight, offsetTop = 0 } = window.visualViewport;
  const layoutHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  if (recorderViewportBaseHeight == null) {
    recorderViewportBaseHeight = Math.max(visualHeight + offsetTop, layoutHeight);
  } else {
    recorderViewportBaseHeight = Math.max(recorderViewportBaseHeight, visualHeight + offsetTop, layoutHeight);
  }

  const keyboardInset = Math.max(0, recorderViewportBaseHeight - (visualHeight + offsetTop));

  if (keyboardInset > 0) {
    elements.section.style.transform = `translateY(-${keyboardInset}px)`;
  } else {
    elements.section.style.transform = '';
  }
}

function getRecorderVisibilityTarget() {
  if (pendingTitleFocus || recordingBlob) return 'dynamic';
  if (mediaRecorder && mediaRecorder.state === 'recording') return 'button';

  const elements = recorderElements || ensureRecorderElements();
  if (elements?.dynamicContainer?.classList.contains('recorder-section__dynamic--recorded')) {
    return 'dynamic';
  }
  return 'button';
}

function attachViewportWatcher() {
  keepRecorderVisible = true;
  if (!window.visualViewport || viewportResizeHandler) return;
  viewportResizeHandler = () => {
    applyRecorderViewportOffset();
    ensureRecorderVisible({ behavior: 'auto', force: true, target: getRecorderVisibilityTarget() });
  };
  window.visualViewport.addEventListener('resize', viewportResizeHandler, { passive: true });
  window.visualViewport.addEventListener('scroll', viewportResizeHandler, { passive: true });
  applyRecorderViewportOffset();
  ensureRecorderVisible({ behavior: 'auto', force: true, target: getRecorderVisibilityTarget() });
}

function detachViewportWatcher() {
  if (!window.visualViewport || !viewportResizeHandler) {
    keepRecorderVisible = false;
    return;
  }
  window.visualViewport.removeEventListener('resize', viewportResizeHandler);
  window.visualViewport.removeEventListener('scroll', viewportResizeHandler);
  viewportResizeHandler = null;
  keepRecorderVisible = false;
  recorderViewportBaseHeight = null;
  const elements = ensureRecorderElements();
  if (elements?.section) {
    elements.section.style.transform = '';
  }
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
    elements.timerEl.classList.add('recorder-section__timer--hidden');
  }
}

export function updateRecorderUi() {
  const elements = ensureRecorderElements();
  if (!elements) return;
  const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
  const hasRecording = !!recordingBlob;
  const shouldShowTitle = hasRecording || pendingTitleFocus;
  const shouldExpand = isRecording || hasRecording || pendingTitleFocus;
  const sectionEl = elements.section;
  const wasActive = sectionEl ? sectionEl.classList.contains('recorder-section--active') : false;

  if (sectionEl) {
    sectionEl.classList.toggle('recorder-section--active', shouldExpand);
    sectionEl.classList.toggle('recorder-section--recording', isRecording);
  }

  if (elements.dynamicContainer) {
    elements.dynamicContainer.classList.toggle('recorder-section__dynamic--recorded', shouldShowTitle);
  }

  // Show/hide timer based on recording state
  if (elements.timerEl) {
    elements.timerEl.classList.toggle('recorder-section__timer--hidden', !isRecording);
    if (isRecording) {
      updateRecordingTimer();
    }
  }

  if (elements.toggleButton) {
    const canRecord = !!getSongId() && !isUploadingRecording;
    elements.toggleButton.disabled = !canRecord;

    if (isRecording) {
      // Recording in progress - show red square with "Stop"
      elements.toggleButton.classList.remove('recorder-button--round', 'recorder-button--primary', 'recorder-button--success');
      elements.toggleButton.classList.add('recorder-button--square', 'recorder-button--primary');
      elements.toggleButton.textContent = 'Detener';
    } else if (hasRecording) {
      // Recording stopped - show green square with "Save"
      elements.toggleButton.classList.remove('recorder-button--round', 'recorder-button--primary');
      elements.toggleButton.classList.add('recorder-button--square', 'recorder-button--success');
      elements.toggleButton.textContent = 'Guardar';
    } else {
      // Initial state - show red circle with "Record"
      elements.toggleButton.classList.remove('recorder-button--square', 'recorder-button--success');
      elements.toggleButton.classList.add('recorder-button--round', 'recorder-button--primary');
      elements.toggleButton.textContent = 'Grabar';
    }
  }

  // Show erase button when recording or has recording
  if (elements.discardButton) {
    elements.discardButton.hidden = !isRecording && !hasRecording;
    elements.discardButton.disabled = isUploadingRecording;
  }

  // Show play button only when there's a recording
  if (elements.playButton) {
    elements.playButton.hidden = !hasRecording;
    elements.playButton.disabled = isUploadingRecording;
  }

  // Show title input only after stopping recording
  if (elements.titleLabel) {
    elements.titleLabel.classList.toggle('recorder-section__label--hidden', !shouldShowTitle);
  }

  if (elements.titleInput) {
    elements.titleInput.disabled = isUploadingRecording;
  }

  if (elements.previewEl && elements.previewAudio) {
    const shouldShowPreview = hasRecording && !!recordingObjectUrl;
    elements.previewEl.classList.toggle('recorder-section__preview--hidden', !shouldShowPreview);
    if (!shouldShowPreview) {
      elements.previewAudio.pause();
      elements.previewAudio.removeAttribute('src');
      elements.previewAudio.load();
      if (elements.previewFill) elements.previewFill.style.width = '0%';
      if (elements.previewTime) elements.previewTime.textContent = '0:00';
      if (elements.playButton) {
        const icon = elements.playButton.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = 'play_arrow';
      }
    } else if (recordingObjectUrl) {
      elements.previewAudio.src = recordingObjectUrl;
    }
  }

  if (shouldExpand && !wasActive) {
    ensureRecorderVisible({ behavior: 'auto', target: getRecorderVisibilityTarget() });
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
  usingFallbackRecorder = false;
  const elements = ensureRecorderElements();
  if (elements) {
    if (!keepInput && elements.titleInput) {
      elements.titleInput.value = '';
    }
    if (elements.previewEl && elements.previewAudio) {
      elements.previewAudio.pause();
      elements.previewAudio.removeAttribute('src');
      elements.previewAudio.load();
      elements.previewEl.classList.add('recorder-section__preview--hidden');
      if (elements.previewFill) elements.previewFill.style.width = '0%';
      if (elements.previewTime) elements.previewTime.textContent = '0:00';
      if (elements.previewPlayButton) {
        const icon = elements.previewPlayButton.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = 'play_arrow';
      }
    }
    if (elements.titleLabel) {
      elements.titleLabel.classList.add('recorder-section__label--hidden');
    }
    if (elements.dynamicContainer) {
      elements.dynamicContainer.classList.remove('recorder-section__dynamic--recorded');
    }
  }
  pendingTitleFocus = false;
  detachViewportWatcher();
  updateRecorderUi();
}

function handleRecorderStopped() {
  stopRecordingTimer();
  cleanupRecorderStream();
  cleanupPcmRecording();
  mediaRecorder = null;

  // Check if we have PCM samples
  if (!pcmSamples.length) {
    resetRecordingState({ keepInput: true });
    return;
  }

  // Create stereo WAV from mono PCM samples
  const allSamples = new Float32Array(pcmSamples.reduce((acc, chunk) => acc + chunk.length, 0));
  let offset = 0;
  for (const chunk of pcmSamples) {
    allSamples.set(chunk, offset);
    offset += chunk.length;
  }
  pcmSamples = [];
  
  recordingBlob = encodePcmToStereoWav(allSamples, pcmSampleRate);
  recorderMimeType = 'audio/wav';
  
  if (recordingObjectUrl) {
    URL.revokeObjectURL(recordingObjectUrl);
  }
  recordingObjectUrl = URL.createObjectURL(recordingBlob);
  updateRecorderUi();
  keepRecorderVisible = true;
  attachViewportWatcher();
  ensureRecorderVisible({ behavior: 'auto', force: true, target: 'dynamic' });
  if (pendingTitleFocus) {
    pendingTitleFocus = false;
    queueFocusOnTitle();
  } else {
    setTimeout(() => ensureRecorderVisible({ behavior: 'smooth', force: true, target: 'dynamic' }), 260);
  }
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
  pendingTitleFocus = false;
  keepRecorderVisible = true;
  usingFallbackRecorder = false;
  ensureRecorderVisible({ behavior: 'auto', force: true, target: getRecorderVisibilityTarget() });
  attachViewportWatcher();

  // Try primary PCM recording method first
  let primaryMethodSucceeded = false;
  
  try {
    const constraints = {
      audio: {
        echoCancellation: AUDIO_CONFIG.echoCancellation,
        noiseSuppression: AUDIO_CONFIG.noiseSuppression,
        autoGainControl: AUDIO_CONFIG.autoGainControl,
        sampleRate: AUDIO_CONFIG.sampleRate,
        channelCount: 1
      }
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    recorderStream = stream;
    pcmSamples = [];
    
    // Create AudioContext for PCM capture
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    pcmAudioContext = new AudioContextClass({ sampleRate: AUDIO_CONFIG.sampleRate });
    pcmSampleRate = pcmAudioContext.sampleRate;
    
    // Create source from microphone stream
    pcmSourceNode = pcmAudioContext.createMediaStreamSource(stream);
    
    // Create ScriptProcessor for capturing raw PCM data
    // Buffer size 4096 is a good balance between latency and performance
    pcmScriptProcessor = pcmAudioContext.createScriptProcessor(4096, 1, 1);
    
    pcmScriptProcessor.onaudioprocess = (event) => {
      if (!isRecordingPcm) return;
      const inputData = event.inputBuffer.getChannelData(0);
      // Copy the data since the buffer gets reused
      pcmSamples.push(new Float32Array(inputData));
    };
    
    // Connect: microphone -> scriptProcessor -> destination (needed for it to work)
    pcmSourceNode.connect(pcmScriptProcessor);
    pcmScriptProcessor.connect(pcmAudioContext.destination);
    
    isRecordingPcm = true;
    mediaRecorder = { state: 'recording' }; // Fake mediaRecorder for UI compatibility
    recorderMimeType = 'audio/wav';
    primaryMethodSucceeded = true;
    
    startRecordingTimer();
    updateRecorderUi();
    ensureRecorderVisible({ behavior: 'auto', target: getRecorderVisibilityTarget() });
  } catch (err) {
    console.warn('Primary recording method failed, trying fallback:', err);
    cleanupRecorderStream();
    cleanupPcmRecording();
    mediaRecorder = null;
  }
  
  // If primary method failed, try fallback MediaRecorder
  if (!primaryMethodSucceeded && isFallbackRecorderAvailable()) {
    try {
      console.log('Using fallback MediaRecorder');
      const result = await startFallbackRecording();
      usingFallbackRecorder = true;
      mediaRecorder = { state: 'recording' }; // Fake for UI compatibility
      recorderMimeType = result.mimeType;
      
      startRecordingTimer();
      updateRecorderUi();
      ensureRecorderVisible({ behavior: 'auto', target: getRecorderVisibilityTarget() });
    } catch (fallbackErr) {
      console.error('Fallback recording also failed:', fallbackErr);
      cleanupFallbackRecording();
      mediaRecorder = null;
      resetRecordingState({ keepInput: true });
    }
  } else if (!primaryMethodSucceeded) {
    console.error('No recording method available');
    resetRecordingState({ keepInput: true });
  }
}

function stopRecording() {
  if (usingFallbackRecorder) {
    // Handle fallback recorder stop
    stopFallbackRecording()
      .then(({ blob, mimeType }) => {
        recordingBlob = blob;
        recorderMimeType = mimeType;
        if (recordingObjectUrl) {
          URL.revokeObjectURL(recordingObjectUrl);
        }
        recordingObjectUrl = URL.createObjectURL(recordingBlob);
        stopRecordingTimer();
        mediaRecorder = null;
        
        updateRecorderUi();
        keepRecorderVisible = true;
        attachViewportWatcher();
        ensureRecorderVisible({ behavior: 'auto', force: true, target: 'dynamic' });
        if (pendingTitleFocus) {
          pendingTitleFocus = false;
          queueFocusOnTitle();
        } else {
          setTimeout(() => ensureRecorderVisible({ behavior: 'smooth', force: true, target: 'dynamic' }), 260);
        }
      })
      .catch(err => {
        console.error('Error stopping fallback recording:', err);
        resetRecordingState({ keepInput: true });
      });
    return;
  }
  
  if (!isRecordingPcm) return;
  isRecordingPcm = false;
  handleRecorderStopped();
  updateRecorderUi();
  ensureRecorderVisible({ behavior: 'auto', target: getRecorderVisibilityTarget() });
}

function discardRecording() {
  if (usingFallbackRecorder) {
    cleanupFallbackRecording();
    usingFallbackRecorder = false;
    mediaRecorder = null;
    resetRecordingState({ keepInput: true });
    return;
  }
  
  if (isRecordingPcm) {
    isRecordingPcm = false;
    cleanupPcmRecording();
    cleanupRecorderStream();
    pcmSamples = [];
    mediaRecorder = null;
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

  const uploaderId = (() => {
    const raw = getUserParam();
    if (!raw) return null;
    const numericId = Number(raw);
    return Number.isFinite(numericId) ? numericId : raw;
  })();

  const mimeType = recordingBlob.type || recorderMimeType || 'audio/wav';
  const songColumn = getAudiosSongColumn();
  
  // Generate a temporary ID for this upload
  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  
  // Convert blob to base64 for localStorage persistence
  let base64Data;
  try {
    base64Data = await blobToBase64(recordingBlob);
  } catch (err) {
    console.error('Failed to convert blob to base64:', err);
    return;
  }
  
  // Create pending upload data
  const pendingUpload = {
    tempId,
    title: titleValue,
    songId,
    songColumn,
    uploaderId,
    nextAudioId,
    mimeType,
    base64Data,
    blobUrl: recordingObjectUrl, // Keep for immediate playback
    status: 'uploading',
    createdAt: Date.now(),
    retryCount: 0
  };
  
  // Save to localStorage immediately
  addPendingUpload(pendingUpload);
  
  // Show optimistic card immediately in its correct alphabetical position
  const container = document.querySelector('.space-y-4');
  if (container) {
    const card = buildPendingUploadCard(pendingUpload);
    insertCardAlphabetically(container, card, titleValue);
  }
  
  // Reset recorder UI immediately (user sees instant feedback)
  resetRecordingState({ keepInput: false });
  
  // Perform upload in background with automatic retry
  attemptUploadWithRetry(pendingUpload);
}

export function initRecorderControls() {
  const elements = ensureRecorderElements();
  if (!elements || elements.initialized || !elements.toggleButton) return;
  elements.initialized = true;

  elements.toggleButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      pendingTitleFocus = true;
      updateRecorderUi();
      focusRecorderTitle();
      stopRecording();
    } else if (recordingBlob) {
      uploadRecording();
    } else {
      ensureRecorderVisible({ behavior: 'auto', target: getRecorderVisibilityTarget() });
      startRecording();
    }
  });
  
  elements.discardButton.addEventListener('click', (event) => {
    event.preventDefault();
    discardRecording();
  });

  // Custom preview player controls
  if (elements.previewAudio && elements.playButton) {
    const formatTime = (seconds) => {
      if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Helper to restore focus to title input (keeps keyboard open on mobile)
    const restoreTitleFocus = () => {
      if (elements.titleInput && document.activeElement !== elements.titleInput) {
        elements.titleInput.focus();
      }
    };

    // Prevent play button from stealing focus (keeps keyboard open)
    elements.playButton.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    elements.playButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
    }, { passive: false });
    elements.playButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (elements.previewAudio.paused) {
        elements.previewAudio.play();
      } else {
        elements.previewAudio.pause();
      }
      restoreTitleFocus();
    });

    elements.playButton.addEventListener('click', (e) => {
      // Only handle click for non-touch devices (touch handled by touchend)
      if (e.sourceCapabilities?.firesTouchEvents) return;
      if (elements.previewAudio.paused) {
        elements.previewAudio.play();
      } else {
        elements.previewAudio.pause();
      }
      restoreTitleFocus();
    });

    elements.previewAudio.addEventListener('play', () => {
      const icon = elements.playButton.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'pause';
    });

    elements.previewAudio.addEventListener('pause', () => {
      const icon = elements.playButton.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'play_arrow';
    });

    elements.previewAudio.addEventListener('ended', () => {
      const icon = elements.playButton.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'play_arrow';
      if (elements.previewFill) elements.previewFill.style.width = '0%';
    });

    elements.previewAudio.addEventListener('timeupdate', () => {
      const duration = elements.previewAudio.duration || 0;
      const currentTime = elements.previewAudio.currentTime || 0;
      if (elements.previewFill && duration > 0) {
        elements.previewFill.style.width = `${(currentTime / duration) * 100}%`;
      }
      if (elements.previewTime) {
        elements.previewTime.textContent = formatTime(currentTime);
      }
    });

    elements.previewAudio.addEventListener('loadedmetadata', () => {
      if (elements.previewTime) {
        elements.previewTime.textContent = formatTime(elements.previewAudio.duration);
      }
    });

    if (elements.previewSlider) {
      // Prevent slider from stealing focus (keeps keyboard open)
      elements.previewSlider.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      elements.previewSlider.addEventListener('touchstart', (e) => {
        e.preventDefault();
      }, { passive: false });

      const handleSliderSeek = (clientX) => {
        const rect = elements.previewSlider.getBoundingClientRect();
        const percent = (clientX - rect.left) / rect.width;
        const duration = elements.previewAudio.duration || 0;
        if (duration > 0) {
          elements.previewAudio.currentTime = percent * duration;
        }
        restoreTitleFocus();
      };

      elements.previewSlider.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (e.changedTouches && e.changedTouches.length > 0) {
          handleSliderSeek(e.changedTouches[0].clientX);
        }
      });

      elements.previewSlider.addEventListener('click', (e) => {
        // Only handle click for non-touch devices
        if (e.sourceCapabilities?.firesTouchEvents) return;
        handleSliderSeek(e.clientX);
      });
    }
  }

  updateRecorderUi();
}
