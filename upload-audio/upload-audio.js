const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const AUDIO_BUCKET = 'audios';
const form = document.getElementById('audio-upload-form');
const fileInput = document.getElementById('audio-file');
const audioIdInput = document.getElementById('audio-id');
const fileNameInput = document.getElementById('file-name');
const uploaderSelect = document.getElementById('uploader');
const detailSelect = document.getElementById('detail');
const songSelect = document.getElementById('song-id');
const submitBtn = document.getElementById('submit-btn');
const messageBox = document.getElementById('form-message');

let currentAudioId = null;

async function loadNextAudioId() {
  try {
    const { data, error } = await supabase
      .from('audios')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    if (error) {
      console.error('No se pudo obtener el último ID de audios:', error.message);
      currentAudioId = 1;
    } else if (!data || data.length === 0) {
      currentAudioId = 1;
    } else {
      const lastId = Number(data[0].id);
      currentAudioId = Number.isFinite(lastId) ? lastId + 1 : 1;
    }
  } catch (err) {
    console.error('Error inesperado obteniendo el último ID:', err);
    currentAudioId = 1;
  }

  audioIdInput.value = currentAudioId;
  return currentAudioId;
}

async function loadUploaders() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      console.error('No se pudieron cargar los usuarios:', error.message);
      uploaderSelect.innerHTML = '<option value="">Error cargando usuarios</option>';
      uploaderSelect.disabled = true;
      return;
    }

    if (!data || data.length === 0) {
      uploaderSelect.innerHTML = '<option value="">No hay usuarios disponibles</option>';
      uploaderSelect.disabled = true;
      return;
    }

    uploaderSelect.disabled = false;
    uploaderSelect.innerHTML = '<option value="">Selecciona un usuario…</option>';
    data.forEach((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = user.name || user.id;
      uploaderSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Fallo inesperado cargando usuarios:', err);
    uploaderSelect.innerHTML = '<option value="">Error cargando usuarios</option>';
    uploaderSelect.disabled = true;
  }
}

async function loadSongs() {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select('id, title')
      .order('title', { ascending: true });

    if (error) {
      console.error('No se pudieron cargar las canciones:', error.message);
      songSelect.innerHTML = '<option value="">No fue posible cargar canciones</option>';
      songSelect.disabled = true;
      return;
    }

    if (!data || data.length === 0) {
      songSelect.innerHTML = '<option value="">No hay canciones disponibles</option>';
      songSelect.disabled = true;
      return;
    }

    songSelect.innerHTML = '<option value="">Selecciona una canción…</option>';
    data.forEach((song) => {
      const option = document.createElement('option');
      option.value = song.id;
      option.textContent = song.title;
      songSelect.appendChild(option);
    });
    songSelect.disabled = false;
    collapseSongSelect();
  } catch (err) {
    console.error('Fallo inesperado cargando canciones:', err);
    songSelect.innerHTML = '<option value="">Error cargando canciones</option>';
    songSelect.disabled = true;
    collapseSongSelect();
  }
}

function expandSongSelect() {
  if (songSelect.disabled) return;
  const optionCount = songSelect.options.length;
  if (optionCount <= 2) return;
  const visibleRows = Math.min(8, Math.max(3, optionCount));
  songSelect.size = visibleRows;
  songSelect.dataset.expanded = 'true';
}

function collapseSongSelect() {
  if (songSelect.dataset.expanded !== 'true' && songSelect.size === 1) return;
  songSelect.size = 1;
  songSelect.dataset.expanded = 'false';
}

function setupSongSelectExpandOnFocus() {
  collapseSongSelect();
  songSelect.addEventListener('focus', expandSongSelect);
  songSelect.addEventListener('blur', collapseSongSelect);
  songSelect.addEventListener('change', () => {
    collapseSongSelect();
    songSelect.blur();
  });
  songSelect.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      collapseSongSelect();
      songSelect.blur();
    }
  });
}

function showMessage(type, text) {
  messageBox.className = 'message ' + type;
  messageBox.textContent = text;
  messageBox.style.display = 'block';
}

function clearMessage() {
  messageBox.style.display = 'none';
  messageBox.textContent = '';
  messageBox.className = 'message';
}

fileInput.addEventListener('change', async (event) => {
  clearMessage();
  const file = event.target.files && event.target.files[0];
  if (!file) {
    fileNameInput.value = '';
    return;
  }

  if (file.type !== 'audio/mpeg' && !file.name.toLowerCase().endsWith('.mp3')) {
    showMessage('error', 'El archivo debe ser un MP3 (.mp3).');
    fileInput.value = '';
    fileNameInput.value = '';
    return;
  }

  fileNameInput.value = file.name;
  if (!currentAudioId) {
    await loadNextAudioId();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  const file = fileInput.files && fileInput.files[0];
  const detailValue = detailSelect.value;
  const nombreCancionId = songSelect.value;
  const uploaderId = uploaderSelect.value;

  if (!file) {
    showMessage('error', 'Selecciona un archivo MP3 antes de enviar.');
    return;
  }

  if (!detailValue || !nombreCancionId || !uploaderId) {
    showMessage('error', 'Completa todos los campos obligatorios.');
    return;
  }

  if (!currentAudioId) {
    await loadNextAudioId();
  }

  const audioId = currentAudioId;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Subiendo…';

  try {
    const storagePath = `audios/${audioId}-${file.name}`;
    const { error: uploadError } = await supabase
      .storage
      .from(AUDIO_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'audio/mpeg'
      });

    if (uploadError) {
      throw new Error(uploadError.message || 'No se pudo subir el archivo al storage.');
    }

    const { error: insertError } = await supabase
      .from('audios')
      .insert({
        id: audioId,
        relational_song_id: nombreCancionId,
        detail: detailValue,
        name: file.name,
        uploader_id: uploaderId,
        url: storagePath
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message || 'No se pudo crear el registro en la tabla audios.');
    }

    showMessage('success', '¡Audio subido y registrado correctamente!');
    form.reset();
    currentAudioId = null;
    uploaderSelect.value = '';
    await loadNextAudioId();
    fileNameInput.value = '';
    submitBtn.textContent = 'Subir otro audio';
  } catch (err) {
    console.error('Error al subir audio:', err);
    showMessage('error', err.message || 'Hubo un problema al subir el audio.');
    submitBtn.textContent = 'Reintentar subida';
  } finally {
    submitBtn.disabled = false;
  }
});

// Inicialización
loadNextAudioId();
loadUploaders();
loadSongs();
setupSongSelectExpandOnFocus();
