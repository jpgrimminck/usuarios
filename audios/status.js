export const STATUS_MAP = {
  1: 'No iniciado',
  2: 'En práctica',
  3: 'Completado'
};
export const STATUS_CYCLE = [1, 2, 3];
export const DEFAULT_STATUS = 1;

let supabaseClient = null;
let normalizedUserId = null;
let getCurrentSongId = () => null;

const songStatusUi = {
  container: null,
  button: null
};

let currentSongStatus = DEFAULT_STATUS;
let songStatusFetchToken = 0;
let songStatusClickBound = false;

export function initializeStatusModule(options = {}) {
  supabaseClient = options.supabase || null;
  normalizedUserId = options.normalizedUserId ?? null;
  getCurrentSongId = typeof options.getCurrentSongId === 'function' ? options.getCurrentSongId : (() => null);
  songStatusUi.container = document.querySelector('[data-song-status-container]');
  songStatusUi.button = document.querySelector('[data-song-status-button]');
}

export function setNormalizedUserId(value) {
  normalizedUserId = value ?? null;
}

export function normalizeStatusTag(value) {
  const val = Number(value);
  const label = STATUS_MAP[val] || STATUS_MAP[DEFAULT_STATUS];
  return label.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, '-');
}

export function getNextStatusTag(currentStatus) {
  const val = Number(currentStatus);
  const index = STATUS_CYCLE.indexOf(val);
  if (index === -1 || index === STATUS_CYCLE.length - 1) {
    return STATUS_CYCLE[0];
  }
  return STATUS_CYCLE[index + 1];
}

export function applyStatusStyles(button, statusTag) {
  if (!button) return;
  const val = Number(statusTag);
  const resolvedStatus = STATUS_CYCLE.includes(val) ? val : DEFAULT_STATUS;
  const label = STATUS_MAP[resolvedStatus];
  const normalized = normalizeStatusTag(resolvedStatus);
  
  button.textContent = label;
  button.dataset.status = resolvedStatus;
  
  STATUS_CYCLE.forEach((state) => {
    button.classList.remove(`song-status-button--${normalizeStatusTag(state)}`);
  });
  button.classList.add(`song-status-button--${normalized}`);
}

function setSongStatusLoading(isLoading) {
  if (!songStatusUi.button) return;
  if (isLoading) {
    songStatusUi.button.disabled = true;
    songStatusUi.button.dataset.loading = 'true';
  } else {
    delete songStatusUi.button.dataset.loading;
    songStatusUi.button.disabled = songStatusUi.container ? songStatusUi.container.hidden : true;
  }
}

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

async function fetchUserSongStatusTag(songId) {
  if (!normalizedUserId || songId === null || songId === undefined) {
    return null;
  }
  // Ensure songId is treated as a number for the query if it looks like one
  const normalizedSongId = coerceNumericId(songId);
  
  const { data, error } = await supabaseClient
    .from('user_songs')
    .select('status_tag')
    .eq('user_id', normalizedUserId)
    .eq('song_id', normalizedSongId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data.status_tag || DEFAULT_STATUS;
}

async function persistUserSongStatus(songId, nextStatus) {
  if (!normalizedUserId) {
    throw new Error('No user selected.');
  }
  const normalizedSongId = coerceNumericId(songId);
  
  // Use upsert to handle both existing and new rows
  const { data, error } = await supabaseClient
    .from('user_songs')
    .upsert({ 
      user_id: normalizedUserId, 
      song_id: normalizedSongId, 
      status_tag: nextStatus 
    }, { onConflict: 'user_id, song_id' })
    .select('status_tag')
    .single();

  if (error) {
    throw error;
  }

  return data?.status_tag || nextStatus;
}

export async function refreshSongStatusUi(songId) {
  if (!songStatusUi.button || !songStatusUi.container) return;
  if (!normalizedUserId) {
    songStatusUi.container.hidden = true;
    currentSongStatus = DEFAULT_STATUS;
    applyStatusStyles(songStatusUi.button, currentSongStatus);
    return;
  }

  if (!songId && songId !== 0) {
    songStatusUi.container.hidden = true;
    currentSongStatus = DEFAULT_STATUS;
    applyStatusStyles(songStatusUi.button, currentSongStatus);
    return;
  }

  const fetchToken = ++songStatusFetchToken;
  setSongStatusLoading(true);

  try {
    const statusTag = await fetchUserSongStatusTag(songId);
    if (songStatusFetchToken !== fetchToken) {
      return;
    }
    const val = Number(statusTag);
    currentSongStatus = STATUS_CYCLE.includes(val) ? val : DEFAULT_STATUS;
    applyStatusStyles(songStatusUi.button, currentSongStatus);
    songStatusUi.container.hidden = false;
  } catch (err) {
    console.error('Error obteniendo status_tag:', err);
    currentSongStatus = DEFAULT_STATUS;
    applyStatusStyles(songStatusUi.button, currentSongStatus);
    songStatusUi.container.hidden = true;
  } finally {
    if (songStatusFetchToken === fetchToken) {
      setSongStatusLoading(false);
    }
  }
}

export function initSongStatusControls() {
  if (!songStatusUi.button) {
    return;
  }

  applyStatusStyles(songStatusUi.button, currentSongStatus);
  songStatusUi.button.disabled = true;

  if (!normalizedUserId) {
    if (songStatusUi.container) {
      songStatusUi.container.hidden = true;
    }
    return;
  }

  if (songStatusClickBound) {
    return;
  }
  songStatusClickBound = true;

  songStatusUi.button.addEventListener('click', async (event) => {
    event.preventDefault();
    const songId = getCurrentSongId();
    if (!normalizedUserId || songId === null || songId === undefined) {
      return;
    }

    const currentStatus = Number(songStatusUi.button.dataset.status) || currentSongStatus || DEFAULT_STATUS;
    const nextStatus = getNextStatusTag(currentStatus);

    applyStatusStyles(songStatusUi.button, nextStatus);
    setSongStatusLoading(true);

    try {
      const persisted = await persistUserSongStatus(songId, nextStatus);
      const val = Number(persisted);
      currentSongStatus = STATUS_CYCLE.includes(val) ? val : DEFAULT_STATUS;
      applyStatusStyles(songStatusUi.button, currentSongStatus);
      if (songStatusUi.container) {
        songStatusUi.container.hidden = false;
      }
    } catch (err) {
      console.error('Error updating status_tag:', err);
      currentSongStatus = STATUS_CYCLE.includes(currentStatus) ? currentStatus : DEFAULT_STATUS;
      applyStatusStyles(songStatusUi.button, currentSongStatus);
    } finally {
      setSongStatusLoading(false);
    }
  });
}
