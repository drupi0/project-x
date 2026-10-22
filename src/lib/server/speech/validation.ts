import { AUDIO_SAMPLE_RATE, MAX_AUDIO_BYTES } from '../../types/speech';
import { SpeechError } from './provider';

/** Canonical mono PCM16 WAV is the provider-neutral upload format. */
export function validateWav(bytes: Uint8Array) {
  const fail = () => { throw new SpeechError('Use a recording from the microphone control (mono 16 kHz PCM WAV, up to 60 seconds).', 400); };
  if (bytes.length < 46 || bytes.length > MAX_AUDIO_BYTES || bytes.length % 2) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data' ||
      view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 ||
      view.getUint32(24, true) !== AUDIO_SAMPLE_RATE || view.getUint32(28, true) !== AUDIO_SAMPLE_RATE * 2 ||
      view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 ||
      view.getUint32(40, true) !== bytes.length - 44) return fail();
  let energy = 0;
  for (let i = 44; i < bytes.length; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
  if (Math.sqrt(energy / ((bytes.length - 44) / 2)) < 0.001) {
    throw new SpeechError('The recording is silent or too quiet. Please record again closer to the microphone.', 422);
  }
  return bytes;
}

export async function readAudio(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'audio/wav') throw new SpeechError('Send audio/wav.', 415);
  if (!request.body) throw new SpeechError('A recording is required.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new SpeechError('Recording is too large. Record up to 60 seconds.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const audio = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
  return validateWav(audio);
}
