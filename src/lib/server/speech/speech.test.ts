import { describe, expect, it, vi } from 'vitest';
import { encodeWav } from '../../audio/wav';
import { MAX_AUDIO_BYTES } from '../../types/speech';
import { validateWav } from './validation';
import { createSpeechProvider } from './index';
import { WhisperProvider } from './whisper';
import { handleTranscription } from './handler';
import { vocabularyHeaders } from '../../speech-output/vocabulary';

const audio = () => encodeWav(new Float32Array(1600).fill(0.1));
const request = (bytes = audio(), origin = 'http://localhost') => new Request('http://localhost/api/transcribe', {
  method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: origin }, body: bytes
});

describe('audio boundary', () => {
  it('accepts browser-encoded PCM WAV and clamps samples', () => {
    expect(validateWav(audio())).toEqual(audio());
    const bytes = encodeWav(new Float32Array([-2, 2]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
  });
  it.each([0, 20, 22, 24, 28, 32, 34, 36, 40])('rejects a corrupt WAV field at %i', offset => {
    const bytes = audio(); bytes[offset] ^= 255;
    expect(() => validateWav(bytes)).toThrow();
  });
  it('rejects silence and empty audio', () => {
    expect(() => validateWav(encodeWav(new Float32Array(1600)))).toThrow('silent');
    expect(() => validateWav(encodeWav(new Float32Array()))).toThrow();
  });
  it('bounds the actual body bytes without relying on Content-Length', async () => {
    const factory = vi.fn();
    expect((await handleTranscription(request(new Uint8Array(MAX_AUDIO_BYTES + 1)), factory)).status).toBe(413);
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects wrong media types and foreign origins before calling a provider', async () => {
    const factory = vi.fn();
    expect((await handleTranscription(new Request('http://localhost/api/transcribe', { method: 'POST', body: '{}' }), factory)).status).toBe(415);
    expect((await handleTranscription(request(audio(), 'https://foreign.example'), factory)).status).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });
  it('accepts equivalent loopback origins for local use', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'A fictional test.' });
    const response = await handleTranscription(request(audio(), 'http://127.0.0.1'), () => ({ transcribe }));
    expect(response.status).toBe(200);
  });
  it('works with any speech provider, returning text without caching', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'A fictional test.' });
    const response = await handleTranscription(request(), () => ({ transcribe }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ text: 'A fictional test.' });
    expect(transcribe).toHaveBeenCalledWith({ audio: audio(), signal: expect.any(AbortSignal) });
  });
  it('does not expose unexpected errors', async () => {
    const response = await handleTranscription(request(), () => ({ transcribe: async () => { throw new Error('PRIVATE_AUDIO'); } }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('PRIVATE');
  });
});

describe('Whisper adapter', () => {
  it('sends session vocabulary, clears it on the next session, and preserves raw recognition errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ text: ' car tom ' }));
    const provider = new WhisperProvider({ baseUrl: 'http://localhost:8081', timeoutMs: 1000 }, fetcher);
    const result = await provider.transcribe({ audio: audio(), vocabulary: ['Khartoum', 'مقديشو'] });
    expect(result).toEqual({ text: 'car tom', rawText: ' car tom ' });
    expect(result).not.toHaveProperty('confidence');
    expect((fetcher.mock.calls[0][1]!.body as FormData).get('prompt')).toBe('Khartoum, مقديشو');
    await provider.transcribe({ audio: audio() });
    expect((fetcher.mock.calls[1][1]!.body as FormData).get('prompt')).toBe('');
  });
  it('validates vocabulary at the audio endpoint and logs counts only', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'PRIVATE_TRANSCRIPT', rawText: 'PRIVATE_TRANSCRIPT' });
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const req = request();
      for (const [key, value] of Object.entries(vocabularyHeaders(['PRIVATE_NAME', 'مقديشو']))) req.headers.set(key, value);
      expect((await handleTranscription(req, () => ({ transcribe }), true)).status).toBe(200);
      expect(transcribe.mock.calls[0][0].vocabulary).toEqual(['PRIVATE_NAME', 'مقديشو']);
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
      const bad = request(); bad.headers.set('X-Transcription-Vocabulary', '%notjson');
      expect((await handleTranscription(bad, () => ({ transcribe }))).status).toBe(400);
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
  it('sends WAV to the configured service with fixed filename and preserves the spoken language', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: ' Hello. ' }));
    const provider = createSpeechProvider({ WHISPER_BASE_URL: 'http://whisper:8080', STT_ALLOW_DOCKER: '1' }, fetcher);
    expect(await provider.transcribe({ audio: audio() })).toEqual({ text: 'Hello.', rawText: ' Hello. ' });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://whisper:8080/inference');
    const form = options!.body as FormData;
    expect(form.get('language')).toBe('auto');
    expect(form.get('response_format')).toBe('json');
    expect(new Uint8Array(await (form.get('file') as Blob).arrayBuffer())).toEqual(audio());
    expect(options?.redirect).toBe('error');
  });
  it.each([
    { STT_PROVIDER: 'unknown' }, { WHISPER_BASE_URL: 'http://whisper:8080' },
    { WHISPER_BASE_URL: 'http://external.test', STT_ALLOW_DOCKER: '1' },
    { WHISPER_BASE_URL: 'http://user:secret@localhost' }, { STT_TIMEOUT_MS: 'NaN' }
  ])('rejects invalid configuration: %j', env => { expect(() => createSpeechProvider(env)).toThrow(); });
  it.each([{}, { text: '' }, { text: 42 }, { text: 'x'.repeat(4001) }])('rejects unusable transcripts', async body => {
    const provider = createSpeechProvider({}, vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    await expect(provider.transcribe({ audio: audio() })).rejects.toMatchObject({ status: 422 });
  });
  it('sanitizes upstream HTTP and network errors', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE', { status: 500 })), vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE'))]) {
      const response = await handleTranscription(request(), () => createSpeechProvider({}, fetcher));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('PRIVATE');
    }
  });
  it.each(['timeout', 'cancel'])('handles %s', async mode => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const provider = new WhisperProvider({ baseUrl: 'http://localhost', timeoutMs: mode === 'timeout' ? 10 : 1000 }, fetcher);
    const result = provider.transcribe({ audio: audio(), signal: controller.signal });
    if (mode === 'cancel') controller.abort();
    await expect(result).rejects.toMatchObject({ status: mode === 'timeout' ? 504 : 499 });
  });
});
