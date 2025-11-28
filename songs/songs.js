// ============================================
// Archivo principal de Songs
// Maneja: carga de canciones, estado, navegación
// ============================================

import {
  STATUS_MAP,
  STATUS_CYCLE,
  DEFAULT_STATUS,
  normalizeStatusTag,
  getNextStatusTag,
  applyStatusStyles
} from '../audios/status.js';

import {
  initEraseMode,
  createDeleteButton,
  refreshEraseMode,
  exitEraseMode
} from './erase.js';

import { initCreateModule } from './create.js';

import {
  initAddModule,
  initAddSongModal,
  updateModalButtonsDisabledState
} from './add.js';

// ============================================
// Configuración y Estado
// ============================================

const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const urlParams = new URLSearchParams(window.location.search);

function getStoredUserId() {
  try {
    const raw = window.localStorage.getItem('usuarios:authorizedProfile');
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload?.userId || null;
  } catch (e) {
    return null;
  }
}

const selectedUserId = urlParams.get('id') || getStoredUserId();
let songsRefreshTimeoutId = null;
let pendingScrollSongId = null;

// ============================================
// Funciones de UI
// ============================================

function scrollSongIntoView(songId, attempt = 0) {
  if (!songId || attempt > 5) return;
  const selector = `[data-song-id="${songId}"]`;
  const rawTarget = document.querySelector(selector);
  const target = rawTarget?.classList?.contains('song-card') ? rawTarget : rawTarget?.closest('.song-card') || rawTarget;
  if (!target) {
    setTimeout(() => scrollSongIntoView(songId, attempt + 1), 120);
    return;
  }
  const scrollContainer = document.getElementById('songs-scroll');
  if (scrollContainer && typeof target.scrollIntoView === 'function') {
    try {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {
      const offsetTop = target.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
      scrollContainer.scrollTo({ top: Math.max(offsetTop - 40, 0), behavior: 'smooth' });
    }
  } else if (scrollContainer) {
    const offsetTop = target.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
    scrollContainer.scrollTo({ top: Math.max(offsetTop - 40, 0), behavior: 'smooth' });
  }

  target.classList.add('song-card--recent');
  setTimeout(() => target.classList.remove('song-card--recent'), 1600);
}

async function updateSongsTitle() {
  const titleEl = document.querySelector('#site-header h1');
  if (!titleEl) return;
  
  titleEl.innerHTML = '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>';
  
  if (!selectedUserId) {
    titleEl.textContent = 'Canciones';
    return;
  }
  try {
    const { data, error } = await supabase
      .from('users')
      .select('name')
      .eq('id', selectedUserId)
      .single();
    if (!error && data && data.name) {
      titleEl.textContent = `Hola, ${data.name}`;
    } else {
      titleEl.textContent = 'Canciones';
    }
  } catch (err) {
    console.warn('No se pudo obtener el nombre del usuario para el título:', err);
    titleEl.textContent = 'Canciones';
  }
}

function adjustSongsContainerPadding() {
  const header = document.getElementById('site-header');
  const container = document.getElementById('songs-container');
  if (!header || !container) return;
  const scrollWrapper = document.getElementById('songs-scroll');
  if (scrollWrapper) {
    scrollWrapper.style.visibility = 'hidden';
    requestAnimationFrame(() => { scrollWrapper.style.visibility = 'visible'; });
  }
  header.style.zIndex = 30;
}

// ============================================
// Persistencia de Status
// ============================================

async function persistStatusTag(songId, nextStatus) {
  const query = supabase
    .from('user_songs')
    .update({ status_tag: nextStatus })
    .eq('user_id', selectedUserId)
    .eq('song_id', songId)
    .select('song_id, status_tag')
    .maybeSingle();

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('No matching user_songs row was updated.');
  }
  return data.status_tag || nextStatus;
}

// ============================================
// Carga de Canciones
// ============================================

async function loadSongs() {
  const container = document.getElementById('songs-container');
  if (!container) return;
  container.innerHTML = '';

  try {
    let songs = null;
    const statusBySongId = new Map();

    if (selectedUserId) {
      const { data: userSongs, error: usErr } = await supabase
        .from('user_songs')
        .select('song_id, status_tag')
        .eq('user_id', selectedUserId);

      if (usErr) {
        console.error('Error loading user_songs:', usErr);
        return;
      }

      const songIds = (userSongs || []).map(r => r.song_id).filter(Boolean);
      (userSongs || []).forEach(record => {
        if (!record || !record.song_id) return;
        statusBySongId.set(record.song_id, record.status_tag || DEFAULT_STATUS);
      });
      if (!songIds.length) {
        container.innerHTML = '<p class="text-gray-400 p-4">No hay canciones para este usuario.</p>';
        return;
      }

      const { data, error } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          artists ( name )
        `)
        .in('id', songIds);

      if (error) {
        console.error(error);
        return;
      }
      songs = data;
    } else {
      const { data, error } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          artists ( name )
        `);
      if (error) {
        console.error(error);
        return;
      }
      songs = data;
    }

    if (songs && songs.length > 0) {
      songs.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB);
      });
    }

    songs.forEach(song => {
      if (!song || !song.id) return;
      const songTitle = song.title;
      if (!songTitle) return;
      const artistName = song.artists?.name || '';
      const songElement = document.createElement('a');
      songElement.dataset.songId = song.id;
      const audioParams = new URLSearchParams({ songId: song.id, title: songTitle });
      if (selectedUserId) {
        audioParams.set('id', selectedUserId);
      }
      songElement.href = `../audios/audios.html?${audioParams.toString()}`;
      songElement.className = 'song-card';
      const statusTag = statusBySongId.get(song.id) || DEFAULT_STATUS;
      const statusClassSuffix = normalizeStatusTag(statusTag);
      const statusLabel = STATUS_MAP[statusTag] || STATUS_MAP[DEFAULT_STATUS];
      const statusButtonHtml = selectedUserId
        ? `<button type="button" class="song-status-button song-status-button--${statusClassSuffix}" data-song-id="${song.id}" data-status="${statusTag}">${statusLabel}</button>`
        : '';
      songElement.innerHTML = `
        <div class="song-info">
          <p class="song-title">${songTitle}</p>
          <p class="song-artist">${artistName}</p>
        </div>
        ${statusButtonHtml}
      `;
      
      if (selectedUserId) {
        const deleteBtn = createDeleteButton(song.id);
        songElement.appendChild(deleteBtn);
      }
      
      songElement.addEventListener('click', (e) => {
        if (e.target.closest('.song-delete-btn') || e.target.closest('.song-status-button')) {
          return;
        }
        exitEraseMode();
      });
      
      const statusButton = songElement.querySelector('.song-status-button');
      if (statusButton && selectedUserId) {
        applyStatusStyles(statusButton, statusTag);
        statusButton.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const currentStatus = Number(statusButton.dataset.status) || DEFAULT_STATUS;
          const nextStatus = getNextStatusTag(currentStatus);
          statusButton.disabled = true;
          applyStatusStyles(statusButton, nextStatus);
          try {
            const persistedStatus = await persistStatusTag(song.id, nextStatus);
            applyStatusStyles(statusButton, persistedStatus);
            statusBySongId.set(song.id, persistedStatus);
          } catch (err) {
            console.error('Error updating status_tag:', err);
            applyStatusStyles(statusButton, currentStatus);
          } finally {
            statusButton.disabled = false;
          }
        });
      }
      container.appendChild(songElement);
    });

    if (pendingScrollSongId) {
      const targetId = pendingScrollSongId;
      pendingScrollSongId = null;
      requestAnimationFrame(() => {
        scrollSongIntoView(targetId);
      });
    }

    refreshEraseMode();
  } catch (err) {
    console.error('Error in loadSongs:', err);
  }
}

// ============================================
// Realtime
// ============================================

function scheduleSongsRefresh() {
  if (songsRefreshTimeoutId) {
    clearTimeout(songsRefreshTimeoutId);
  }
  songsRefreshTimeoutId = setTimeout(() => {
    songsRefreshTimeoutId = null;
    loadSongs();
  }, 150);
}

function initSongsRealtime() {
  const channel = supabase
    .channel('songs_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'canciones' }, scheduleSongsRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'artists' }, scheduleSongsRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_songs' }, scheduleSongsRefresh);

  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR') {
      console.error('Error suscribiendo al canal de canciones en tiempo real');
    }
  });
}

// ============================================
// Inicialización
// ============================================

window.addEventListener('load', adjustSongsContainerPadding);
window.addEventListener('resize', adjustSongsContainerPadding);

// Inicializar módulo de crear canciones
initCreateModule({
  supabase: supabase,
  userId: selectedUserId
});

// Inicializar módulo de agregar canciones
initAddModule({
  supabase: supabase,
  userId: selectedUserId,
  loadSongs: loadSongs,
  onSongsAdded: (songIds, scrollToId) => {
    if (scrollToId) {
      pendingScrollSongId = scrollToId;
    }
    console.log('Canciones añadidas:', songIds);
  }
});

// Cargar canciones y título
loadSongs();
updateSongsTitle();
updateModalButtonsDisabledState();

// Inicializar modal de agregar canciones
initAddSongModal(exitEraseMode);

// Inicializar realtime
initSongsRealtime();

// Inicializar modo borrado
initEraseMode({
  supabase: supabase,
  userId: selectedUserId,
  onSongDeleted: (songId) => {
    console.log('Canción eliminada de la lista:', songId);
  }
});

// Botón volver
document.addEventListener('DOMContentLoaded', function () {
  const backBtn = document.getElementById('back-button');
  if (!backBtn) return;
  backBtn.addEventListener('click', function (e) {
    e.preventDefault();
    exitEraseMode();
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || selectedUserId;
    const target = id ? `../index.html?id=${encodeURIComponent(id)}` : '../index.html';
    window.location.replace(target);
  });
});
