export const WAVEFORM_VIEW_WINDOW_SECONDS = 4;
export const WAVEFORM_HALF_WINDOW_SECONDS = WAVEFORM_VIEW_WINDOW_SECONDS / 2;
export const WAVEFORM_BAR_WIDTH = 4;
export const WAVEFORM_BAR_GAP = 0;
export const WAVEFORM_BAR_STEP = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
export const WAVEFORM_MIN_BAR_COUNT = 160;
export const WAVEFORM_MAX_BAR_COUNT = 1024;
export const WAVEFORM_SAMPLES_PER_SECOND = 32;
export const WAVEFORM_AMPLITUDE_FLOOR = 0.001;

let waveformAudioContext = null;

export function getWaveformAudioContext() {
  if (waveformAudioContext) return waveformAudioContext;
  const ContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!ContextCtor) {
    console.warn('AudioContext no está disponible en este navegador; no se podrá renderizar la forma de onda real.');
    return null;
  }
  try {
    waveformAudioContext = new ContextCtor();
  } catch (err) {
    console.warn('No se pudo crear un AudioContext para la forma de onda:', err);
    waveformAudioContext = null;
  }
  return waveformAudioContext;
}

export function stopWaveformAnimation(cacheEntry) {
  if (!cacheEntry) return;
  if (cacheEntry.waveformAnimationId) {
    cancelAnimationFrame(cacheEntry.waveformAnimationId);
    cacheEntry.waveformAnimationId = null;
  }
}

export function startWaveformAnimation(cacheEntry) {
  if (!cacheEntry || cacheEntry.waveformAnimationId) return;
  const step = () => {
    if (!cacheEntry.player || cacheEntry.player.paused) {
      cacheEntry.waveformAnimationId = null;
      return;
    }
    applyWaveformPosition(cacheEntry.waveform, cacheEntry.player.currentTime, cacheEntry.player.duration);
    cacheEntry.waveformAnimationId = requestAnimationFrame(step);
  };
  cacheEntry.waveformAnimationId = requestAnimationFrame(step);
}

export function ensureWaveformBarElements(state, count) {
  if (!state || !state.contentEl) return [];
  const sanitizedCount = Math.max(0, Math.min(count || 0, WAVEFORM_MAX_BAR_COUNT));
  let bars = Array.from(state.contentEl.children);

  if (bars.length > sanitizedCount) {
    for (let index = bars.length - 1; index >= sanitizedCount; index -= 1) {
      state.contentEl.removeChild(bars[index]);
    }
    bars = Array.from(state.contentEl.children);
  } else if (bars.length < sanitizedCount) {
    const fragment = document.createDocumentFragment();
    for (let index = bars.length; index < sanitizedCount; index += 1) {
      const bar = document.createElement('div');
      bar.className = 'waveform-bar';
      fragment.appendChild(bar);
    }
    state.contentEl.appendChild(fragment);
    bars = Array.from(state.contentEl.children);
  }

  state.barElements = bars;
  state.barCount = bars.length;
  state.minContentWidth = Math.max(state.minContentWidth || 0, bars.length * WAVEFORM_BAR_STEP + 160);
  return bars;
}

function placeholderWaveformValue(index, total) {
  if (!Number.isFinite(total) || total <= 0) return 0.3;
  const t = index / total;
  const base = 0.35 + 0.25 * Math.sin(t * Math.PI * 4);
  const envelope = 0.2 + 0.8 * Math.sin(Math.PI * Math.min(t, 1 - t));
  return Math.max(0.1, Math.min(1, base + envelope * 0.3));
}

export function applyWaveformValues(state, values, options = {}) {
  if (!state || !state.contentEl) return;
  const { peak: providedPeak, amplitudeFloor = WAVEFORM_AMPLITUDE_FLOOR, duration: providedDuration } = options;
  let peak = 0;
  const sanitized = Array.isArray(values) && values.length
    ? values.map((v) => {
        const clamped = Math.max(0, Math.min(1, Number(v) || 0));
        const floored = Math.max(0, clamped - amplitudeFloor);
        peak = Math.max(peak, floored);
        return floored;
      })
    : null;
  if (sanitized) {
    const normalizedProvidedPeak = Number.isFinite(providedPeak) ? Math.max(0, providedPeak - amplitudeFloor) : null;
    const resolvedPeak = normalizedProvidedPeak && normalizedProvidedPeak > 0 ? normalizedProvidedPeak : peak;
    state.waveformPeak = Math.max(resolvedPeak, 0.0001);
  } else if (!state.waveformPeak) {
    state.waveformPeak = 1;
  }
  const targetCount = sanitized ? sanitized.length : Math.max(WAVEFORM_MIN_BAR_COUNT, options.placeholderCount || 0);
  const bars = ensureWaveformBarElements(state, targetCount);

  const totalBars = bars.length || 1;
  const resolvedDuration = Number.isFinite(providedDuration) && providedDuration > 0 ? providedDuration : null;
  if (resolvedDuration && sanitized) {
    state.waveformDuration = resolvedDuration;
    state.secondsPerBar = resolvedDuration / totalBars;
  } else if (!state.waveformDuration) {
    state.waveformDuration = null;
    state.secondsPerBar = null;
  }
  const secondsPerBar = state.secondsPerBar && state.secondsPerBar > 0
    ? state.secondsPerBar
    : WAVEFORM_VIEW_WINDOW_SECONDS / totalBars;
  state.pixelsPerSecond = WAVEFORM_BAR_STEP / Math.max(secondsPerBar, 0.0001);

  for (let index = 0; index < bars.length; index += 1) {
    let amplitude = sanitized ? sanitized[index] : placeholderWaveformValue(index, totalBars);
    if (sanitized && state.waveformPeak > 0) {
      amplitude = Math.max(0, amplitude / state.waveformPeak);
    }
    const height = 24 + amplitude * 92;
    bars[index].style.height = `${Math.max(12, Math.min(120, height))}px`;
    bars[index].style.opacity = `${0.4 + amplitude * 0.5}`;
  }

  state.waveformValues = sanitized;
  state.barCount = bars.length;
  state.minContentWidth = Math.max(state.minContentWidth || 0, bars.length * WAVEFORM_BAR_STEP + 160);
}

export async function populateWaveformFromSource(cacheEntry, explicitUrl, explicitBlob) {
  if (!cacheEntry) return null;
  if (cacheEntry.waveformData?.values?.length) {
    if (cacheEntry.waveform) {
      applyWaveformValues(cacheEntry.waveform, cacheEntry.waveformData.values, {
        peak: cacheEntry.waveformData.peak,
        duration: cacheEntry.waveformData.duration
      });
    }
    return cacheEntry.waveformData;
  }
  if (cacheEntry.waveformDataPromise) {
    try {
      const existing = await cacheEntry.waveformDataPromise;
      if (cacheEntry.waveform && existing?.values) {
        applyWaveformValues(cacheEntry.waveform, existing.values, {
          peak: existing.peak,
          duration: existing.duration
        });
      }
      return existing;
    } catch (err) {
      return null;
    }
  }

  const sourceBlob = explicitBlob || cacheEntry.sourceBlob || null;
  const sourceUrl = explicitUrl || cacheEntry.sourceUrl || null;
  if (!sourceBlob && !sourceUrl) return null;

  const generationPromise = (async () => {
    try {
      let arrayBuffer = null;
      if (sourceBlob) {
        arrayBuffer = await sourceBlob.arrayBuffer();
      } else if (sourceUrl) {
        const response = await fetch(sourceUrl, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        arrayBuffer = await response.arrayBuffer();
      }

      if (!arrayBuffer) return null;

      const audioContext = getWaveformAudioContext();
      if (!audioContext) return null;

      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (resumeErr) {
          console.debug('No se pudo reanudar el AudioContext antes de decodificar:', resumeErr);
        }
      }

      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const channelData = decodedBuffer.getChannelData(0);
      if (!channelData || !channelData.length) return null;

      const duration = decodedBuffer.duration || cacheEntry.player?.duration || 0;
      const totalSamples = channelData.length;
      const desiredCount = Math.max(
        WAVEFORM_MIN_BAR_COUNT,
        Math.min(
          WAVEFORM_MAX_BAR_COUNT,
          Math.round((duration || totalSamples / decodedBuffer.sampleRate) * WAVEFORM_SAMPLES_PER_SECOND)
        )
      );
      const blockSize = Math.max(1, Math.floor(totalSamples / desiredCount));
      const amplitudes = [];
      let maxAmplitude = 0;

      for (let i = 0; i < desiredCount; i += 1) {
        const start = i * blockSize;
        let peak = 0;
        for (let j = 0; j < blockSize && (start + j) < totalSamples; j += 1) {
          const sample = Math.abs(channelData[start + j]);
          if (sample > peak) {
            peak = sample;
          }
        }
        const amplitude = Math.min(1, Math.max(0, peak));
        amplitudes.push(amplitude);
        maxAmplitude = Math.max(maxAmplitude, amplitude);
      }

      return { values: amplitudes, duration, peak: maxAmplitude };
    } catch (err) {
      console.error('No se pudo generar la forma de onda real:', err);
      return null;
    }
  })();

  cacheEntry.waveformDataPromise = generationPromise;

  try {
    const result = await generationPromise;
    cacheEntry.waveformDataPromise = null;
    if (result?.values?.length) {
      cacheEntry.waveformData = result;
      if (cacheEntry.waveform) {
        applyWaveformValues(cacheEntry.waveform, result.values, {
          peak: result.peak,
          duration: result.duration
        });
        if (!cacheEntry.waveform.duration && result.duration) {
          cacheEntry.waveform.duration = result.duration;
        }
      }
    }
    return result;
  } catch (err) {
    cacheEntry.waveformDataPromise = null;
    console.error('Error inesperado generando la forma de onda:', err);
    return null;
  }
}

export function computeWaveformMetrics(viewportEl) {
  if (!viewportEl) return null;
  const width = viewportEl.getBoundingClientRect().width || viewportEl.offsetWidth || 0;
  if (!width) return null;
  return {
    viewportWidth: width,
    initialOffset: width / 2,
    pixelsPerSecond: width / WAVEFORM_VIEW_WINDOW_SECONDS
  };
}

export function refreshWaveformMetrics(state) {
  if (!state) return null;
  const metrics = computeWaveformMetrics(state.viewportEl);
  if (!metrics) return null;
  state.metrics = metrics;
  return metrics;
}

export function updateWaveformDimensions(state, duration) {
  if (!state || !state.contentEl) return;
  const metrics = state.metrics || refreshWaveformMetrics(state);
  if (!metrics) {
    requestAnimationFrame(() => updateWaveformDimensions(state, duration));
    return;
  }
  const effectiveDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const pixelsPerSecond = state.pixelsPerSecond || metrics.pixelsPerSecond;
  const totalWidth = metrics.initialOffset + (effectiveDuration + WAVEFORM_HALF_WINDOW_SECONDS) * pixelsPerSecond;
  const minWidth = Math.max(state.minContentWidth || 0, metrics.viewportWidth * 1.5);
  state.contentEl.style.width = `${Math.max(totalWidth, minWidth)}px`;
}

export function applyWaveformPosition(state, currentTime, duration) {
  if (!state || !state.contentEl) return;
  const metrics = state.metrics || refreshWaveformMetrics(state);
  if (!metrics) {
    requestAnimationFrame(() => applyWaveformPosition(state, currentTime, duration));
    return;
  }
  const paddingLeft = state.contentPaddingLeft || 0;
  const rawTime = Number(currentTime) || 0;
  const effectiveTime = Math.max(0, rawTime);
  const effectiveDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  state.duration = effectiveDuration;
  state.lastCurrentTime = effectiveTime;
  updateWaveformDimensions(state, effectiveDuration);
  const contentWidth = state.contentEl.offsetWidth || 0;
  const minOffset = metrics.viewportWidth - contentWidth;
  const pixelsPerSecond = state.pixelsPerSecond || metrics.pixelsPerSecond;
  const baseOffset = metrics.initialOffset - paddingLeft;
  const offset = Math.max(minOffset, baseOffset - (effectiveTime * pixelsPerSecond));
  state.contentEl.style.transform = `translateX(${offset}px)`;
}

export function resetWaveformState(state) {
  if (!state || !state.contentEl) return;
  const metrics = refreshWaveformMetrics(state);
  if (!metrics) {
    requestAnimationFrame(() => resetWaveformState(state));
    return;
  }
  state.lastCurrentTime = 0;
  updateWaveformDimensions(state, state.duration || 0);
  const paddingLeft = state.contentPaddingLeft || 0;
  const baseOffset = metrics.initialOffset - paddingLeft;
  state.contentEl.style.transform = `translateX(${baseOffset}px)`;
}

export function buildWaveformState(waveformElements, seed) {
  if (!waveformElements) return null;
  const { viewportEl, contentEl } = waveformElements;
  if (!viewportEl || !contentEl) return null;
  const computedStyle = window.getComputedStyle(contentEl);
  const paddingLeft = parseFloat(computedStyle.paddingLeft || '0') || 0;
  const paddingRight = parseFloat(computedStyle.paddingRight || '0') || 0;
  const state = {
    viewportEl,
    contentEl,
    metrics: computeWaveformMetrics(viewportEl),
    duration: 0,
    lastCurrentTime: 0,
    barCount: 0,
    minContentWidth: 0,
    waveformValues: null,
    waveformPeak: 1,
    waveformDuration: null,
    secondsPerBar: null,
    pixelsPerSecond: null,
    contentPaddingLeft: paddingLeft,
    contentPaddingRight: paddingRight
  };
  applyWaveformValues(state, null, { placeholderCount: WAVEFORM_MIN_BAR_COUNT });
  if (state.metrics) {
    const baseOffset = state.metrics.initialOffset - paddingLeft;
    state.contentEl.style.transform = `translateX(${baseOffset}px)`;
  } else {
    requestAnimationFrame(() => {
      const metrics = refreshWaveformMetrics(state);
      if (metrics) {
        const refreshedOffset = metrics.initialOffset - paddingLeft;
        state.contentEl.style.transform = `translateX(${refreshedOffset}px)`;
      }
    });
  }
  return state;
}
