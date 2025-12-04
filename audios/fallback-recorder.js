// Fallback recorder using native MediaRecorder API
// Used when ScriptProcessor-based recording fails (e.g., Samsung devices)

let fallbackMediaRecorder = null;
let fallbackStream = null;
let fallbackChunks = [];
let fallbackMimeType = 'audio/webm';

// Check what mime types are supported
function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg'
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

// Check if fallback recorder is available
export function isFallbackRecorderAvailable() {
  return typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia;
}

// Start fallback recording
export async function startFallbackRecording() {
  if (!isFallbackRecorderAvailable()) {
    throw new Error('MediaRecorder not supported');
  }
  
  // Clean up any previous recording
  cleanupFallbackRecording();
  
  // Request microphone access with minimal constraints (let device choose native rate)
  const constraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  };
  
  try {
    fallbackStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error('Fallback recorder: Failed to get microphone access:', err);
    throw err;
  }
  
  fallbackMimeType = getSupportedMimeType();
  fallbackChunks = [];
  
  const options = fallbackMimeType ? { mimeType: fallbackMimeType } : {};
  
  try {
    fallbackMediaRecorder = new MediaRecorder(fallbackStream, options);
  } catch (err) {
    console.error('Fallback recorder: Failed to create MediaRecorder:', err);
    cleanupFallbackRecording();
    throw err;
  }
  
  fallbackMediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      fallbackChunks.push(event.data);
    }
  };
  
  fallbackMediaRecorder.start(100); // Collect data every 100ms
  
  return {
    state: 'recording',
    mimeType: fallbackMimeType || 'audio/webm'
  };
}

// Stop fallback recording and return the blob
export function stopFallbackRecording() {
  return new Promise((resolve, reject) => {
    if (!fallbackMediaRecorder || fallbackMediaRecorder.state !== 'recording') {
      reject(new Error('No active fallback recording'));
      return;
    }
    
    fallbackMediaRecorder.onstop = () => {
      const blob = new Blob(fallbackChunks, { type: fallbackMimeType || 'audio/webm' });
      const mimeType = fallbackMimeType || 'audio/webm';
      
      // Stop all tracks
      if (fallbackStream) {
        fallbackStream.getTracks().forEach(track => track.stop());
      }
      
      resolve({ blob, mimeType });
    };
    
    fallbackMediaRecorder.onerror = (event) => {
      console.error('Fallback recorder error:', event.error);
      cleanupFallbackRecording();
      reject(event.error);
    };
    
    fallbackMediaRecorder.stop();
  });
}

// Check if fallback recorder is currently recording
export function isFallbackRecording() {
  return fallbackMediaRecorder && fallbackMediaRecorder.state === 'recording';
}

// Discard/cleanup fallback recording
export function cleanupFallbackRecording() {
  if (fallbackMediaRecorder) {
    try {
      if (fallbackMediaRecorder.state === 'recording') {
        fallbackMediaRecorder.stop();
      }
    } catch (e) {
      // Ignore errors during cleanup
    }
    fallbackMediaRecorder = null;
  }
  
  if (fallbackStream) {
    try {
      fallbackStream.getTracks().forEach(track => track.stop());
    } catch (e) {
      // Ignore errors during cleanup
    }
    fallbackStream = null;
  }
  
  fallbackChunks = [];
}
