const RAF_FALLBACK_INTERVAL = 1000 / 30;

function safePercent(time, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const clampedTime = Math.max(0, Math.min(duration, Number(time) || 0));
  return (clampedTime / duration) * 100;
}

export function buildWaveformState(elements = {}) {
  const trackEl = elements.viewportEl || null;
  const fillEl = elements.contentEl || null;
  if (!trackEl || !fillEl) return null;
  const state = {
    trackEl,
    fillEl,
    duration: 0,
    lastCurrentTime: 0,
    trackWidth: 0
  };
  fillEl.style.width = '0%';
  return state;
}

export function refreshWaveformMetrics(state) {
  if (!state) return null;
  const trackWidth = state.trackEl?.getBoundingClientRect?.().width || state.trackEl?.offsetWidth || 0;
  state.trackWidth = trackWidth || 0;
  return { trackWidth: state.trackWidth };
}

export function resetWaveformState(state) {
  if (!state) return;
  state.lastCurrentTime = 0;
  state.duration = 0;
  if (state.fillEl) {
    state.fillEl.style.width = '0%';
  }
}

export function populateWaveformFromSource() {
  return Promise.resolve(null);
}

export function applyWaveformValues() {
  // El deslizador no necesita manejar valores de amplitud.
}

export function applyWaveformPosition(state, currentTime, duration) {
  if (!state || !state.fillEl) return;
  const effectiveDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : (Number.isFinite(state.duration) && state.duration > 0 ? state.duration : 0);
  if (effectiveDuration > 0) {
    const percent = safePercent(currentTime, effectiveDuration);
    state.fillEl.style.width = `${percent}%`;
    state.lastCurrentTime = Math.max(0, Number(currentTime) || 0);
    state.duration = effectiveDuration;
  } else {
    state.fillEl.style.width = '0%';
    state.lastCurrentTime = 0;
  }
}

export function startWaveformAnimation(cacheEntry) {
  if (!cacheEntry || cacheEntry.waveformAnimationId) return;
  const player = cacheEntry.player;
  const state = cacheEntry.waveform;
  if (!player || !state) return;

  const step = () => {
    if (!cacheEntry.player || cacheEntry.player.paused) {
      cacheEntry.waveformAnimationId = null;
      return;
    }
    applyWaveformPosition(state, cacheEntry.player.currentTime, cacheEntry.player.duration);
    cacheEntry.waveformAnimationId = requestAnimationFrame(step);
  };

  if (typeof requestAnimationFrame === 'function') {
    cacheEntry.waveformAnimationId = requestAnimationFrame(step);
  } else {
    cacheEntry.waveformAnimationId = window.setInterval(() => {
      if (!cacheEntry.player || cacheEntry.player.paused) {
        clearInterval(cacheEntry.waveformAnimationId);
        cacheEntry.waveformAnimationId = null;
        return;
      }
      applyWaveformPosition(state, cacheEntry.player.currentTime, cacheEntry.player.duration);
    }, RAF_FALLBACK_INTERVAL);
  }
}

export function stopWaveformAnimation(cacheEntry) {
  if (!cacheEntry || !cacheEntry.waveformAnimationId) return;
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(cacheEntry.waveformAnimationId);
  } else {
    clearInterval(cacheEntry.waveformAnimationId);
  }
  cacheEntry.waveformAnimationId = null;
}
