// ============================================
// Módulo de borrado de canciones de la lista del usuario
// ============================================

let eraseMode = false;
let supabaseClient = null;
let currentUserId = null;
let onSongDeleted = null;

const eraseUi = {
  toggleButton: null,
  confirmPopup: null,
  confirmMessage: null,
  cancelButton: null,
  deleteButton: null
};

let pendingDeleteSongId = null;
let pendingDeleteCard = null;

export function initEraseMode(options = {}) {
  supabaseClient = options.supabase || null;
  currentUserId = options.userId || null;
  onSongDeleted = typeof options.onSongDeleted === 'function' ? options.onSongDeleted : null;

  eraseUi.toggleButton = document.getElementById('erase-mode-toggle');
  eraseUi.confirmPopup = document.getElementById('erase-confirm-popup');
  eraseUi.cancelButton = document.getElementById('erase-cancel-btn');
  eraseUi.deleteButton = document.getElementById('erase-delete-btn');

  // Solo mostrar el botón si hay usuario seleccionado
  if (eraseUi.toggleButton) {
    if (!currentUserId) {
      eraseUi.toggleButton.hidden = true;
      eraseUi.toggleButton.style.display = 'none';
    } else {
      eraseUi.toggleButton.hidden = false;
      eraseUi.toggleButton.style.display = '';
      eraseUi.toggleButton.addEventListener('click', toggleEraseMode);
    }
  }

  if (eraseUi.cancelButton) {
    eraseUi.cancelButton.addEventListener('click', closeConfirmPopup);
  }

  if (eraseUi.deleteButton) {
    eraseUi.deleteButton.addEventListener('click', confirmDelete);
  }

  // Cerrar popup al hacer clic fuera
  if (eraseUi.confirmPopup) {
    eraseUi.confirmPopup.addEventListener('click', (e) => {
      if (e.target === eraseUi.confirmPopup) {
        closeConfirmPopup();
      }
    });
  }
}

function toggleEraseMode() {
  eraseMode = !eraseMode;
  applyEraseMode();
}

export function exitEraseMode() {
  eraseMode = false;
  applyEraseMode();
}

function applyEraseMode() {
  const container = document.getElementById('songs-container');
  const statusButtons = document.querySelectorAll('.song-status-button');
  const deleteButtons = document.querySelectorAll('.song-delete-btn');

  if (eraseUi.toggleButton) {
    eraseUi.toggleButton.classList.toggle('erase-mode-active', eraseMode);
    const icon = eraseUi.toggleButton.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.textContent = eraseMode ? 'close' : 'delete';
    }
  }

  if (container) {
    container.classList.toggle('erase-mode', eraseMode);
  }

  // Ocultar/mostrar status buttons
  statusButtons.forEach(btn => {
    btn.style.display = eraseMode ? 'none' : '';
  });

  // Mostrar/ocultar delete buttons
  deleteButtons.forEach(btn => {
    btn.style.display = eraseMode ? '' : 'none';
  });
}

export function createDeleteButton(songId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'song-delete-btn';
  btn.dataset.songId = songId;
  btn.style.display = 'none'; // Oculto por defecto
  btn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
  btn.setAttribute('aria-label', 'Eliminar canción de mi lista');

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openConfirmPopup(songId, btn.closest('.song-card'));
  });

  return btn;
}

function openConfirmPopup(songId, cardElement) {
  pendingDeleteSongId = songId;
  pendingDeleteCard = cardElement;

  if (eraseUi.confirmPopup) {
    eraseUi.confirmPopup.classList.remove('hidden');
  }

  if (eraseUi.deleteButton) {
    eraseUi.deleteButton.disabled = false;
    eraseUi.deleteButton.textContent = 'Borrar';
  }
}

function closeConfirmPopup() {
  pendingDeleteSongId = null;
  pendingDeleteCard = null;

  if (eraseUi.confirmPopup) {
    eraseUi.confirmPopup.classList.add('hidden');
  }
}

async function confirmDelete() {
  if (!pendingDeleteSongId || !currentUserId || !supabaseClient) {
    closeConfirmPopup();
    return;
  }

  const songId = pendingDeleteSongId;
  const card = pendingDeleteCard;

  if (eraseUi.deleteButton) {
    eraseUi.deleteButton.disabled = true;
    eraseUi.deleteButton.textContent = 'Borrando...';
  }

  try {
    // Eliminar de user_songs
    const { error } = await supabaseClient
      .from('user_songs')
      .delete()
      .eq('user_id', currentUserId)
      .eq('song_id', songId);

    if (error) {
      throw error;
    }

    // Animación de borrado
    if (card) {
      card.classList.add('song-card--deleting');
      await new Promise(resolve => setTimeout(resolve, 300));
      card.remove();
    }

    // Verificar si el contenedor quedó vacío
    const container = document.getElementById('songs-container');
    const remainingCount = container ? container.children.length : 0;
    
    // Actualizar estado del FAB
    if (typeof window.updateFabState === 'function') {
      window.updateFabState(remainingCount);
    }
    
    if (remainingCount === 0) {
      exitEraseMode();
    }

    // Callback opcional
    if (onSongDeleted) {
      onSongDeleted(songId);
    }

    closeConfirmPopup();
  } catch (err) {
    console.error('Error eliminando canción de la lista:', err);
    if (eraseUi.deleteButton) {
      eraseUi.deleteButton.disabled = false;
      eraseUi.deleteButton.textContent = 'Borrar';
    }
  }
}

// Función para actualizar el modo cuando se recargan las canciones
export function refreshEraseMode() {
  if (eraseMode) {
    applyEraseMode();
  }
}

export function isEraseMode() {
  return eraseMode;
}
