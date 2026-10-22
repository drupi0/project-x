import { AUDIO_SAMPLE_RATE, MAX_AUDIO_SECONDS } from '../types/speech.ts';

export function encodeWav(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_SAMPLE_RATE, true); view.setUint32(28, AUDIO_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true); });
  return bytes;
}

export async function recordingToWav(recording: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    if (decoded.duration < 0.2 || decoded.duration > MAX_AUDIO_SECONDS + 1) throw new Error('Record between a moment and 60 seconds, then try again.');
    const length = Math.min(Math.ceil(decoded.duration * AUDIO_SAMPLE_RATE), MAX_AUDIO_SECONDS * AUDIO_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, AUDIO_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    return encodeWav((await offline.startRendering()).getChannelData(0));
  } finally { await context.close(); }
}
