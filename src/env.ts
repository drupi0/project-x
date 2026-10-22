import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  STT_PROVIDER: { schema: (value) => value || 'whisper' },
  WHISPER_BASE_URL: { schema: (value) => value || 'http://127.0.0.1:8081' },
  STT_ALLOW_DOCKER: { schema: (value) => value || '0' },
  STT_TIMEOUT_MS: { schema: (value) => value || '120000' },
  CLAUDE_TOKEN: { schema: (value) => value || '' },
  CLAUDE_MODEL: { schema: (value) => value || 'claude-haiku-4-5-20251001' },
  AI_DEBUG: { schema: (value) => value || '0' },
  AI_DEBUG_RAW_FICTIONAL: { schema: (value) => value || '0' },
  AI_PROVIDER: { schema: (value) => value || 'ollama' },
  OLLAMA_BASE_URL: { schema: (value) => value || 'http://localhost:11434' },
  OLLAMA_ALLOW_DOCKER: { schema: (value) => value || '0' },
  OLLAMA_MODEL: { schema: (value) => value || 'qwen3:4b' },
  AI_TIMEOUT_MS: { schema: (value) => value || '120000' }
});
