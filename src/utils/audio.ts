/**
 * Converts a recorded audio Blob into a 16kHz Float32Array
 * that Whisper expects as input.
 * 
 * MediaRecorder outputs webm/opus, so we use AudioContext
 * to decode and resample to 16kHz mono.
 */
export const processAudio = async (audioBlob: Blob): Promise<Float32Array> => {
  console.log('[Audio] Processing blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
  
  // Create offline context at 16kHz (Whisper's expected sample rate)
  const arrayBuffer = await audioBlob.arrayBuffer();
  
  // First decode at native sample rate
  const tempContext = new AudioContext();
  const decodedBuffer = await tempContext.decodeAudioData(arrayBuffer);
  await tempContext.close();
  
  console.log('[Audio] Decoded:', decodedBuffer.duration.toFixed(2), 'seconds,', 
    decodedBuffer.sampleRate, 'Hz,', decodedBuffer.numberOfChannels, 'channels');
  
  // Resample to 16kHz using OfflineAudioContext
  const targetSampleRate = 16000;
  const numSamples = Math.ceil(decodedBuffer.duration * targetSampleRate);
  const offlineContext = new OfflineAudioContext(1, numSamples, targetSampleRate);
  
  const source = offlineContext.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  
  const resampledBuffer = await offlineContext.startRendering();
  const float32Data = resampledBuffer.getChannelData(0);
  
  console.log('[Audio] Resampled to 16kHz:', float32Data.length, 'samples (',
    (float32Data.length / 16000).toFixed(2), 'seconds)');
  
  return float32Data;
};
