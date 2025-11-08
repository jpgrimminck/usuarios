import {
  buildWaveformState,
  populateWaveformFromSource,
  startWaveformAnimation,
  stopWaveformAnimation,
  applyWaveformPosition,
  resetWaveformState,
  applyWaveformValues
} from './visualizer.js';

let supabaseClient = null;
let audioBucket = 'audios';
let seekOffsetSeconds = 0;

const playbackCache = new Map();
let currentAudioInstance = null;
let currentAudioButton = null;
let currentAudioCacheEntry = null;

export function initializePlaybackControls(options = {}) {
  supabaseClient = options.supabase || null;
  audioBucket = options.audioBucket || 'audios';
  seekOffsetSeconds = Number.isFinite(options.seekOffsetSeconds) ? Number(options.seekOffsetSeconds) : 0;
}

function assertInitialized() {
  if (!supabaseClient) {
    throw new Error('Playback controls not initialized. Call initializePlaybackControls first.');
  }
}

export function getPlaybackCache() {
  return playbackCache;
}

export function getCurrentAudioCard() {
  return currentAudioButton ? currentAudioButton.closest('.audio-card') : null;
}

export function setCardControlsVisibility(card, visible) {
  if (!card) return;
  card.classList.toggle('audio-card--controls-visible', !!visible);
}

export function setButtonPlaying(button, isPlaying) {
  if (!button) return;
  const icon = button.querySelector('.material-symbols-outlined');
  if (icon) {
    icon.textContent = isPlaying ? 'pause' : 'play_arrow';
  }
  button.dataset.playing = isPlaying ? 'true' : 'false';
}

function isHttpUrl(path) {
  return typeof path === 'string' && /^https?:\/\//i.test(path);
}

function normalizeAudioStoragePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  let path = rawPath.trim();
  if (!path) return null;
  path = path.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/[^/]+\/[^/]+\//i, '');
  path = path.replace(/^\/+/, '');
  if (!path) return null;
  if (path.startsWith(`${audioBucket}/`)) {
    return path;
  }
  if (path.includes('/')) {
    return path;
  }
  return `${audioBucket}/${path}`;
}

export function stopCurrentAudio() {
  if (currentAudioInstance) {
    currentAudioInstance.pause();
    currentAudioInstance.currentTime = 0;
  }
  if (currentAudioButton) {
    setButtonPlaying(currentAudioButton, false);
    const audioCard = currentAudioButton.closest('.audio-card');
    if (audioCard) {
      setCardControlsVisibility(audioCard, false);
      const audioId = audioCard.dataset?.audioId ? Number(audioCard.dataset.audioId) : null;
      if (audioId && playbackCache.has(audioId)) {
        const cached = playbackCache.get(audioId);
        if (cached) {
          stopWaveformAnimation(cached);
          if (cached.waveform) {
            resetWaveformState(cached.waveform);
          }
        }
      }
    }
  } else if (currentAudioCacheEntry) {
    stopWaveformAnimation(currentAudioCacheEntry);
    if (currentAudioCacheEntry.waveform) {
      resetWaveformState(currentAudioCacheEntry.waveform);
    }
  }
  currentAudioInstance = null;
  currentAudioButton = null;
  currentAudioCacheEntry = null;
}

export function clearPlaybackCache() {
  stopCurrentAudio();
  playbackCache.forEach((entry) => {
    const { player, revoke, waveform, cleanup } = entry;
    stopWaveformAnimation(entry);
    try {
      if (player) {
        player.pause();
        player.currentTime = 0;
      }
    } catch (err) {
      console.warn('No se pudo detener un reproductor en caché:', err);
    }
    if (waveform) {
      resetWaveformState(waveform);
    }
    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (cleanupErr) {
        console.warn('No se pudo limpiar eventos del reproductor:', cleanupErr);
      }
    }
    if (typeof revoke === 'function') {
      try {
        revoke();
      } catch (revErr) {
        console.warn('No se pudo liberar la URL en caché:', revErr);
      }
    }
  });
  playbackCache.clear();
}

export async function prepareAudioPlayer(audio, button, waveformElements) {
  assertInitialized();
  if (!audio) return null;

  let cached = playbackCache.get(audio.id);

  if (!cached) {
    const storagePath = audio.url || null;
    if (!storagePath) {
      console.warn('El audio no tiene ruta de almacenamiento definida:', audio.id);
      return null;
    }

    let sourceUrl = null;
    let revoke = null;
    let downloadBlob = null;

    if (isHttpUrl(storagePath)) {
      sourceUrl = storagePath;
    } else {
      const downloadBucket = audioBucket;
      const normalizedPath = normalizeAudioStoragePath(storagePath);
      const rawCandidate = typeof storagePath === 'string' ? storagePath.trim().replace(/^\/+/, '') : null;
      const candidatePaths = [];

      if (normalizedPath) candidatePaths.push(normalizedPath);
      if (rawCandidate && !candidatePaths.includes(rawCandidate)) candidatePaths.push(rawCandidate);

      let lastError = null;

      for (const candidate of candidatePaths) {
        try {
          const { data, error } = await supabaseClient
            .storage
            .from(downloadBucket)
            .download(candidate);

          if (error) {
            lastError = error;
            continue;
          }

          downloadBlob = data;
          console.debug('Audio descargado', { audioId: audio.id, bucket: downloadBucket, path: candidate });
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!downloadBlob) {
        console.error(`No se pudo descargar el audio ${storagePath}:`, lastError || {});
        return null;
      }

      sourceUrl = URL.createObjectURL(downloadBlob);
      revoke = () => URL.revokeObjectURL(sourceUrl);
    }

    const audioElement = new Audio(sourceUrl);
    const cacheEntry = {
      player: audioElement,
      revoke,
      playButtonRef: button || null,
      waveform: waveformElements ? buildWaveformState(waveformElements, audio.id) : null,
      waveformData: null,
      waveformDataPromise: null,
      sourceUrl,
      sourceBlob: downloadBlob || null,
      storagePath,
      waveformAnimationId: null,
      cleanup: null
    };

    const handleEnded = () => {
      if (currentAudioInstance === audioElement) {
        stopCurrentAudio();
      } else if (cacheEntry.playButtonRef && cacheEntry.playButtonRef.dataset.playing === 'true') {
        setButtonPlaying(cacheEntry.playButtonRef, false);
        const card = cacheEntry.playButtonRef.closest('.audio-card');
        setCardControlsVisibility(card, false);
      }
      stopWaveformAnimation(cacheEntry);
      if (cacheEntry.waveform) {
        resetWaveformState(cacheEntry.waveform);
      }
    };

    const handleProgress = () => applyWaveformPosition(cacheEntry.waveform, audioElement.currentTime, audioElement.duration);
    const handleLoadedMetadata = () => applyWaveformPosition(cacheEntry.waveform, audioElement.currentTime, audioElement.duration);

    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('timeupdate', handleProgress);
    audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioElement.addEventListener('seeking', handleProgress);
    audioElement.addEventListener('emptied', handleProgress);

    cacheEntry.cleanup = () => {
      stopWaveformAnimation(cacheEntry);
      audioElement.removeEventListener('ended', handleEnded);
      audioElement.removeEventListener('timeupdate', handleProgress);
      audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audioElement.removeEventListener('seeking', handleProgress);
      audioElement.removeEventListener('emptied', handleProgress);
    };

    playbackCache.set(audio.id, cacheEntry);
    cached = cacheEntry;

    populateWaveformFromSource(cacheEntry, sourceUrl, downloadBlob).catch((err) => {
      console.debug('No se pudo inicializar la forma de onda para el audio', audio.id, err?.message || err);
    });
  }

  if (waveformElements) {
    const rebuiltState = buildWaveformState(waveformElements, audio.id);
    if (rebuiltState) {
      cached.waveform = rebuiltState;
      if (cached.waveformData?.values?.length) {
        applyWaveformValues(cached.waveform, cached.waveformData.values, {
          peak: cached.waveformData.peak,
          duration: cached.waveformData.duration
        });
      } else {
        populateWaveformFromSource(cached).catch((err) => {
          console.debug('No se pudo actualizar la forma de onda para el audio', audio.id, err?.message || err);
        });
      }
      applyWaveformPosition(cached.waveform, cached.player?.currentTime || 0, cached.player?.duration || 0);
    }
  }

  if (button) {
    cached.playButtonRef = button;
  }

  if (!cached.waveformData?.values?.length) {
    populateWaveformFromSource(cached).catch((err) => {
      console.debug('No se pudo completar la forma de onda para el audio', audio.id, err?.message || err);
    });
  }

  return cached;
}

export async function togglePlayback(button, audio, waveformElements) {
  assertInitialized();
  if (!button || !audio) return;

  const cached = await prepareAudioPlayer(audio, button, waveformElements);
  if (!cached) {
    setButtonPlaying(button, false);
    return;
  }

  const { player } = cached;

  if (currentAudioInstance && currentAudioInstance !== player) {
    stopCurrentAudio();
  }

  if (player.paused) {
    try {
      await player.play();
      currentAudioInstance = player;
      currentAudioButton = button;
      currentAudioCacheEntry = cached;
      setButtonPlaying(button, true);
      setCardControlsVisibility(button.closest('.audio-card'), true);
      applyWaveformPosition(cached.waveform, player.currentTime, player.duration);
      startWaveformAnimation(cached);
    } catch (err) {
      console.error('No se pudo reproducir el audio:', err);
      setButtonPlaying(button, false);
      if (cached.waveform) {
        resetWaveformState(cached.waveform);
      }
      stopWaveformAnimation(cached);
    }
  } else {
    player.pause();
    setButtonPlaying(button, false);
    stopWaveformAnimation(cached);
    currentAudioCacheEntry = null;
  }
}

export async function seekPlayback(audio, offsetSeconds, waveformElements) {
  assertInitialized();
  if (!audio || !Number.isFinite(offsetSeconds)) return;

  const cached = await prepareAudioPlayer(audio, null, waveformElements);
  if (!cached) return;

  const { player, waveform } = cached;

  const ensureDurationReady = () => new Promise((resolve) => {
    let resolved = false;
    const markResolved = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      player.removeEventListener('loadedmetadata', markResolved);
      player.removeEventListener('durationchange', markResolved);
      resolve();
    };
    const timeoutId = setTimeout(markResolved, 1200);
    player.addEventListener('loadedmetadata', markResolved);
    player.addEventListener('durationchange', markResolved);
    if (Number.isFinite(player.duration)) {
      markResolved();
    }
  });

  if (!Number.isFinite(player.duration)) {
    try {
      await ensureDurationReady();
    } catch (err) {
      console.warn('No se pudo obtener la duración del audio antes de buscar:', err);
    }
  }

  const duration = Number.isFinite(player.duration) ? player.duration : null;
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  let nextTime = currentTime + offsetSeconds;

  if (duration !== null) {
    nextTime = Math.min(duration, nextTime);
  }

  nextTime = Math.max(0, nextTime);

  try {
    player.currentTime = nextTime;
  } catch (err) {
    console.warn('No se pudo ajustar el tiempo de reproducción:', err);
    return;
  }

  if (waveform) {
    applyWaveformPosition(waveform, nextTime, duration ?? player.duration);
  }
}

export function getSeekOffsetSeconds() {
  return seekOffsetSeconds;
}

export { applyWaveformPosition, populateWaveformFromSource };
