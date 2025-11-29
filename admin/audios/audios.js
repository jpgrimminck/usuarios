const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State
let allAudios = [];
let allUsers = [];
let allSongs = [];
let filteredAudios = [];
let currentAudio = null;
let currentlyPlayingAudio = null;
let savedScrollPosition = 0;
let realtimeChannel = null;

// DOM Elements
const audioListEl = document.getElementById('audio-list');
const statCountEl = document.getElementById('stat-count');
const statSizeEl = document.getElementById('stat-size');
const filterUploaderEl = document.getElementById('filter-uploader');
const filterSongEl = document.getElementById('filter-song');
const refreshBtn = document.getElementById('refresh-btn');

// Detail modal elements
const detailModal = document.getElementById('detail-modal');
const detailTitle = document.getElementById('detail-title');
const detailSubtitle = document.getElementById('detail-subtitle');
const detailSong = document.getElementById('detail-song');
const detailUploader = document.getElementById('detail-uploader');
const detailDetail = document.getElementById('detail-detail');
const detailDate = document.getElementById('detail-date');
const detailFormat = document.getElementById('detail-format');
const detailSize = document.getElementById('detail-size');
const detailDuration = document.getElementById('detail-duration');
const detailSamplerate = document.getElementById('detail-samplerate');
const actionEdit = document.getElementById('action-edit');
const actionDelete = document.getElementById('action-delete');

// Edit modal elements
const editOverlay = document.getElementById('edit-overlay');
const editInput = document.getElementById('edit-input');
const editCancel = document.getElementById('edit-cancel');
const editSave = document.getElementById('edit-save');

// Delete modal elements
const deleteOverlay = document.getElementById('delete-overlay');
const deleteName = document.getElementById('delete-name');
const deleteCancel = document.getElementById('delete-cancel');
const deleteConfirm = document.getElementById('delete-confirm');

// =====================
// UTILITY FUNCTIONS
// =====================

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getFormatBadge(url) {
  if (!url) return { label: 'N/A', class: '' };
  const ext = url.split('.').pop().toLowerCase();
  const formats = {
    'wav': { label: 'WAV', class: 'wav' },
    'webm': { label: 'WebM', class: 'webm' },
    'mp3': { label: 'MP3', class: 'mp3' },
    'ogg': { label: 'OGG', class: 'ogg' },
    'm4a': { label: 'M4A', class: 'm4a' }
  };
  return formats[ext] || { label: ext.toUpperCase(), class: '' };
}

function getPublicUrl(storagePath) {
  // Storage path is relative like "audios/filename.wav"
  // Need to build full public URL using Supabase
  if (!storagePath) return null;
  
  // If already a full URL, return as-is
  if (storagePath.startsWith('http')) return storagePath;
  
  // Build public URL from storage path
  const { data } = supabase.storage.from('audios').getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

function getUserName(userId) {
  const user = allUsers.find(u => u.id === userId);
  return user ? user.name : 'Desconocido';
}

function getSongTitle(songId) {
  const song = allSongs.find(s => s.id === songId);
  return song ? song.title : 'Sin canción';
}

// =====================
// DATA LOADING
// =====================

async function loadUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name');
  
  if (error) {
    console.error('Error loading users:', error);
    return;
  }
  allUsers = data || [];
}

async function loadSongs() {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title')
    .order('title');
  
  if (error) {
    console.error('Error loading songs:', error);
    return;
  }
  allSongs = data || [];
}

async function loadAudios() {
  audioListEl.innerHTML = `
    <div class="loading-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 2v6h-6M3 22v-6h6M21 12A9 9 0 0 0 6 5.3L3 8M3 12a9 9 0 0 0 15 6.7l3-2.7"/>
      </svg>
      <span>Cargando audios...</span>
    </div>
  `;

  const { data, error } = await supabase
    .from('audios')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading audios:', error);
    audioListEl.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>Error al cargar los audios</span>
      </div>
    `;
    return;
  }

  allAudios = data || [];
  updateFilters();
  applyFilters();
  updateStats();
}

// =====================
// STATS
// =====================

async function updateStats() {
  // Count
  statCountEl.textContent = filteredAudios.length;
  
  // Calculate total size from file URLs
  let totalSize = 0;
  
  // Get sizes from storage for all filtered audios
  const sizePromises = filteredAudios.map(async (audio) => {
    if (!audio.url) return 0;
    try {
      const publicUrl = getPublicUrl(audio.url);
      const response = await fetch(publicUrl, { method: 'HEAD' });
      const size = parseInt(response.headers.get('content-length') || '0');
      return size;
    } catch {
      return 0;
    }
  });
  
  try {
    const sizes = await Promise.all(sizePromises);
    totalSize = sizes.reduce((sum, size) => sum + size, 0);
  } catch (e) {
    console.error('Error calculating sizes:', e);
  }
  
  statSizeEl.textContent = formatBytes(totalSize);
}

// =====================
// FILTERS
// =====================

function updateFilters() {
  const currentUploader = filterUploaderEl.value;
  const currentSong = filterSongEl.value;
  
  // Filter audios based on current selections to determine available options
  let audiosForUploaderFilter = allAudios;
  let audiosForSongFilter = allAudios;
  
  // If a song is selected, uploaders should only show those with audios for that song
  if (currentSong) {
    audiosForUploaderFilter = allAudios.filter(a => a.relational_song_id === parseInt(currentSong));
  }
  
  // If an uploader is selected, songs should only show those with audios from that uploader
  if (currentUploader) {
    audiosForSongFilter = allAudios.filter(a => a.uploader_id === parseInt(currentUploader));
  }
  
  // Get unique uploaders and songs from filtered sets
  const uploaderIds = [...new Set(audiosForUploaderFilter.map(a => a.uploader_id).filter(Boolean))];
  const songIds = [...new Set(audiosForSongFilter.map(a => a.relational_song_id).filter(Boolean))];
  
  // Filter users and songs to only those available
  const uploadersWithAudios = allUsers.filter(u => uploaderIds.includes(u.id));
  const songsWithAudios = allSongs.filter(s => songIds.includes(s.id));
  
  // Populate uploader filter
  filterUploaderEl.innerHTML = '<option value="">Todos los usuarios</option>';
  uploadersWithAudios.forEach(user => {
    filterUploaderEl.innerHTML += `<option value="${user.id}">${user.name}</option>`;
  });
  filterUploaderEl.value = currentUploader;
  
  // Populate song filter
  filterSongEl.innerHTML = '<option value="">Todas las canciones</option>';
  songsWithAudios.forEach(song => {
    filterSongEl.innerHTML += `<option value="${song.id}">${song.title}</option>`;
  });
  filterSongEl.value = currentSong;
}

function applyFilters() {
  const uploaderId = filterUploaderEl.value;
  const songId = filterSongEl.value;
  
  filteredAudios = allAudios.filter(audio => {
    if (uploaderId && audio.uploader_id !== parseInt(uploaderId)) return false;
    if (songId && audio.relational_song_id !== parseInt(songId)) return false;
    return true;
  });
  
  // Update the other filter based on current selection
  updateFilters();
  
  renderAudioList();
  updateStats();
}

// =====================
// RENDER
// =====================

function renderAudioList() {
  if (filteredAudios.length === 0) {
    audioListEl.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
        <span>No hay audios para mostrar</span>
      </div>
    `;
    return;
  }
  
  audioListEl.innerHTML = filteredAudios.map(audio => {
    const format = getFormatBadge(audio.url);
    const userName = getUserName(audio.uploader_id);
    const publicUrl = getPublicUrl(audio.url);
    
    return `
      <div class="audio-item" data-id="${audio.id}">
        <button class="play-btn" data-url="${publicUrl}" data-id="${audio.id}">
          <svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <svg class="pause-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="display:none">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
        </button>
        <div class="audio-info" data-id="${audio.id}">
          <div class="audio-name">${audio.name || 'Sin nombre'}</div>
          <div class="audio-meta">
            <span>${userName}</span>
            <span class="format-badge ${format.class}">${format.label}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  document.querySelectorAll('.play-btn').forEach(btn => {
    btn.addEventListener('click', handlePlayClick);
  });
  
  document.querySelectorAll('.audio-info').forEach(info => {
    info.addEventListener('click', handleInfoClick);
  });
}

// =====================
// PLAY FUNCTIONALITY
// =====================

function handlePlayClick(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const url = btn.dataset.url;
  const audioId = btn.dataset.id;
  
  // Stop currently playing audio if any
  if (currentlyPlayingAudio) {
    currentlyPlayingAudio.pause();
    currentlyPlayingAudio.currentTime = 0;
    
    // Reset all play buttons
    document.querySelectorAll('.play-btn').forEach(b => {
      b.querySelector('.play-icon').style.display = '';
      b.querySelector('.pause-icon').style.display = 'none';
      b.classList.remove('playing');
    });
    
    // If clicking the same audio, just stop
    if (currentlyPlayingAudio.dataset.audioId === audioId) {
      currentlyPlayingAudio = null;
      return;
    }
  }
  
  // Create and play new audio
  const audio = new Audio(url);
  audio.dataset.audioId = audioId;
  
  audio.addEventListener('ended', () => {
    btn.querySelector('.play-icon').style.display = '';
    btn.querySelector('.pause-icon').style.display = 'none';
    btn.classList.remove('playing');
    currentlyPlayingAudio = null;
  });
  
  audio.addEventListener('error', (e) => {
    console.error('Error playing audio:', e);
    btn.querySelector('.play-icon').style.display = '';
    btn.querySelector('.pause-icon').style.display = 'none';
    btn.classList.remove('playing');
    currentlyPlayingAudio = null;
  });
  
  audio.play().then(() => {
    btn.querySelector('.play-icon').style.display = 'none';
    btn.querySelector('.pause-icon').style.display = '';
    btn.classList.add('playing');
    currentlyPlayingAudio = audio;
  }).catch(err => {
    console.error('Error playing audio:', err);
  });
}

// =====================
// DETAIL MODAL
// =====================

function handleInfoClick(e) {
  const audioId = parseInt(e.currentTarget.dataset.id);
  const audio = allAudios.find(a => a.id === audioId);
  if (!audio) return;
  
  currentAudio = audio;
  openDetailModal(audio);
}

function openDetailModal(audio) {
  savedScrollPosition = window.scrollY;
  document.body.classList.add('modal-open');
  
  // Set basic info
  detailTitle.textContent = audio.name || 'Sin nombre';
  detailSubtitle.textContent = `ID: ${audio.id}`;
  detailSong.textContent = getSongTitle(audio.relational_song_id);
  detailUploader.textContent = getUserName(audio.uploader_id);
  detailDetail.textContent = audio.detail || '--';
  detailDate.textContent = formatDate(audio.created_at);
  
  const format = getFormatBadge(audio.url);
  detailFormat.innerHTML = `<span class="format-badge ${format.class}">${format.label}</span>`;
  
  // Reset loading states
  detailSize.textContent = 'Cargando...';
  detailSize.classList.add('loading');
  detailDuration.textContent = 'Cargando...';
  detailDuration.classList.add('loading');
  detailSamplerate.textContent = 'Cargando...';
  detailSamplerate.classList.add('loading');
  
  // Show modal
  detailModal.classList.add('active');
  
  // Load audio metadata
  const publicUrl = getPublicUrl(audio.url);
  loadAudioMetadata(publicUrl);
}

async function loadAudioMetadata(url) {
  if (!url) {
    detailSize.textContent = '--';
    detailSize.classList.remove('loading');
    detailDuration.textContent = '--';
    detailDuration.classList.remove('loading');
    detailSamplerate.textContent = '--';
    detailSamplerate.classList.remove('loading');
    return;
  }
  
  // Get file size
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const size = parseInt(response.headers.get('content-length') || '0');
    detailSize.textContent = formatBytes(size);
    detailSize.classList.remove('loading');
  } catch {
    detailSize.textContent = '--';
    detailSize.classList.remove('loading');
  }
  
  // Get duration and sample rate
  try {
    const audio = new Audio();
    audio.src = url;
    
    await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', () => {
        detailDuration.textContent = formatDuration(audio.duration);
        detailDuration.classList.remove('loading');
        resolve();
      });
      audio.addEventListener('error', reject);
      setTimeout(reject, 5000); // Timeout after 5 seconds
    });
    
    // Try to get sample rate using AudioContext
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      detailSamplerate.textContent = `${audioBuffer.sampleRate} Hz`;
      detailSamplerate.classList.remove('loading');
      audioContext.close();
    } catch {
      detailSamplerate.textContent = '--';
      detailSamplerate.classList.remove('loading');
    }
  } catch {
    detailDuration.textContent = '--';
    detailDuration.classList.remove('loading');
    detailSamplerate.textContent = '--';
    detailSamplerate.classList.remove('loading');
  }
}

function closeDetailModal() {
  detailModal.classList.remove('active');
  document.body.classList.remove('modal-open');
  window.scrollTo(0, savedScrollPosition);
  currentAudio = null;
}

// =====================
// EDIT MODAL
// =====================

function openEditModal() {
  if (!currentAudio) return;
  editInput.value = currentAudio.name || '';
  editOverlay.classList.add('active');
  editInput.focus();
}

function closeEditModal() {
  editOverlay.classList.remove('active');
}

async function saveEdit() {
  if (!currentAudio) return;
  
  const newName = editInput.value.trim();
  if (!newName) return;
  
  editSave.disabled = true;
  editSave.textContent = 'Guardando...';
  
  const { error } = await supabase
    .from('audios')
    .update({ name: newName })
    .eq('id', currentAudio.id);
  
  editSave.disabled = false;
  editSave.textContent = 'Guardar';
  
  if (error) {
    console.error('Error updating audio:', error);
    alert('Error al guardar');
    return;
  }
  
  // Update local data
  currentAudio.name = newName;
  const idx = allAudios.findIndex(a => a.id === currentAudio.id);
  if (idx !== -1) allAudios[idx].name = newName;
  
  // Update UI
  detailTitle.textContent = newName;
  applyFilters();
  closeEditModal();
}

// =====================
// DELETE MODAL
// =====================

function openDeleteModal() {
  if (!currentAudio) return;
  deleteName.textContent = currentAudio.name || 'Sin nombre';
  deleteOverlay.classList.add('active');
}

function closeDeleteModal() {
  deleteOverlay.classList.remove('active');
}

async function confirmDelete() {
  if (!currentAudio) return;
  
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Eliminando...';
  
  // Extract file path from URL for storage deletion
  const url = currentAudio.url;
  let filePath = null;
  
  if (url) {
    // URL format: .../storage/v1/object/public/audios/audios/filename.ext
    const match = url.match(/\/audios\/audios\/(.+)$/);
    if (match) {
      filePath = `audios/${match[1]}`;
    }
  }
  
  // Delete from storage first
  if (filePath) {
    const { error: storageError } = await supabase.storage
      .from('audios')
      .remove([filePath]);
    
    if (storageError) {
      console.warn('Error deleting from storage:', storageError);
      // Continue anyway to delete db record
    }
  }
  
  // Delete from database
  const { error } = await supabase
    .from('audios')
    .delete()
    .eq('id', currentAudio.id);
  
  deleteConfirm.disabled = false;
  deleteConfirm.textContent = 'Eliminar';
  
  if (error) {
    console.error('Error deleting audio:', error);
    alert('Error al eliminar');
    return;
  }
  
  // Update local data
  allAudios = allAudios.filter(a => a.id !== currentAudio.id);
  
  // Close modals and refresh
  closeDeleteModal();
  closeDetailModal();
  updateFilters();
  applyFilters();
}

// =====================
// REALTIME
// =====================

function setupRealtime() {
  realtimeChannel = supabase
    .channel('audios-changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'audios' },
      (payload) => {
        console.log('Realtime event:', payload.eventType);
        
        if (payload.eventType === 'INSERT') {
          allAudios.unshift(payload.new);
          updateFilters();
          applyFilters();
        } else if (payload.eventType === 'UPDATE') {
          const idx = allAudios.findIndex(a => a.id === payload.new.id);
          if (idx !== -1) allAudios[idx] = payload.new;
          applyFilters();
        } else if (payload.eventType === 'DELETE') {
          const deletedId = payload.old?.id;
          if (deletedId) {
            // Animate deletion
            const item = document.querySelector(`.audio-item[data-id="${deletedId}"]`);
            if (item) {
              item.classList.add('deleting');
              setTimeout(() => {
                allAudios = allAudios.filter(a => a.id !== deletedId);
                updateFilters();
                applyFilters();
              }, 500);
            } else {
              allAudios = allAudios.filter(a => a.id !== deletedId);
              updateFilters();
              applyFilters();
            }
          }
        }
      }
    )
    .subscribe();
}

// =====================
// EVENT LISTENERS
// =====================

// Filters
filterUploaderEl.addEventListener('change', applyFilters);
filterSongEl.addEventListener('change', applyFilters);

// Refresh
refreshBtn.addEventListener('click', loadAudios);

// Detail modal
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) closeDetailModal();
});

actionEdit.addEventListener('click', openEditModal);
actionDelete.addEventListener('click', openDeleteModal);

// Edit modal
editCancel.addEventListener('click', closeEditModal);
editSave.addEventListener('click', saveEdit);
editOverlay.addEventListener('click', (e) => {
  if (e.target === editOverlay) closeEditModal();
});
editInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') saveEdit();
  if (e.key === 'Escape') closeEditModal();
});

// Delete modal
deleteCancel.addEventListener('click', closeDeleteModal);
deleteConfirm.addEventListener('click', confirmDelete);
deleteOverlay.addEventListener('click', (e) => {
  if (e.target === deleteOverlay) closeDeleteModal();
});

// =====================
// INIT
// =====================

async function init() {
  await Promise.all([loadUsers(), loadSongs()]);
  await loadAudios();
  setupRealtime();
}

init();
