// audios.js - Audio management for admin panel

const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const AUDIO_BUCKET = 'audios';

// State
let allAudios = [];
let users = [];
let songs = [];
let currentAudio = null;
let audioElement = null;
let editingAudioId = null;
let deletingAudioId = null;

// DOM Elements
const audiosList = document.getElementById('audios-list');
const searchInput = document.getElementById('search-input');
const filterUploader = document.getElementById('filter-uploader');
const filterSong = document.getElementById('filter-song');
const filterFormat = document.getElementById('filter-format');
const audiosCount = document.getElementById('audios-count');
const refreshBtn = document.getElementById('refresh-btn');

// Modals
const editModal = document.getElementById('edit-modal');
const editNameInput = document.getElementById('edit-name-input');
const cancelEditBtn = document.getElementById('cancel-edit');
const saveEditBtn = document.getElementById('save-edit');

const deleteModal = document.getElementById('delete-modal');
const deleteAudioName = document.getElementById('delete-audio-name');
const cancelDeleteBtn = document.getElementById('cancel-delete');
const confirmDeleteBtn = document.getElementById('confirm-delete');

// Utility functions
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return 'N/A';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getFormatFromUrl(url) {
  if (!url) return 'unknown';
  const ext = url.split('.').pop()?.toLowerCase();
  if (['wav', 'mp3', 'm4a', 'webm', 'ogg', 'mpeg', 'mp4'].includes(ext)) {
    if (ext === 'mpeg') return 'mp3';
    if (ext === 'mp4') return 'm4a';
    return ext;
  }
  return 'unknown';
}

function getUserName(userId) {
  const user = users.find(u => u.id === userId);
  return user ? user.name : `Usuario ${userId}`;
}

function getSongName(songId) {
  const song = songs.find(s => s.id === songId);
  return song ? song.name : `Canción ${songId}`;
}

// Load data
async function loadUsers() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name')
      .order('name');
    
    if (error) throw error;
    users = data || [];
    
    // Populate uploader filter
    filterUploader.innerHTML = '<option value="">Todos los uploaders</option>';
    users.forEach(user => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = user.name;
      filterUploader.appendChild(option);
    });
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

async function loadSongs() {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select('id, name')
      .order('name');
    
    if (error) throw error;
    songs = data || [];
    
    // Populate song filter
    filterSong.innerHTML = '<option value="">Todas las canciones</option>';
    songs.forEach(song => {
      const option = document.createElement('option');
      option.value = song.id;
      option.textContent = song.name;
      filterSong.appendChild(option);
    });
  } catch (err) {
    console.error('Error loading songs:', err);
  }
}

async function loadAudios() {
  refreshBtn.classList.add('loading');
  audiosList.innerHTML = '<div class="loading-message">Cargando audios...</div>';
  
  try {
    const { data, error } = await supabase
      .from('audios')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    allAudios = data || [];
    
    renderAudios();
  } catch (err) {
    console.error('Error loading audios:', err);
    audiosList.innerHTML = '<div class="error-message">Error al cargar los audios</div>';
  } finally {
    refreshBtn.classList.remove('loading');
  }
}

function getFilteredAudios() {
  let filtered = [...allAudios];
  
  // Search filter
  const search = searchInput.value.toLowerCase().trim();
  if (search) {
    filtered = filtered.filter(audio => 
      audio.name?.toLowerCase().includes(search) ||
      audio.detail?.toLowerCase().includes(search)
    );
  }
  
  // Uploader filter
  const uploaderId = filterUploader.value;
  if (uploaderId) {
    filtered = filtered.filter(audio => audio.uploader_id === parseInt(uploaderId));
  }
  
  // Song filter
  const songId = filterSong.value;
  if (songId) {
    filtered = filtered.filter(audio => audio.relational_song_id === parseInt(songId));
  }
  
  // Format filter
  const format = filterFormat.value;
  if (format) {
    filtered = filtered.filter(audio => getFormatFromUrl(audio.url) === format);
  }
  
  return filtered;
}

function renderAudios() {
  const filtered = getFilteredAudios();
  
  audiosCount.textContent = `${filtered.length} de ${allAudios.length} audios`;
  
  if (filtered.length === 0) {
    audiosList.innerHTML = '<div class="empty-message">No se encontraron audios</div>';
    return;
  }
  
  audiosList.innerHTML = filtered.map(audio => createAudioCard(audio)).join('');
  
  // Load metadata for each audio
  filtered.forEach(audio => {
    loadAudioMetadata(audio);
  });
  
  // Attach event listeners
  attachCardListeners();
}

function createAudioCard(audio) {
  const format = getFormatFromUrl(audio.url);
  const uploaderName = getUserName(audio.uploader_id);
  const songName = getSongName(audio.relational_song_id);
  
  return `
    <div class="audio-card" data-audio-id="${audio.id}">
      <div class="audio-card-header">
        <div class="audio-name">${escapeHtml(audio.name || 'Sin nombre')}</div>
        <div class="audio-id">#${audio.id}</div>
      </div>
      
      <div class="audio-card-info">
        <div class="info-item">
          <span class="info-label">Canción</span>
          <span class="info-value">${escapeHtml(songName)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Subido por</span>
          <span class="info-value">${escapeHtml(uploaderName)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Detalle</span>
          <span class="info-value">${escapeHtml(audio.detail || 'N/A')}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Creado</span>
          <span class="info-value">${formatDate(audio.created_at)}</span>
        </div>
      </div>
      
      <div class="audio-card-metadata">
        <div class="info-item">
          <span class="info-label">Formato</span>
          <span class="info-value"><span class="format-badge ${format}">${format.toUpperCase()}</span></span>
        </div>
        <div class="info-item">
          <span class="info-label">Tamaño</span>
          <span class="info-value loading" data-meta="size-${audio.id}">Cargando...</span>
        </div>
        <div class="info-item">
          <span class="info-label">Duración</span>
          <span class="info-value loading" data-meta="duration-${audio.id}">Cargando...</span>
        </div>
        <div class="info-item">
          <span class="info-label">Sample Rate</span>
          <span class="info-value loading" data-meta="samplerate-${audio.id}">Cargando...</span>
        </div>
      </div>
      
      <div class="audio-card-actions">
        <button class="action-btn play" data-action="play" data-audio-id="${audio.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Play
        </button>
        <button class="action-btn edit" data-action="edit" data-audio-id="${audio.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Editar
        </button>
        <button class="action-btn delete" data-action="delete" data-audio-id="${audio.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Eliminar
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadAudioMetadata(audio) {
  if (!audio.url) {
    updateMetadataDisplay(audio.id, { size: 'N/A', duration: 'N/A', sampleRate: 'N/A' });
    return;
  }
  
  try {
    // Get file size from storage
    const { data: fileData, error: listError } = await supabase
      .storage
      .from(AUDIO_BUCKET)
      .list(audio.url.substring(0, audio.url.lastIndexOf('/')), {
        search: audio.url.split('/').pop()
      });
    
    let fileSize = null;
    if (!listError && fileData && fileData.length > 0) {
      const file = fileData.find(f => audio.url.endsWith(f.name));
      if (file && file.metadata) {
        fileSize = file.metadata.size;
      }
    }
    
    // Get audio URL for duration and sample rate
    const { data: urlData } = await supabase
      .storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(audio.url, 60);
    
    if (urlData?.signedUrl) {
      // Use AudioContext to get sample rate and duration
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      try {
        const response = await fetch(urlData.signedUrl);
        const arrayBuffer = await response.arrayBuffer();
        
        // Update file size from response if not available from metadata
        if (!fileSize) {
          fileSize = arrayBuffer.byteLength;
        }
        
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        updateMetadataDisplay(audio.id, {
          size: formatFileSize(fileSize),
          duration: formatDuration(audioBuffer.duration),
          sampleRate: audioBuffer.sampleRate + ' Hz'
        });
        
        await audioContext.close();
      } catch (decodeErr) {
        console.warn(`Could not decode audio ${audio.id}:`, decodeErr);
        updateMetadataDisplay(audio.id, {
          size: fileSize ? formatFileSize(fileSize) : 'N/A',
          duration: 'Error',
          sampleRate: 'Error'
        });
      }
    } else {
      updateMetadataDisplay(audio.id, { size: 'N/A', duration: 'N/A', sampleRate: 'N/A' });
    }
  } catch (err) {
    console.error(`Error loading metadata for audio ${audio.id}:`, err);
    updateMetadataDisplay(audio.id, { size: 'Error', duration: 'Error', sampleRate: 'Error' });
  }
}

function updateMetadataDisplay(audioId, metadata) {
  const sizeEl = document.querySelector(`[data-meta="size-${audioId}"]`);
  const durationEl = document.querySelector(`[data-meta="duration-${audioId}"]`);
  const sampleRateEl = document.querySelector(`[data-meta="samplerate-${audioId}"]`);
  
  if (sizeEl) {
    sizeEl.textContent = metadata.size;
    sizeEl.classList.remove('loading');
  }
  if (durationEl) {
    durationEl.textContent = metadata.duration;
    durationEl.classList.remove('loading');
  }
  if (sampleRateEl) {
    sampleRateEl.textContent = metadata.sampleRate;
    sampleRateEl.classList.remove('loading');
  }
}

function attachCardListeners() {
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', handleActionClick);
  });
}

async function handleActionClick(event) {
  const btn = event.currentTarget;
  const action = btn.dataset.action;
  const audioId = parseInt(btn.dataset.audioId);
  
  switch (action) {
    case 'play':
      await togglePlayAudio(audioId, btn);
      break;
    case 'edit':
      openEditModal(audioId);
      break;
    case 'delete':
      openDeleteModal(audioId);
      break;
  }
}

async function togglePlayAudio(audioId, btn) {
  const audio = allAudios.find(a => a.id === audioId);
  if (!audio || !audio.url) return;
  
  // Stop current audio if playing
  if (audioElement) {
    audioElement.pause();
    audioElement = null;
    document.querySelectorAll('.action-btn.play.playing').forEach(b => {
      b.classList.remove('playing');
      b.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Play
      `;
    });
    
    if (currentAudio === audioId) {
      currentAudio = null;
      return;
    }
  }
  
  try {
    const { data: urlData } = await supabase
      .storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(audio.url, 300);
    
    if (!urlData?.signedUrl) {
      alert('No se pudo obtener la URL del audio');
      return;
    }
    
    audioElement = new Audio(urlData.signedUrl);
    currentAudio = audioId;
    
    btn.classList.add('playing');
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16"/>
        <rect x="14" y="4" width="4" height="16"/>
      </svg>
      Pausa
    `;
    
    audioElement.play();
    
    audioElement.onended = () => {
      btn.classList.remove('playing');
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Play
      `;
      currentAudio = null;
      audioElement = null;
    };
  } catch (err) {
    console.error('Error playing audio:', err);
    alert('Error al reproducir el audio');
  }
}

function openEditModal(audioId) {
  const audio = allAudios.find(a => a.id === audioId);
  if (!audio) return;
  
  editingAudioId = audioId;
  editNameInput.value = audio.name || '';
  editModal.classList.remove('hidden');
  editNameInput.focus();
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editingAudioId = null;
  editNameInput.value = '';
}

async function saveEdit() {
  if (!editingAudioId) return;
  
  const newName = editNameInput.value.trim();
  if (!newName) {
    alert('El nombre no puede estar vacío');
    return;
  }
  
  saveEditBtn.disabled = true;
  saveEditBtn.textContent = 'Guardando...';
  
  try {
    const { error } = await supabase
      .from('audios')
      .update({ name: newName })
      .eq('id', editingAudioId);
    
    if (error) throw error;
    
    // Update local data
    const audio = allAudios.find(a => a.id === editingAudioId);
    if (audio) {
      audio.name = newName;
    }
    
    closeEditModal();
    renderAudios();
  } catch (err) {
    console.error('Error updating audio name:', err);
    alert('Error al actualizar el nombre');
  } finally {
    saveEditBtn.disabled = false;
    saveEditBtn.textContent = 'Guardar';
  }
}

function openDeleteModal(audioId) {
  const audio = allAudios.find(a => a.id === audioId);
  if (!audio) return;
  
  deletingAudioId = audioId;
  deleteAudioName.textContent = `"${audio.name || 'Sin nombre'}" (ID: ${audio.id})`;
  deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
  deleteModal.classList.add('hidden');
  deletingAudioId = null;
}

async function confirmDelete() {
  if (!deletingAudioId) return;
  
  const audio = allAudios.find(a => a.id === deletingAudioId);
  if (!audio) return;
  
  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.textContent = 'Eliminando...';
  
  try {
    // Delete from storage first
    if (audio.url) {
      const { error: storageError } = await supabase
        .storage
        .from(AUDIO_BUCKET)
        .remove([audio.url]);
      
      if (storageError) {
        console.warn('Error deleting file from storage:', storageError);
        // Continue anyway to delete the record
      }
    }
    
    // Delete from database
    const { error: dbError } = await supabase
      .from('audios')
      .delete()
      .eq('id', deletingAudioId);
    
    if (dbError) throw dbError;
    
    // Update local data
    allAudios = allAudios.filter(a => a.id !== deletingAudioId);
    
    closeDeleteModal();
    renderAudios();
  } catch (err) {
    console.error('Error deleting audio:', err);
    alert('Error al eliminar el audio');
  } finally {
    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = 'Eliminar';
  }
}

// Event listeners
searchInput.addEventListener('input', debounce(renderAudios, 300));
filterUploader.addEventListener('change', renderAudios);
filterSong.addEventListener('change', renderAudios);
filterFormat.addEventListener('change', renderAudios);
refreshBtn.addEventListener('click', loadAudios);

cancelEditBtn.addEventListener('click', closeEditModal);
saveEditBtn.addEventListener('click', saveEdit);
editNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveEdit();
});

cancelDeleteBtn.addEventListener('click', closeDeleteModal);
confirmDeleteBtn.addEventListener('click', confirmDelete);

// Close modals on outside click
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditModal();
});
deleteModal.addEventListener('click', (e) => {
  if (e.target === deleteModal) closeDeleteModal();
});

// Utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Initialize
async function init() {
  await Promise.all([loadUsers(), loadSongs()]);
  await loadAudios();
}

init();
