// ============================================
// Módulo para crear nuevas canciones
// ============================================

let supabaseClient = null;
let selectedUserId = null;

// Callbacks para comunicación con otros módulos
let onSongCreated = null;

export function initCreateModule(options = {}) {
  supabaseClient = options.supabase || null;
  selectedUserId = options.userId || null;
  onSongCreated = typeof options.onSongCreated === 'function' ? options.onSongCreated : null;
}

export async function getOrCreateArtistId(artistName) {
  const trimmedName = (artistName || '').trim();
  if (!trimmedName) {
    throw new Error('Artist name is required.');
  }

  const { data: existingArtist, error: existingError } = await supabaseClient
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
    const { data: insertedArtist, error: insertError } = await supabaseClient
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
      const { data: retryArtist, error: retryError } = await supabaseClient
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

export async function createSong(titleValue, artistValue) {
  if (!titleValue || !artistValue) {
    throw new Error('Debe agregar título y artista para crear una canción.');
  }

  const artistId = await getOrCreateArtistId(artistValue);

  const { data: insertedSong, error: songInsertError } = await supabaseClient
    .from('songs')
    .insert({ title: titleValue, artist_id: artistId, created_by: selectedUserId })
    .select('id, title, artists ( name )')
    .single();

  let songRecord = insertedSong;

  if (songInsertError) {
    if (songInsertError.code === '23505') {
      // Canción duplicada, buscar la existente
      const { data: existingSong, error: existingSongError } = await supabaseClient
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

  const result = {
    id: songRecord.id,
    title: songRecord.title,
    artist: songRecord?.artists?.name || artistValue
  };

  // Notificar que se creó una canción
  if (onSongCreated) {
    onSongCreated(result);
  }

  return result;
}
