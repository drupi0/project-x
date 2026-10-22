import { SpeechError, type SpeechToTextProvider } from './provider';
import { WhisperProvider } from './whisper';

export function createSpeechProvider(env: Record<string, string | undefined>, fetcher?: typeof fetch): SpeechToTextProvider {
  if ((env.STT_PROVIDER || 'whisper') !== 'whisper') throw new SpeechError('The speech provider configuration is unsupported.');
  let url: URL;
  try { url = new URL(env.WHISPER_BASE_URL || 'http://127.0.0.1:8081'); }
  catch { throw new SpeechError('The speech service configuration is invalid.'); }
  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  if (env.STT_ALLOW_DOCKER === '1') hosts.push('whisper', 'host.docker.internal');
  if (url.protocol !== 'http:' || !hosts.includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new SpeechError('The speech service must use an approved local address.');
  }
  const timeoutMs = Number(env.STT_TIMEOUT_MS || '120000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new SpeechError('The speech timeout configuration is invalid.');
  return new WhisperProvider({ baseUrl: url.href, timeoutMs }, fetcher);
}
