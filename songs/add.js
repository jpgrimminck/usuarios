// ============================================
// Módulo para agregar canciones existentes a la lista del usuario
// ============================================

import { createSong } from './create.js';
import { DEFAULT_STATUS } from '../audios/status.js';

let supabaseClient = null;
let selectedUserId = null;

// Estado del modal
const selectedLibrarySongs = new Map();
let modalWorking = false;
let modalSongsFetchToken = 0;
let defaultCreateFormParent = null;
let createFieldElements = [];
let toggleButtonDefaultParent = null;
let lastCreatedSongId = null;
let pendingSuggestedScrollSongId = null;

// Callbacks
let onSongsAdded = null;
let loadSongsCallback = null;
let isFirstTimeModal = false;

export function initAddModule(options = {}) {
  supabaseClient = options.supabase || null;
  selectedUserId = options.userId || null;
  onSongsAdded = typeof options.onSongsAdded === 'function' ? options.onSongsAdded : null;
  loadSongsCallback = typeof options.loadSongs === 'function' ? options.loadSongs : null;
}

export function getSelectedLibrarySongs() {
  return selectedLibrarySongs;
}

export function clearSelectedLibrarySongs() {
  selectedLibrarySongs.clear();
}

export function getLastCreatedSongId() {
  return lastCreatedSongId;
}

export function setLastCreatedSongId(id) {
  lastCreatedSongId = id;
}

export function setPendingSuggestedScrollSongId(id) {
  pendingSuggestedScrollSongId = id;
}

function getModalElements() {
  return {
    createButton: document.getElementById('create-new-song'),
    addButton: document.getElementById('add-selected-songs'),
    titleInput: document.getElementById('new-song-title'),
    artistInput: document.getElementById('new-song-artist'),
    toggleButton: document.getElementById('toggle-create-song'),
    createForm: document.getElementById('create-song-form'),
    createFieldsSlot: document.getElementById('create-song-fields-slot'),
    toggleBackSlot: document.getElementById('create-mode-back-slot'),
    modalTitle: document.querySelector('#add-song-modal h2'),
    dialog: document.querySelector('.add-song-modal__dialog'),
    suggestedList: document.getElementById('suggested-songs-container'),
    actionsContainer: document.querySelector('.suggested-actions')
  };
}

function focusCreateSongTitle(options = {}) {
  const { preventScroll = false } = options;
  const { titleInput, dialog } = getModalElements();
  if (!titleInput || titleInput.disabled) return;

  if (dialog) {
    dialog.scrollTop = 0;
  }
  const overlay = document.getElementById('add-song-modal');
  if (overlay) {
    try {
      overlay.scrollTo({ top: 0, behavior: 'auto' });
    } catch (_) {
      overlay.scrollTop = 0;
    }
  }

  try {
    if (preventScroll) {
      titleInput.focus({ preventScroll: true });
    } else {
      titleInput.focus();
    }
  } catch (_) {
    titleInput.focus();
  }

  if (titleInput.scrollIntoView) {
    try {
      titleInput.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch (_) {
      titleInput.scrollIntoView();
    }
  }
}

function queueFocusOnCreateSongTitle() {
  const attempt = () => focusCreateSongTitle({ preventScroll: false });
  attempt();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(attempt);
  }
  setTimeout(attempt, 140);
  setTimeout(attempt, 320);
}

export function updateModalButtonsDisabledState() {
  const { createButton, addButton, titleInput, artistInput, toggleButton, createForm } = getModalElements();
  if (createButton) {
    createButton.disabled = modalWorking;
  }
  if (titleInput) {
    titleInput.disabled = modalWorking;
  }
  if (artistInput) {
    artistInput.disabled = modalWorking;
  }
  if (addButton) {
    addButton.disabled = modalWorking || !selectedUserId || selectedLibrarySongs.size === 0;
  }
  if (toggleButton && addButton) {
    const hasSelection = selectedLibrarySongs.size > 0;
    const isCreateMode = createForm && !createForm.hidden;

    // Si es primera vez, siempre ocultar el botón crear
    if (isFirstTimeModal) {
      toggleButton.hidden = true;
      toggleButton.style.display = 'none';
      toggleButton.setAttribute('aria-hidden', 'true');
      
      addButton.hidden = !hasSelection;
      addButton.style.display = hasSelection ? '' : 'none';
      addButton.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
      return;
    }

    const showToggle = isCreateMode || !hasSelection;
    const showAddButton = !isCreateMode && hasSelection;

    toggleButton.hidden = !showToggle;
    toggleButton.style.display = showToggle ? '' : 'none';
    toggleButton.setAttribute('aria-hidden', showToggle ? 'false' : 'true');

    addButton.hidden = !showAddButton;
    addButton.style.display = showAddButton ? '' : 'none';
    addButton.setAttribute('aria-hidden', showAddButton ? 'false' : 'true');
  }
}

export function setCreateMode(enable) {
  const {
    toggleButton,
    addButton,
    createForm,
    suggestedList,
    titleInput,
    artistInput,
    modalTitle,
    dialog,
    createFieldsSlot,
    toggleBackSlot
  } = getModalElements();

  const shouldEnable = !!enable;

  if (createForm && createFieldElements.length === 0) {
    createFieldElements = Array.from(createForm.querySelectorAll('.suggested-field'));
  }

  if (toggleButton && !toggleButtonDefaultParent) {
    toggleButtonDefaultParent = toggleButton.parentElement;
  }

  if (dialog) {
    dialog.classList.toggle('add-song-modal__dialog--create', shouldEnable);
  }

  if (suggestedList) {
    suggestedList.style.display = shouldEnable ? 'none' : '';
  }

  if (createForm) {
    if (!defaultCreateFormParent) {
      defaultCreateFormParent = createForm.parentElement;
    }
    createForm.hidden = !shouldEnable;
  }

  if (shouldEnable && createFieldsSlot && createFieldElements.length) {
    createFieldsSlot.hidden = false;
    createFieldElements.forEach(field => {
      if (!createFieldsSlot.contains(field)) {
        createFieldsSlot.appendChild(field);
      }
    });
  }

  if (!shouldEnable && createFieldsSlot && createFieldElements.length && createForm) {
    createFieldsSlot.hidden = true;
    const referenceNode = addButton && createForm.contains(addButton) ? addButton : null;
    createFieldElements.forEach(field => {
      if (!createForm.contains(field)) {
        createForm.insertBefore(field, referenceNode);
      }
    });
  }

  if (!shouldEnable && createFieldsSlot) {
    createFieldsSlot.hidden = true;
  }

  if (shouldEnable && toggleButton && toggleBackSlot) {
    toggleBackSlot.hidden = false;
    if (!toggleBackSlot.contains(toggleButton)) {
      toggleBackSlot.appendChild(toggleButton);
    }
  }

  if (!shouldEnable && toggleButton && toggleButtonDefaultParent) {
    if (toggleBackSlot) {
      toggleBackSlot.hidden = true;
    }
    if (toggleButtonDefaultParent.contains(toggleButton)) {
      // already in place
    } else {
      const firstChild = toggleButtonDefaultParent.firstChild;
      toggleButtonDefaultParent.insertBefore(toggleButton, firstChild);
    }
  }

  if (modalTitle) {
    modalTitle.style.display = '';
    modalTitle.setAttribute('aria-hidden', 'false');
    modalTitle.textContent = shouldEnable ? 'Crear Canción' : 'Otras Canciones';
  }

  if (addButton && shouldEnable) {
    addButton.hidden = true;
    addButton.style.display = 'none';
    addButton.setAttribute('aria-hidden', 'true');
  }

  if (toggleButton) {
    toggleButton.hidden = false;
    toggleButton.style.display = '';
    toggleButton.setAttribute('aria-hidden', 'false');
    const icon = toggleButton.querySelector('.material-symbols-outlined');
    const text = toggleButton.querySelector('span:last-child');
    if (text) {
      text.style.display = shouldEnable ? 'none' : '';
      if (!shouldEnable) {
        text.textContent = 'Crear Canción';
      }
    }
    if (icon) {
      icon.textContent = shouldEnable ? 'arrow_back' : 'add';
    }
    toggleButton.setAttribute('aria-label', shouldEnable ? 'Back to songs list' : 'Create a new song');
    toggleButton.classList.toggle('suggested-toggle-create--back', shouldEnable);
  }

  if (shouldEnable) {
    queueFocusOnCreateSongTitle();
  } else {
    if (titleInput) {
      titleInput.blur();
    }
    if (artistInput) {
      artistInput.blur();
    }
  }

  updateModalButtonsDisabledState();
}

export function setModalWorkingState(isWorking) {
  modalWorking = !!isWorking;
  updateModalButtonsDisabledState();
}

export function resetNewSongForm() {
  const { titleInput, artistInput, createButton } = getModalElements();
  if (titleInput) {
    titleInput.value = '';
  }
  if (artistInput) {
    artistInput.value = '';
  }
  if (createButton) {
    createButton.classList.remove('suggested-secondary--active');
  }
  setCreateMode(false);
  lastCreatedSongId = null;
}

function scrollSuggestedSongIntoView(songKey, attempt = 0) {
  if (!songKey || attempt > 5) return;
  const keyString = String(songKey);
  const container = document.getElementById('suggested-songs-container');
  let target = null;
  if (container) {
    target = Array.from(container.children).find(node => node?.dataset?.suggestedSongId === keyString) || null;
  }
  if (!target) {
    target = document.querySelector(`[data-suggested-song-id="${keyString.replace(/"/g, '\"')}"]`);
  }
  if (!target) {
    setTimeout(() => scrollSuggestedSongIntoView(songKey, attempt + 1), 110);
    return;
  }

  const wrapper = document.querySelector('.suggested-wrapper');
  const scrollArea = wrapper || container;
  if (scrollArea && typeof target.scrollIntoView === 'function') {
    try {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {
      const base = scrollArea.getBoundingClientRect();
      const offsetTop = target.getBoundingClientRect().top - base.top + scrollArea.scrollTop;
      scrollArea.scrollTo({ top: Math.max(offsetTop - 32, 0), behavior: 'smooth' });
    }
  } else if (scrollArea) {
    const base = scrollArea.getBoundingClientRect();
    const offsetTop = target.getBoundingClientRect().top - base.top + scrollArea.scrollTop;
    scrollArea.scrollTo({ top: Math.max(offsetTop - 32, 0), behavior: 'smooth' });
  }

  target.classList.add('suggested-card--recent');
  setTimeout(() => target.classList.remove('suggested-card--recent'), 1400);
}

export function renderSuggestedSongs(onSelect) {
  const container = document.getElementById('suggested-songs-container');
  if (!container) return;
  container.innerHTML = '';
  updateModalButtonsDisabledState();
  
  const sourceSongs = renderSuggestedSongs._lastList || [];
  const sortedSongs = [...sourceSongs].sort((a, b) => {
    const aTitle = (a.title || '').toString();
    const bTitle = (b.title || '').toString();
    return aTitle.localeCompare(bTitle, 'es', { sensitivity: 'base' });
  });

  sortedSongs.forEach((song) => {
    const card = document.createElement('div');
    card.className = 'suggested-card';
    const songId = song.id;
    const key = songId ?? (song.title || '');
    card.dataset.suggestedSongId = String(key);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'suggested-title';
    const songTitle = song.title || '';
    titleSpan.textContent = songTitle;

    const artistSpan = document.createElement('span');
    artistSpan.className = 'suggested-artist';
    artistSpan.textContent = song.artist || song.artists?.name || '';

    const addButton = document.createElement('button');
    addButton.className = 'suggested-add';
    addButton.type = 'button';
    addButton.setAttribute('aria-pressed', 'false');
    addButton.innerHTML = '<span class="material-symbols-outlined">add</span>';

    if (selectedLibrarySongs.has(key)) {
      addButton.classList.add('suggested-add--selected');
      addButton.setAttribute('aria-pressed', 'true');
      const iconSpanInit = addButton.querySelector('.material-symbols-outlined');
      if (iconSpanInit) iconSpanInit.textContent = 'check';
    }

    addButton.addEventListener('click', () => {
      const iconSpan = addButton.querySelector('.material-symbols-outlined');
      const existingTimeout = addButton.dataset.animTimeout;

      if (existingTimeout) {
        clearTimeout(Number(existingTimeout));
        delete addButton.dataset.animTimeout;
      }

      const wasSelected = addButton.classList.contains('suggested-add--selected');
      if (wasSelected) {
        addButton.classList.remove('suggested-add--selected', 'suggested-add--animating');
        addButton.setAttribute('aria-pressed', 'false');
        if (iconSpan) {
          iconSpan.textContent = 'add';
        }
        selectedLibrarySongs.delete(key);
        if (typeof onSelect === 'function') {
          onSelect(null);
        }
        updateModalButtonsDisabledState();
        return;
      }

      addButton.classList.add('suggested-add--animating');
      addButton.setAttribute('aria-pressed', 'true');

      if (iconSpan) {
        iconSpan.textContent = 'check';
      }

      if (typeof onSelect === 'function') {
        onSelect(song);
      }

      selectedLibrarySongs.set(key, { id: songId, title: songTitle, artist: song.artist || song.artists?.name || '' });

      void addButton.offsetWidth;
      addButton.classList.add('suggested-add--selected');

      const timeoutId = setTimeout(() => {
        addButton.classList.remove('suggested-add--animating');
        delete addButton.dataset.animTimeout;
      }, 320);

      addButton.dataset.animTimeout = String(timeoutId);

      updateModalButtonsDisabledState();
    });

    card.appendChild(titleSpan);
    card.appendChild(artistSpan);
    card.appendChild(addButton);
    container.appendChild(card);
  });

  if (pendingSuggestedScrollSongId) {
    const targetKey = pendingSuggestedScrollSongId;
    pendingSuggestedScrollSongId = null;
    requestAnimationFrame(() => {
      scrollSuggestedSongIntoView(targetKey);
    });
  }
}

// Fetch songs from the 'songs' table (library)
export async function fetchLibrarySongs() {
  try {
    const { data, error } = await supabaseClient
      .from('songs')
      .select(`id, title, artists ( name )`)
      .order('title', { ascending: true });
    if (error) {
      console.error('Error fetching library songs:', error);
      return [];
    }
    
    let allSongs = data || [];
    
    // If a user is selected, filter out songs they already have
    if (selectedUserId && allSongs.length > 0) {
      const songIds = allSongs.map(s => s.id).filter(Boolean);
      
      const { data: userSongs, error: userSongsError } = await supabaseClient
        .from('user_songs')
        .select('song_id')
        .eq('user_id', selectedUserId)
        .in('song_id', songIds);
      
      if (userSongsError) {
        console.error('Error fetching user songs:', userSongsError);
        return allSongs;
      }
      
      const userSongIds = new Set((userSongs || []).map(us => us.song_id));
      allSongs = allSongs.filter(song => !userSongIds.has(song.id));
    }
    
    return allSongs;
  } catch (err) {
    console.error('Unexpected error fetching library songs:', err);
    return [];
  }
}

function resetViewportZoom() {
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=10.0, user-scalable=yes');
    
    setTimeout(() => {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }, 50);
  }
  
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

export function initAddSongModal(exitEraseMode) {
  const fab = document.getElementById('add-song-fab');
  const modal = document.getElementById('add-song-modal');
  const closeBtn = document.getElementById('add-song-close');

  if (!fab || !modal) return;

  const addSelectedButton = document.getElementById('add-selected-songs');
  const createSongButton = document.getElementById('create-new-song');
  const newSongTitleInput = document.getElementById('new-song-title');
  const newSongArtistInput = document.getElementById('new-song-artist');
  const toggleCreateButton = document.getElementById('toggle-create-song');
  const createSongForm = document.getElementById('create-song-form');

  function updateCreateButtonState() {
    if (!createSongButton || !newSongTitleInput || !newSongArtistInput) return;
    const title = newSongTitleInput.value.trim();
    const artist = newSongArtistInput.value.trim();
    if (title && artist) {
      createSongButton.classList.add('suggested-secondary--active');
    } else {
      createSongButton.classList.remove('suggested-secondary--active');
    }
  }

  if (newSongTitleInput) {
    newSongTitleInput.addEventListener('input', updateCreateButtonState);
  }
  if (newSongArtistInput) {
    newSongArtistInput.addEventListener('input', updateCreateButtonState);
  }

  const handleSuggestionSelect = (song) => {
    if (!song) return;
    console.log('Seleccionar canción sugerida:', song.title, '/', song.artist);
  };

  async function openModal() {
    if (typeof exitEraseMode === 'function') {
      exitEraseMode();
    }
    
    // Mostrar loading en el FAB
    fab.classList.add('fab-loading');
    
    setModalWorkingState(false);
    setCreateMode(false);
    
    // Detectar si es primera vez (lista vacía)
    isFirstTimeModal = document.body.classList.contains('songs-empty');
    const modalTitle = document.querySelector('#add-song-modal h2');
    
    // Ajustar título según si es primera vez
    if (modalTitle) {
      modalTitle.textContent = isFirstTimeModal 
        ? 'Agrega tu primera canción para empezar a practicar' 
        : 'Otras Canciones';
    }
    
    const fetchToken = ++modalSongsFetchToken;
    try {
      const list = await fetchLibrarySongs();
      if (modalSongsFetchToken !== fetchToken) {
        fab.classList.remove('fab-loading');
        return;
      }
      renderSuggestedSongs._lastList = list.length ? list : [];
      renderSuggestedSongs(handleSuggestionSelect);
    } catch {
      if (modalSongsFetchToken !== fetchToken) {
        fab.classList.remove('fab-loading');
        return;
      }
      renderSuggestedSongs._lastList = [];
      renderSuggestedSongs(handleSuggestionSelect);
    }
    
    // Quitar loading del FAB
    fab.classList.remove('fab-loading');
    
    updateModalButtonsDisabledState();
    modal.classList.remove('hidden');
    
    // Resetear scroll al inicio
    const suggestedContainer = document.getElementById('suggested-songs-container');
    if (suggestedContainer) {
      suggestedContainer.scrollTop = 0;
    }
  }

  function closeModal() {
    modal.classList.add('hidden');
    selectedLibrarySongs.clear();
    resetNewSongForm();
    setModalWorkingState(false);
    isFirstTimeModal = false;
    resetViewportZoom();
  }

  fab.addEventListener('click', openModal);

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  if (toggleCreateButton) {
    toggleCreateButton.addEventListener('click', () => {
      const isCreateMode = createSongForm && !createSongForm.hidden;
      if (isCreateMode) {
        if (newSongTitleInput) newSongTitleInput.value = '';
        if (newSongArtistInput) newSongArtistInput.value = '';
        resetViewportZoom();
      }
      setCreateMode(!isCreateMode);
    });
  }

  modal.addEventListener('click', function (event) {
    if (event.target === modal) {
      closeModal();
    }
  });

  // Prefetch library songs
  const prefetchToken = ++modalSongsFetchToken;
  fetchLibrarySongs().then(list => {
    if (modalSongsFetchToken !== prefetchToken) {
      return;
    }
    renderSuggestedSongs._lastList = list.length ? list : [];
    renderSuggestedSongs(handleSuggestionSelect);
  }).catch(() => {
    if (modalSongsFetchToken !== prefetchToken) {
      return;
    }
    renderSuggestedSongs._lastList = [];
    renderSuggestedSongs(handleSuggestionSelect);
  });

  // Crear canción
  if (createSongButton) {
    createSongButton.addEventListener('click', async () => {
      if (modalWorking) {
        return;
      }

      const titleValue = (newSongTitleInput?.value || '').trim();
      const artistValue = (newSongArtistInput?.value || '').trim();

      if (!titleValue || !artistValue) {
        console.warn('Debe agregar título y artista para crear una canción.');
        return;
      }

      const originalText = createSongButton.textContent;
      setModalWorkingState(true);
      createSongButton.textContent = 'Guardando...';

      try {
        const songRecord = await createSong(titleValue, artistValue);

        selectedLibrarySongs.set(songRecord.id, { 
          id: songRecord.id, 
          title: songRecord.title, 
          artist: songRecord.artist 
        });
        lastCreatedSongId = songRecord.id;
        pendingSuggestedScrollSongId = songRecord.id ?? songRecord.title;

        const baseList = Array.isArray(renderSuggestedSongs._lastList) ? [...renderSuggestedSongs._lastList] : [];
        const filtered = baseList.filter(item => item?.id !== songRecord.id);
        filtered.push({ id: songRecord.id, title: songRecord.title, artists: { name: songRecord.artist } });
        renderSuggestedSongs._lastList = filtered;
        modalSongsFetchToken += 1;
        renderSuggestedSongs(handleSuggestionSelect);

        if (newSongTitleInput) newSongTitleInput.value = '';
        if (newSongArtistInput) newSongArtistInput.value = '';
        setCreateMode(false);
      } catch (err) {
        console.error('Error creating song:', err);
      } finally {
        createSongButton.textContent = originalText;
        setModalWorkingState(false);
      }
    });
  }

  // Añadir canciones seleccionadas
  if (addSelectedButton) {
    addSelectedButton.addEventListener('click', async () => {
      if (!selectedUserId || selectedLibrarySongs.size === 0 || modalWorking) {
        return;
      }

      const originalText = addSelectedButton.textContent;
      setModalWorkingState(true);
      addSelectedButton.textContent = 'Añadiendo...';

      try {
        const additions = Array.from(selectedLibrarySongs.values())
          .map(entry => entry?.id)
          .filter(id => id !== null && id !== undefined);

        if (!additions.length) {
          addSelectedButton.textContent = originalText;
          setModalWorkingState(false);
          return;
        }

        let pendingScrollId = null;
        if (lastCreatedSongId && additions.includes(lastCreatedSongId)) {
          pendingScrollId = lastCreatedSongId;
        }

        const { data: existingRows, error: existingError } = await supabaseClient
          .from('user_songs')
          .select('song_id')
          .eq('user_id', selectedUserId)
          .in('song_id', additions);

        if (existingError) {
          throw existingError;
        }

        const existingIds = new Set((existingRows || []).map(row => row.song_id));
        const insertPayload = additions
          .filter(songId => !existingIds.has(songId))
          .map(songId => ({ user_id: selectedUserId, song_id: songId, status_tag: DEFAULT_STATUS }));

        if (insertPayload.length) {
          const { error: insertError } = await supabaseClient
            .from('user_songs')
            .insert(insertPayload);

          if (insertError) {
            throw insertError;
          }
        }

        selectedLibrarySongs.clear();
        
        // Cerrar modal primero
        closeModal();
        
        // Mostrar loading en el contenedor de canciones
        const songsContainer = document.getElementById('songs-container');
        if (songsContainer) {
          // Quitar clase songs-empty para que el FAB no interfiera
          document.body.classList.remove('songs-empty');
          songsContainer.innerHTML = `
            <div class="songs-loading">
              <div class="songs-loading__spinner"></div>
              <span class="songs-loading__text">Cargando canciones...</span>
            </div>
          `;
        }
        
        if (loadSongsCallback) {
          await loadSongsCallback();
        }
        
        if (onSongsAdded) {
          onSongsAdded(additions, pendingScrollId);
        }
      } catch (err) {
        console.error('Error adding songs to list:', err);
      } finally {
        if (!modal.classList.contains('hidden')) {
          addSelectedButton.textContent = originalText;
          setModalWorkingState(false);
        } else {
          addSelectedButton.textContent = originalText;
          modalWorking = false;
          updateModalButtonsDisabledState();
        }
      }
    });
  }
}
