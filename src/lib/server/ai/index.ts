import { AIError, type AIProvider } from './provider';
import { OllamaProvider } from './ollama';
import { ClaudeProvider } from './claude';

export function createProvider(env: Record<string, string | undefined>, fetcher?: typeof fetch): AIProvider {
  const timeoutMs = Number(env.AI_TIMEOUT_MS || '120000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    throw new AIError('The AI timeout configuration is invalid.');
  }
  const token = env.CLAUDE_TOKEN?.trim();
  if (token) {
    const model = env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(model)) {
      throw new AIError('The Claude model configuration is invalid.');
    }
    return new ClaudeProvider({
      token, model, timeoutMs, debug: env.AI_DEBUG === '1',
      debugRawFictional: env.AI_DEBUG_RAW_FICTIONAL === '1' && process.env.NODE_ENV === 'development'
    }, fetcher);
  }
  if ((env.AI_PROVIDER || 'ollama') !== 'ollama') {
    throw new AIError('The AI provider configuration is unsupported.', 503);
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(env.OLLAMA_BASE_URL || 'http://localhost:11434');
  } catch {
    throw new AIError('The local model configuration is invalid.');
  }
  // Docker addresses are an explicit opt-in, not arbitrary remote inference.
  const allowedHosts = ['localhost', '127.0.0.1', '[::1]'];
  if (env.OLLAMA_ALLOW_DOCKER === '1') allowedHosts.push('host.docker.internal');
  if (baseUrl.protocol !== 'http:' ||
      !allowedHosts.includes(baseUrl.hostname) ||
      baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
      baseUrl.pathname !== '/') {
    throw new AIError('Ollama requires a loopback address or an explicitly enabled Docker host.');
  }
  const model = env.OLLAMA_MODEL || 'qwen3:4b';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model) || /cloud/i.test(model)) {
    throw new AIError('The local model or timeout configuration is invalid.');
  }
  return new OllamaProvider({ baseUrl: baseUrl.href, model, timeoutMs, debug: env.AI_DEBUG === '1' }, fetcher);
}
