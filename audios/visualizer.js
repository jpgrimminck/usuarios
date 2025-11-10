import * as waveformModule from './waveform.js';
import * as sliderModule from './slider.js';

const VISUALIZER_MODULES = {
  waveform: waveformModule,
  slider: sliderModule
};

const FORCED_VISUALIZER_MODE = 'slider'; // Cambia a 'slider' o 'waveform' para forzar el modo


function normalizeMode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'slider' || normalized === 'waveform' ? normalized : null;
}

function resolveVisualizationMode() {
  const forced = normalizeMode(FORCED_VISUALIZER_MODE);
  if (forced) return forced;

  if (typeof window === 'undefined') return 'waveform';

  const globalPreference = normalizeMode(window.AUDIO_VISUALIZATION_MODE);
  if (globalPreference) return globalPreference;

  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = normalizeMode(params.get('visualizer') || params.get('viz') || params.get('view'));
    if (fromQuery) return fromQuery;
  } catch (err) {
    // Ignoramos problemas al parsear la URL.
  }

  return 'waveform';
}

const RESOLVED_MODE = resolveVisualizationMode();
const ACTIVE_MODULE = VISUALIZER_MODULES[RESOLVED_MODE] || waveformModule;

function maybeCall(fn, fallback = null) {
  if (typeof fn === 'function') {
    return (...args) => fn(...args);
  }
  return (...args) => (typeof fallback === 'function' ? fallback(...args) : fallback);
}

export const buildWaveformState = maybeCall(ACTIVE_MODULE.buildWaveformState, () => null);
export const refreshWaveformMetrics = maybeCall(ACTIVE_MODULE.refreshWaveformMetrics, () => null);
export const resetWaveformState = maybeCall(ACTIVE_MODULE.resetWaveformState);
export const populateWaveformFromSource = maybeCall(ACTIVE_MODULE.populateWaveformFromSource, () => Promise.resolve(null));
export const applyWaveformValues = maybeCall(ACTIVE_MODULE.applyWaveformValues);
export const applyWaveformPosition = maybeCall(ACTIVE_MODULE.applyWaveformPosition);
export const startWaveformAnimation = maybeCall(ACTIVE_MODULE.startWaveformAnimation);
export const stopWaveformAnimation = maybeCall(ACTIVE_MODULE.stopWaveformAnimation);

export function getVisualizerMode() {
  return RESOLVED_MODE;
}

export function isWaveformMode() {
  return ACTIVE_MODULE === waveformModule;
}

export function isSliderMode() {
  return ACTIVE_MODULE === sliderModule;
}
