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
  getPreviousStatusTag,
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
let isLoadingSongs = false;
let pendingLoadSongs = false;
let suppressRealtimeRefresh = false; // Flag to suppress realtime refresh during local updates

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
  if (scrollContainer) {
    // Calculate position relative to the scroll container only
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offsetTop = targetRect.top - containerRect.top + scrollContainer.scrollTop;
    // Center the card in the visible area
    const centerOffset = offsetTop - (containerRect.height / 2) + (targetRect.height / 2);
    scrollContainer.scrollTo({ top: Math.max(centerOffset, 0), behavior: 'smooth' });
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

// Actualiza el estado del FAB según la cantidad de canciones
function updateFabState(songCount) {
  const body = document.body;
  
  // Remover clase de estado
  body.classList.remove('songs-empty');
  
  if (songCount === 0) {
    // Centrado
    body.classList.add('songs-empty');
  }
  // Si hay 1+ canciones: esquina inferior derecha (default, sin clase)
  
  // Mostrar el FAB
  const fab = document.getElementById('add-song-fab');
  if (fab) fab.classList.add('fab-ready');
}

// Exportar para uso en otros módulos
window.updateFabState = updateFabState;

// ============================================
// Persistencia de Status
// ============================================

// Status section configuration
const STATUS_SECTIONS = [
  { status: 1, label: 'Not started', icon: 'radio_button_unchecked' },
  { status: 2, label: 'Practicing', icon: 'pace' },
  { status: 3, label: 'Completed', icon: 'check_circle' }
];

/**
 * Move a song card to a different status section without reloading
 */
function moveSongToSection(songId, oldStatus, newStatus) {
  const container = document.getElementById('songs-container');
  if (!container) {
    console.error('moveSongToSection: container not found');
    return;
  }
  
  // Ensure statuses are numbers
  oldStatus = Number(oldStatus);
  newStatus = Number(newStatus);

  const songCard = container.querySelector(`a.song-card[data-song-id="${songId}"]`);
  if (!songCard) {
    console.error('moveSongToSection: songCard not found for id', songId);
    return;
  }

  const oldSection = container.querySelector(`.songs-section[data-status="${oldStatus}"]`);
  
  // Find or create the target section
  let targetSection = container.querySelector(`.songs-section[data-status="${newStatus}"]`);
  
  if (!targetSection) {
    // Need to create the section and header
    const sectionConfig = STATUS_SECTIONS.find(s => s.status === newStatus);
    if (!sectionConfig) {
      console.error('moveSongToSection: no config for status', newStatus);
      return;
    }
    
    // Create header
    const targetHeader = document.createElement('div');
    targetHeader.className = 'songs-section-header';
    targetHeader.dataset.status = newStatus;
    targetHeader.innerHTML = `
      <span class="material-symbols-outlined songs-section-icon songs-section-icon--${normalizeStatusTag(newStatus)}">${sectionConfig.icon}</span>
      <span class="songs-section-title">${sectionConfig.label}</span>
      <span class="songs-section-count">0</span>
    `;
    
    // Create section container
    targetSection = document.createElement('div');
    targetSection.className = 'songs-section';
    targetSection.dataset.status = newStatus;
    
    // Insert in correct order (by status number)
    // Find the first section with a higher status number
    const allSections = Array.from(container.querySelectorAll('.songs-section[data-status]'));
    let insertBeforeSection = null;
    
    for (const section of allSections) {
      const sectionStatus = Number(section.dataset.status);
      if (sectionStatus > newStatus) {
        insertBeforeSection = section;
        break;
      }
    }
    
    if (insertBeforeSection) {
      // Find the header that comes before this section
      const headerBeforeSection = insertBeforeSection.previousElementSibling;
      // Insert our header and section before the found header
      container.insertBefore(targetHeader, headerBeforeSection);
      container.insertBefore(targetSection, headerBeforeSection);
    } else {
      // Append at the end
      container.appendChild(targetHeader);
      container.appendChild(targetSection);
    }
  }
  
  // Move the card to the target section (sorted alphabetically by title)
  const songTitle = songCard.querySelector('.song-title')?.textContent?.toLowerCase() || '';
  const existingCards = Array.from(targetSection.querySelectorAll('.song-card'));
  let insertBefore = null;
  
  for (const card of existingCards) {
    const cardTitle = card.querySelector('.song-title')?.textContent?.toLowerCase() || '';
    if (cardTitle > songTitle) {
      insertBefore = card;
      break;
    }
  }
  
  if (insertBefore) {
    targetSection.insertBefore(songCard, insertBefore);
  } else {
    targetSection.appendChild(songCard);
  }
  
  // Now update the card's arrow buttons for the new status
  const arrowsContainer = songCard.querySelector('.song-status-arrows');
  if (arrowsContainer) {
    arrowsContainer.dataset.status = newStatus;
    const upBtn = arrowsContainer.querySelector('.song-arrow-btn--up');
    const downBtn = arrowsContainer.querySelector('.song-arrow-btn--down');
    if (upBtn) upBtn.disabled = newStatus <= 1;
    if (downBtn) downBtn.disabled = newStatus >= 3;
  }
  
  // Update section counts
  updateSectionCount(container, oldStatus);
  updateSectionCount(container, newStatus);
  
  // Remove empty old section
  if (oldSection && oldSection.children.length === 0) {
    const oldHeader = container.querySelector(`.songs-section-header[data-status="${oldStatus}"]`);
    if (oldHeader) oldHeader.remove();
    oldSection.remove();
  }
  
  // Smooth scroll to the moved card
  setTimeout(() => scrollSongIntoView(songId), 100);
}

/**
 * Update the count badge for a status section
 */
function updateSectionCount(container, status) {
  const section = container.querySelector(`.songs-section[data-status="${status}"]`);
  const header = container.querySelector(`.songs-section-header[data-status="${status}"]`);
  if (section && header) {
    const count = section.querySelectorAll('.song-card').length;
    const countEl = header.querySelector('.songs-section-count');
    if (countEl) countEl.textContent = count;
  }
}

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
  
  // Prevent concurrent loads - queue a refresh if already loading
  if (isLoadingSongs) {
    pendingLoadSongs = true;
    return;
  }
  
  isLoadingSongs = true;
  pendingLoadSongs = false;
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
      
      // Update the set of user's song IDs for realtime filtering
      userSongIdsSet = new Set(songIds);
      
      (userSongs || []).forEach(record => {
        if (!record || !record.song_id) return;
        statusBySongId.set(record.song_id, record.status_tag || DEFAULT_STATUS);
      });
      if (!songIds.length) {
        container.innerHTML = '';
        updateFabState(0);
        return;
      }
      document.body.classList.remove('songs-empty');

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

    // Actualizar estado del FAB según cantidad de canciones
    updateFabState(songs.length);

    // Group songs by status
    const songsByStatus = {
      1: [], // No iniciado
      2: [], // En práctica
      3: []  // Completado
    };

    songs.forEach(song => {
      if (!song || !song.id) return;
      const statusTag = statusBySongId.get(song.id) || DEFAULT_STATUS;
      if (songsByStatus[statusTag]) {
        songsByStatus[statusTag].push({ ...song, statusTag });
      } else {
        songsByStatus[DEFAULT_STATUS].push({ ...song, statusTag: DEFAULT_STATUS });
      }
    });

    // Render each status section
    const statusSections = [
      { status: 1, label: 'Not started', icon: 'radio_button_unchecked' },
      { status: 2, label: 'Practicing', icon: 'pace' },
      { status: 3, label: 'Completed', icon: 'check_circle' }
    ];

    statusSections.forEach(({ status, label, icon }) => {
      const sectionSongs = songsByStatus[status];
      if (!sectionSongs || sectionSongs.length === 0) return;

      // Create section header
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'songs-section-header';
      sectionHeader.dataset.status = status;
      sectionHeader.innerHTML = `
        <span class="material-symbols-outlined songs-section-icon songs-section-icon--${normalizeStatusTag(status)}">${icon}</span>
        <span class="songs-section-title">${label}</span>
        <span class="songs-section-count">${sectionSongs.length}</span>
      `;
      container.appendChild(sectionHeader);

      // Create section container for songs
      const sectionContainer = document.createElement('div');
      sectionContainer.className = 'songs-section';
      sectionContainer.dataset.status = status;

      sectionSongs.forEach(song => {
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
        const statusTag = song.statusTag;
        const canMoveUp = statusTag > 1;
        const canMoveDown = statusTag < 3;
        const statusArrowsHtml = selectedUserId
          ? `<div class="song-status-arrows" data-song-id="${song.id}" data-status="${statusTag}">
              <button type="button" class="song-arrow-btn song-arrow-btn--up" ${!canMoveUp ? 'disabled' : ''} title="Move to previous status">
                <span class="material-symbols-outlined">keyboard_arrow_up</span>
              </button>
              <button type="button" class="song-arrow-btn song-arrow-btn--down" ${!canMoveDown ? 'disabled' : ''} title="Move to next status">
                <span class="material-symbols-outlined">keyboard_arrow_down</span>
              </button>
            </div>`
          : '';
        songElement.innerHTML = `
          <div class="song-info">
            <p class="song-title">${songTitle}</p>
            <p class="song-artist">${artistName}</p>
          </div>
          ${statusArrowsHtml}
        `;
        
        if (selectedUserId) {
          const deleteBtn = createDeleteButton(song.id);
          songElement.appendChild(deleteBtn);
        }
        
        songElement.addEventListener('click', (e) => {
          if (e.target.closest('.song-delete-btn') || e.target.closest('.song-status-arrows')) {
            return;
          }
          exitEraseMode();
        });
        
        const arrowsContainer = songElement.querySelector('.song-status-arrows');
        if (arrowsContainer && selectedUserId) {
          const upBtn = arrowsContainer.querySelector('.song-arrow-btn--up');
          const downBtn = arrowsContainer.querySelector('.song-arrow-btn--down');
          
          const handleStatusChange = async (oldStatus, newStatus) => {
            upBtn.disabled = true;
            downBtn.disabled = true;
            
            // Suppress realtime refresh during local update
            suppressRealtimeRefresh = true;
            
            try {
              const persistedStatus = await persistStatusTag(song.id, newStatus);
              statusBySongId.set(song.id, persistedStatus);
              moveSongToSection(song.id, oldStatus, persistedStatus);
            } catch (err) {
              console.error('Error updating status_tag:', err);
              // Re-enable buttons on error
              upBtn.disabled = oldStatus <= 1;
              downBtn.disabled = oldStatus >= 3;
            } finally {
              // Re-enable realtime refresh after a short delay
              setTimeout(() => {
                suppressRealtimeRefresh = false;
              }, 500);
            }
          };
          
          if (upBtn) {
            upBtn.addEventListener('click', async (event) => {
              event.preventDefault();
              event.stopPropagation();
              const currentStatus = Number(arrowsContainer.dataset.status) || DEFAULT_STATUS;
              const prevStatus = getPreviousStatusTag(currentStatus);
              if (prevStatus < currentStatus) {
                await handleStatusChange(currentStatus, prevStatus);
              }
            });
          }
          
          if (downBtn) {
            downBtn.addEventListener('click', async (event) => {
              event.preventDefault();
              event.stopPropagation();
              const currentStatus = Number(arrowsContainer.dataset.status) || DEFAULT_STATUS;
              const nextStatus = getNextStatusTag(currentStatus);
              if (nextStatus > currentStatus) {
                await handleStatusChange(currentStatus, nextStatus);
              }
            });
          }
        }
        sectionContainer.appendChild(songElement);
      });

      container.appendChild(sectionContainer);
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
  } finally {
    isLoadingSongs = false;
    // If another load was requested while we were loading, do it now
    if (pendingLoadSongs) {
      pendingLoadSongs = false;
      loadSongs();
    }
  }
}

// ============================================
// Realtime
// ============================================

// Track which song IDs the current user has (for filtering realtime updates)
let userSongIdsSet = new Set();

function scheduleSongsRefresh() {
  // Skip refresh if suppressed (during local status updates)
  if (suppressRealtimeRefresh) return;
  
  if (songsRefreshTimeoutId) {
    clearTimeout(songsRefreshTimeoutId);
  }
  songsRefreshTimeoutId = setTimeout(() => {
    songsRefreshTimeoutId = null;
    loadSongs();
  }, 150);
}

// Handle songs table changes - only refresh if user has that song
function handleSongsTableChange(payload) {
  const changedSongId = payload.old?.id || payload.new?.id;
  
  // If we can't determine the song ID, refresh to be safe
  if (!changedSongId) {
    scheduleSongsRefresh();
    return;
  }
  
  // Only refresh if user has this song in their list
  if (userSongIdsSet.has(changedSongId)) {
    scheduleSongsRefresh();
  }
}

// Handle artists table changes - only refresh if user has a song by that artist
// For simplicity, we refresh on artist changes since it's rare and affects song display
function handleArtistsTableChange() {
  // Artist changes are rare, just refresh if user has any songs
  if (userSongIdsSet.size > 0) {
    scheduleSongsRefresh();
  }
}

function initSongsRealtime() {
  const channel = supabase
    .channel('songs_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'songs' }, handleSongsTableChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'artists' }, handleArtistsTableChange);
  
  // Only listen to user_songs changes for the current user
  if (selectedUserId) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_songs', filter: `user_id=eq.${selectedUserId}` },
      scheduleSongsRefresh
    );
  }

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
