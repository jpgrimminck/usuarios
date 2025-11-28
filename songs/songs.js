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

const selectedLibrarySongs = new Map();
let modalWorking = false;
let modalSongsFetchToken = 0;
let defaultCreateFormParent = null;
let createFieldElements = [];
let toggleButtonDefaultParent = null;
let lastCreatedSongId = null;
let pendingScrollSongId = null;
let pendingSuggestedScrollSongId = null;

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

function updateModalButtonsDisabledState() {
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

function setCreateMode(enable) {
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
    modalTitle.textContent = shouldEnable ? 'Crear Canción' : 'Lista de Canciones';
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

function setModalWorkingState(isWorking) {
  modalWorking = !!isWorking;
  updateModalButtonsDisabledState();
}

function resetNewSongForm() {
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

// ...existing code...
// Removed duplicate functions as they are now imported
// ...existing code...

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

async function getOrCreateArtistId(artistName) {
  const trimmedName = (artistName || '').trim();
  if (!trimmedName) {
    throw new Error('Artist name is required.');
  }

  const { data: existingArtist, error: existingError } = await supabase
    .from('artists')
    .select('id')
    .eq('name', trimmedName)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingArtist?.id) {
    return existingArtist.id;
  }

  try {
    const { data: insertedArtist, error: insertError } = await supabase
      .from('artists')
      .insert({ name: trimmedName })
      .select('id')
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedArtist.id;
  } catch (err) {
    if (err?.code === '23505') {
      const { data: retryArtist, error: retryError } = await supabase
        .from('artists')
        .select('id')
        .eq('name', trimmedName)
        .maybeSingle();

      if (retryError) {
        throw retryError;
      }

      if (retryArtist?.id) {
        return retryArtist.id;
      }
    }

    throw err;
  }
}

async function updateSongsTitle() {
  const titleEl = document.querySelector('#site-header h1');
  if (!titleEl) return;
  
  // Mostrar loading mientras se carga
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

// Ensure the songs container has top padding equal to header height to avoid overlap.
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

function renderSuggestedSongs(onSelect) {
  const container = document.getElementById('suggested-songs-container');
  if (!container) return;
  container.innerHTML = '';
  updateModalButtonsDisabledState();
  // fallback to empty list if no list provided
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
    // support both sampleSongs shape ({title,artist}) and DB shape ({title, artists:{name}})
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

      // Force the radial fill to begin immediately before locking the selected state
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
async function fetchLibrarySongs() {
  try {
    const { data, error } = await supabase
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
      
      const { data: userSongs, error: userSongsError } = await supabase
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

function initAddSongModal() {
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

  function openModal() {
    exitEraseMode();
    setModalWorkingState(false);
    setCreateMode(false);
    const fetchToken = ++modalSongsFetchToken;
    // Fetch library songs and render them in the modal
    fetchLibrarySongs().then(list => {
      if (modalSongsFetchToken !== fetchToken) {
        return;
      }
      renderSuggestedSongs._lastList = list.length ? list : [];
      renderSuggestedSongs(handleSuggestionSelect);
    }).catch(() => {
      if (modalSongsFetchToken !== fetchToken) {
        return;
      }
      renderSuggestedSongs._lastList = [];
      renderSuggestedSongs(handleSuggestionSelect);
    });
    updateModalButtonsDisabledState();
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
    selectedLibrarySongs.clear();
    resetNewSongForm();
    setModalWorkingState(false);
    // Reset viewport zoom (fix para móviles después del teclado virtual)
    resetViewportZoom();
  }

  function resetViewportZoom() {
    // Desenfocar cualquier input activo primero
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    
    // Resetear viewport meta tag
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      // Temporalmente permitir zoom para forzar reset
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=10.0, user-scalable=yes');
      
      // Forzar el zoom a 1
      setTimeout(() => {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
      }, 50);
    }
    
    // Forzar scroll al inicio para ayudar con el reset
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }

  fab.addEventListener('click', openModal);

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  if (toggleCreateButton) {
    toggleCreateButton.addEventListener('click', () => {
      const isCreateMode = createSongForm && !createSongForm.hidden;
      if (isCreateMode) {
        // Saliendo del modo crear: limpiar campos y resetear zoom
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

  // Render initially so the modal is ready if opened via other triggers
  // prefetch library songs for faster open
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
        const artistId = await getOrCreateArtistId(artistValue);

        const { data: insertedSong, error: songInsertError } = await supabase
          .from('songs')
          .insert({ title: titleValue, artist_id: artistId, created_by: selectedUserId })
          .select('id, title, artists ( name )')
          .single();

        let songRecord = insertedSong;

        if (songInsertError) {
          if (songInsertError.code === '23505') {
            const { data: existingSong, error: existingSongError } = await supabase
              .from('songs')
              .select('id, title, artists ( name )')
              .eq('title', titleValue)
              .eq('artist_id', artistId)
              .maybeSingle();

            if (existingSongError) {
              throw existingSongError;
            }

            if (existingSong) {
              songRecord = existingSong;
            } else {
              throw songInsertError;
            }
          } else {
            throw songInsertError;
          }
        }

        if (!songRecord?.id) {
          throw new Error('No se pudo obtener la canción creada.');
        }

        const displayArtist = songRecord?.artists?.name || artistValue;
        selectedLibrarySongs.set(songRecord.id, { id: songRecord.id, title: songRecord.title, artist: displayArtist });
  lastCreatedSongId = songRecord.id;
  pendingSuggestedScrollSongId = songRecord.id ?? songRecord.title;

        const baseList = Array.isArray(renderSuggestedSongs._lastList) ? [...renderSuggestedSongs._lastList] : [];
        const filtered = baseList.filter(item => item?.id !== songRecord.id);
        filtered.push({ id: songRecord.id, title: songRecord.title, artists: { name: displayArtist } });
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

        if (lastCreatedSongId && additions.includes(lastCreatedSongId)) {
          pendingScrollSongId = lastCreatedSongId;
        }

        const { data: existingRows, error: existingError } = await supabase
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
          const { error: insertError } = await supabase
            .from('user_songs')
            .insert(insertPayload);

          if (insertError) {
            throw insertError;
          }
        }

        selectedLibrarySongs.clear();
        await loadSongs();
        closeModal();
      } catch (err) {
        console.error('Error adding songs to list:', err);
        pendingScrollSongId = null;
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

// Run on load and when resizing
window.addEventListener('load', adjustSongsContainerPadding);
window.addEventListener('resize', adjustSongsContainerPadding);

async function loadSongs() {
  const container = document.getElementById('songs-container');
  if (!container) return;
  container.innerHTML = '';

  try {
    let songs = null;

    const statusBySongId = new Map();

    if (selectedUserId) {
      // 1) Get song IDs linked to this user from user_songs
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

      // 2) Load only those canciones
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
      // No selected user: load all songs as before
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

    // Sort songs alphabetically by title
    if (songs && songs.length > 0) {
      songs.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB);
      });
    }

    // Render songs (same rendering logic as before)
    songs.forEach(song => {
      if (!song || !song.id) return;
      const songTitle = song.title;
      if (!songTitle) return;
      const artistName = song.artists?.name || '';
      const firstLetter = songTitle.charAt(0).toUpperCase();
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
      // Agregar botón de borrado si hay usuario seleccionado
      if (selectedUserId) {
        const deleteBtn = createDeleteButton(song.id);
        songElement.appendChild(deleteBtn);
      }
      // Salir del modo borrado al hacer clic en la tarjeta
      songElement.addEventListener('click', (e) => {
        // No salir si se hizo clic en el botón de borrado o status
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

    // Refrescar modo borrado si está activo
    refreshEraseMode();
  } catch (err) {
    console.error('Error in loadSongs:', err);
  }
}

loadSongs();
updateSongsTitle();
updateModalButtonsDisabledState();
initAddSongModal();
initSongsRealtime();
initEraseMode({
  supabase: supabase,
  userId: selectedUserId,
  onSongDeleted: (songId) => {
    console.log('Canción eliminada de la lista:', songId);
  }
});

// Back button behavior: try history.back(), fallback to index.html
document.addEventListener('DOMContentLoaded', function () {
  const backBtn = document.getElementById('back-button');
  if (!backBtn) return;
  backBtn.addEventListener('click', function (e) {
    e.preventDefault();
    exitEraseMode();
    // Always navigate back to index.html (preserve id if present) using replace
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || selectedUserId;
    const target = id ? `../index.html?id=${encodeURIComponent(id)}` : '../index.html';
    // Use replace so this navigation doesn't create a new history entry
    window.location.replace(target);
  });
});
