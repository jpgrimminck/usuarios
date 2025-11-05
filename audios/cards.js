import {
  initializePlaybackControls,
  prepareAudioPlayer,
  togglePlayback,
  seekPlayback,
  stopCurrentAudio,
  clearPlaybackCache,
  setCardControlsVisibility,
  setButtonPlaying,
  getPlaybackCache,
  getCurrentAudioCard,
  getSeekOffsetSeconds,
  applyWaveformPosition
} from './controls.js';
import {
  buildWaveformState,
  refreshWaveformMetrics,
  resetWaveformState,
  populateWaveformFromSource
} from './waveform.js';
import {
  initializeStatusModule,
  initSongStatusControls,
  refreshSongStatusUi,
  setNormalizedUserId
} from './status.js';
import {
  initializeUploadModule,
  initRecorderControls,
  initUploadFab,
  setDefaultRecorderStatus,
  updateRecorderUi
} from './upload.js';

const AUDIO_BUCKET = 'audios';
const AUDIO_SONG_COLUMN_CANDIDATES = ['relational_song_id', 'song_id', 'cancion_id'];
const SEEK_OFFSET_SECONDS = 0;

const state = {
  supabase: null,
  urlParams: null,
  userId: null,
  title: null,
  songIdParam: null,
  normalizedUserId: null,
  currentSongIdResolved: null,
  audiosSongColumn: 'relational_song_id',
  audiosChannel: null,
  audiosRefreshTimeout: null,
  currentExpandedCard: null
};

function coerceNumericId(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value;
  }
  return value;
}

function isColumnMissingError(error) {
  if (!error) return false;
  const code = error.code || error?.details?.code;
  const message = String(error.message || error.details || '').toLowerCase();
  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

async function probeSongByTitle(titleStr) {
  if (!titleStr) return null;
  try {
    const { data, error } = await state.supabase
      .from('songs')
      .select('id, title, artists ( name )')
      .ilike('title', titleStr)
      .limit(1)
      .single();
    if (!error && data) {
      return { id: data.id, title: data.title, raw: data };
    }
  } catch (err) {
    console.debug('probeSongByTitle: songs table lookup failed:', err?.message || err);
  }
  return null;
}

async function fetchAndApplySongTitle(songId) {
  if (!songId) return null;
  const idVal = Number.isFinite(Number(songId)) ? Number(songId) : songId;

  const candidates = [
    { table: 'songs', select: 'id, title, artists ( name )', getTitle: (d) => d.title },
    { table: 'canciones', select: 'id, nombres_canciones ( titulo ), artistas ( nombre )', getTitle: (d) => d.nombres_canciones?.titulo }
  ];

  for (const c of candidates) {
    try {
      const { data, error } = await state.supabase
        .from(c.table)
        .select(c.select)
        .eq('id', idVal)
        .limit(1)
        .single();

      if (!error && data) {
        const songTitle = c.getTitle(data) || state.urlParams.get('title') || 'Pistas de práctica';
        applyPageTitle(songTitle);
        state.currentSongIdResolved = data?.id || null;
        return { id: data.id, title: songTitle, raw: data };
      }
    } catch (err) {
      console.debug(`probe ${c.table} failed:`, err?.message || err, err?.code || null);
      continue;
    }
  }

  const fallback = state.urlParams.get('title') || 'Pistas de práctica';
  applyPageTitle(fallback);
  return null;
}

function applyPageTitle(titleText) {
  const headerH1 = document.querySelector('header h1');
  const mainH2 = document.querySelector('main h2');
  if (headerH1) headerH1.textContent = titleText;
  if (mainH2) mainH2.textContent = titleText;
  try {
    document.title = `${titleText} — Stitch Design`;
  } catch (e) {
    // ignore
  }
}

async function fetchSongAudiosByCandidates(songId) {
  let lastError = null;
  for (const column of AUDIO_SONG_COLUMN_CANDIDATES) {
    try {
      const { data, error } = await state.supabase
        .from('audios')
        .select('id, instrument, url')
        .eq(column, songId)
        .order('instrument', { ascending: true });

      if (error) {
        if (isColumnMissingError(error)) {
          continue;
        }
        lastError = error;
        continue;
      }

      return { audios: data || [], columnUsed: column };
    } catch (err) {
      if (isColumnMissingError(err)) {
        continue;
      }
      lastError = err;
    }
  }

  return { audios: [], columnUsed: state.audiosSongColumn, error: lastError };
}

function collapseCurrentCard() {
  if (!state.currentExpandedCard) return;
  const card = state.currentExpandedCard;
  const activeCard = getCurrentAudioCard();
  if (activeCard === card) {
    stopCurrentAudio();
  }
  const audioId = card.dataset?.audioId ? Number(card.dataset.audioId) : null;
  if (audioId && getPlaybackCache().has(audioId)) {
    const cached = getPlaybackCache().get(audioId);
    if (cached?.waveform) {
      resetWaveformState(cached.waveform);
    }
  }
  card.classList.remove('audio-card--expanded');
  setCardControlsVisibility(card, false);
  state.currentExpandedCard = null;
}

function expandCard(card) {
  if (!card) return;
  if (state.currentExpandedCard === card) return;
  collapseCurrentCard();
  card.classList.add('audio-card--expanded');
  setCardControlsVisibility(card, true);
  const audioId = card.dataset?.audioId ? Number(card.dataset.audioId) : null;
  if (audioId && getPlaybackCache().has(audioId)) {
    const cached = getPlaybackCache().get(audioId);
    if (cached?.waveform) {
      refreshWaveformMetrics(cached.waveform);
      resetWaveformState(cached.waveform);
      if (!cached.waveformData?.values?.length) {
        populateWaveformFromSource(cached).catch((err) => {
          console.debug('No se pudo generar la forma de onda al expandir la tarjeta', audioId, err?.message || err);
        });
      }
    }
  }
  state.currentExpandedCard = card;
}

function scheduleAudiosRefresh() {
  if (state.audiosRefreshTimeout) {
    clearTimeout(state.audiosRefreshTimeout);
  }
  state.audiosRefreshTimeout = setTimeout(() => {
    state.audiosRefreshTimeout = null;
    loadAudios({ skipRealtimeSetup: true });
  }, 150);
}

function initAudiosRealtime() {
  if (!state.currentSongIdResolved) return;

  if (state.audiosChannel) {
    state.supabase.removeChannel(state.audiosChannel);
    state.audiosChannel = null;
  }

  state.audiosChannel = state.supabase
    .channel(`audios_song_${state.currentSongIdResolved}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'audios',
      filter: `${state.audiosSongColumn || 'relational_song_id'}=eq.${state.currentSongIdResolved}`
    }, scheduleAudiosRefresh);

  state.audiosChannel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR') {
      console.error('Error suscribiéndose a cambios de audios en tiempo real');
    }
  });
}

function buildAudioCard(audio) {
  const container = document.createElement('div');
  container.className = 'audio-card flex flex-col gap-4 rounded-lg bg-gray-800 p-4';
  container.dataset.audioId = audio.id;
  const seekSeconds = Math.abs(getSeekOffsetSeconds()) || Math.abs(SEEK_OFFSET_SECONDS);
  container.innerHTML = `
    <div class="audio-card__header">
      <p class="audio-card__title text-lg font-semibold text-white">${audio.instrument || 'Instrumento sin nombre'}</p>
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
    <div class="waveform" data-role="waveform">
      <div class="waveform-viewport" data-role="waveform-viewport">
        <div class="waveform-content" data-role="waveform-content"></div>
      </div>
    </div>
  `;
  return container;
}

async function loadAudios(options = {}) {
  const { skipRealtimeSetup = false } = options;
  const headingEl = document.querySelector('h2');
  let headingTitle = state.title || '';
  let songId = state.songIdParam ? Number(state.songIdParam) : null;
  let songRecord = null;

  try {
    if (songId) {
      try {
        const probed = await fetchAndApplySongTitle(songId);
        if (probed) {
          songRecord = probed.raw || probed;
          songId = probed.id || songId;
          if (!headingTitle && probed.title) headingTitle = probed.title;
        } else {
          songId = null;
        }
      } catch (err) {
        console.error('Error obteniendo canción por ID:', err);
        songId = null;
      }
    }

    if (!songId && state.title) {
      try {
        const probed = await probeSongByTitle(state.title);
        if (probed) {
          songRecord = probed.raw || probed;
          songId = probed.id || songId;
          headingTitle = probed.title || headingTitle;
        }
      } catch (err) {
        console.error('Error obteniendo canción por título:', err);
      }
    }

    if (!songRecord && headingTitle) {
      try {
        const probed = await probeSongByTitle(headingTitle);
        if (probed) {
          songRecord = probed.raw || probed;
          songId = probed.id || songId;
          if (!headingTitle && probed.title) headingTitle = probed.title;
        }
      } catch (err) {
        console.error('Error obteniendo nombre de canción (probe):', err);
      }
    }

    if (!songRecord || !songId) {
      console.warn('No se encontró la canción para cargar audios.');
      setDefaultRecorderStatus();
      updateRecorderUi();
      await refreshSongStatusUi(null);
      renderEmptyState();
      return;
    }

    if (headingEl && headingTitle) {
      headingEl.textContent = headingTitle;
    }

    const previousSongId = state.currentSongIdResolved;
    state.currentSongIdResolved = songId;
    setDefaultRecorderStatus();
    updateRecorderUi();
    await refreshSongStatusUi(songId);

    const { audios, columnUsed, error: audiosError } = await fetchSongAudiosByCandidates(songId);
    if (columnUsed) {
      state.audiosSongColumn = columnUsed;
    }
    if (audiosError) {
      console.error('Error obteniendo audios:', audiosError);
    }

    const container = document.querySelector('.space-y-4');
    container.innerHTML = '';

    if (!audios || audios.length === 0) {
      container.appendChild(buildEmptyStateElement());
      clearPlaybackCache();
      collapseCurrentCard();
      updateRecorderUi();
      setDefaultRecorderStatus();

      if (!skipRealtimeSetup && (previousSongId !== state.currentSongIdResolved || !state.audiosChannel)) {
        initAudiosRealtime();
      }
      return;
    }

  clearPlaybackCache();
  collapseCurrentCard();

    audios.forEach((audio) => {
      const audioElement = buildAudioCard(audio);
      const playButton = audioElement.querySelector('[data-role="play-button"]');
      const rewindButton = audioElement.querySelector('[data-role="rewind-button"]');
      const forwardButton = audioElement.querySelector('[data-role="forward-button"]');
      const waveformViewport = audioElement.querySelector('[data-role="waveform-viewport"]');
      const waveformContent = audioElement.querySelector('[data-role="waveform-content"]');
      buildWaveformState({ viewportEl: waveformViewport, contentEl: waveformContent }, audio.id);

      playButton.addEventListener('click', (event) => {
        event.stopPropagation();
        expandCard(audioElement);
        togglePlayback(playButton, audio, { viewportEl: waveformViewport, contentEl: waveformContent });
      });
      if (seekSeconds > 0) {
        rewindButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          expandCard(audioElement);
          await seekPlayback(audio, -seekSeconds, { viewportEl: waveformViewport, contentEl: waveformContent });
        });
        forwardButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          expandCard(audioElement);
          await seekPlayback(audio, seekSeconds, { viewportEl: waveformViewport, contentEl: waveformContent });
        });
      } else {
        rewindButton.disabled = true;
        forwardButton.disabled = true;
      }

      prepareAudioPlayer(audio, null, { viewportEl: waveformViewport, contentEl: waveformContent })
        .catch((err) => {
          console.debug('No se pudo preparar la forma de onda para el audio', audio.id, err?.message || err);
        });

      audioElement.addEventListener('click', (event) => {
        if (event.target.closest('[data-role="play-button"], [data-role="rewind-button"], [data-role="forward-button"], .audio-card__controls')) return;
        if (state.currentExpandedCard === audioElement) {
          collapseCurrentCard();
          return;
        }
        expandCard(audioElement);
      });

      container.appendChild(audioElement);
    });

    setDefaultRecorderStatus();
    updateRecorderUi();

    if (!skipRealtimeSetup && (previousSongId !== state.currentSongIdResolved || !state.audiosChannel)) {
      initAudiosRealtime();
    }
  } catch (err) {
    console.error('Error general al cargar audios:', err);
    setDefaultRecorderStatus();
    updateRecorderUi();
  }
}

function renderEmptyState() {
  const container = document.querySelector('.space-y-4');
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(buildEmptyStateElement());
}

function buildEmptyStateElement() {
  const emptyState = document.createElement('div');
  emptyState.className = 'rounded-lg bg-gray-800 p-6 text-center text-gray-400';
  emptyState.textContent = 'Aún no hay pistas registradas para esta canción.';
  return emptyState;
}

function setupBackLink() {
  const backLink = document.getElementById('back-to-songs');
  if (!backLink) return;
  if (state.userId) {
    backLink.href = `../songs.html?id=${encodeURIComponent(state.userId)}`;
  } else {
    backLink.href = '../songs.html';
  }
}

function handleWindowResize() {
  getPlaybackCache().forEach((cacheEntry) => {
    if (!cacheEntry || !cacheEntry.waveform) return;
    refreshWaveformMetrics(cacheEntry.waveform);
    const currentTime = cacheEntry.waveform.lastCurrentTime ?? cacheEntry.player?.currentTime ?? 0;
    const duration = cacheEntry.waveform.duration ?? cacheEntry.player?.duration ?? 0;
    applyWaveformPosition(cacheEntry.waveform, currentTime, duration);
  });
}

function handleBeforeUnload() {
  clearPlaybackCache();
  if (state.audiosChannel) {
    state.supabase.removeChannel(state.audiosChannel);
    state.audiosChannel = null;
  }
}

export function initializeCards(options = {}) {
  state.supabase = options.supabase;
  state.urlParams = options.urlParams || new URLSearchParams(window.location.search);
  state.userId = options.userId ?? state.urlParams.get('id');
  state.title = options.title ?? state.urlParams.get('title');
  state.songIdParam = options.songIdParam ?? state.urlParams.get('songId');
  state.normalizedUserId = coerceNumericId(state.userId);

  initializePlaybackControls({
    supabase: state.supabase,
    audioBucket: AUDIO_BUCKET,
    seekOffsetSeconds: SEEK_OFFSET_SECONDS
  });

  initializeStatusModule({
    supabase: state.supabase,
    normalizedUserId: state.normalizedUserId,
    getCurrentSongId: () => state.currentSongIdResolved
  });

  initializeUploadModule({
    supabase: state.supabase,
    audioBucket: AUDIO_BUCKET,
    getSongId: () => state.currentSongIdResolved,
    getAudiosSongColumn: () => state.audiosSongColumn,
    reloadAudios: (opts) => loadAudios(opts),
    getUserParam: () => state.userId
  });

  setupBackLink();

  setNormalizedUserId(state.normalizedUserId);
  initSongStatusControls();
  initRecorderControls();
  initUploadFab();
  setDefaultRecorderStatus();
  updateRecorderUi();

  loadAudios();

  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('beforeunload', handleBeforeUnload);
}
