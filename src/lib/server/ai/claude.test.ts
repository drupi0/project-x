import { describe, expect, it, vi } from 'vitest';
import { createProvider } from './index';
import { ClaudeProvider } from './claude';
import { OllamaProvider } from './ollama';
import { CLAUDE_INTERVIEW_OUTPUT_SCHEMA } from '../../interview/output-schema';
import { redactRawModelOutput } from './redact-debug-output';

const input = {
  systemPrompt: 'PRIVATE_SYSTEM',
  messages: [
    { role: 'user' as const, content: 'PRIVATE_STORY' },
    { role: 'assistant' as const, content: 'Earlier reply' },
    { role: 'user' as const, content: 'Correction' }
  ]
};
const success = {
  role: 'assistant', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: 'PRIVATE_THINKING' }, { type: 'text', text: 'Hello!' }]
};

describe('Claude provider', () => {
  it('selects Claude when a token is set, overriding AI_PROVIDER and Ollama configuration', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(success));
    const provider = createProvider({
      CLAUDE_TOKEN: ' PRIVATE_TOKEN ', CLAUDE_MODEL: 'custom-claude-model',
      AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'invalid'
    }, fetcher);
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(await provider.chat(input)).toEqual({ role: 'assistant', content: 'Hello!' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options?.headers).toMatchObject({
      'x-api-key': 'PRIVATE_TOKEN', 'anthropic-version': '2023-06-01'
    });
    expect(options?.redirect).toBe('error');
    expect(JSON.parse(options!.body as string)).toEqual({
      model: 'custom-claude-model', stream: false, max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: CLAUDE_INTERVIEW_OUTPUT_SCHEMA } },
      system: input.systemPrompt, messages: input.messages
    });
  });
  it.each([undefined, '', '   '])('keeps Ollama when the token is absent or blank', (token) => {
    expect(createProvider({ CLAUDE_TOKEN: token })).toBeInstanceOf(OllamaProvider);
  });
  it.each([401, 403, 404, 429, 500, 529])('handles HTTP %i without leaking details or falling back', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_UPSTREAM', { status }));
    await expect(createProvider({ CLAUDE_TOKEN: 'PRIVATE_TOKEN' }, fetcher).chat(input))
      .rejects.toMatchObject({ status: status === 429 ? 429 : 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('classifies malformed Anthropic API JSON without logging its body', async () => {
    const logger = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE_UPSTREAM_BODY', {
        status: 200, headers: { 'content-type': 'application/json' }
      }));
      await expect(createProvider({ CLAUDE_TOKEN: 'PRIVATE_TOKEN', AI_DEBUG: '1' }, fetcher).chat(input))
        .rejects.toMatchObject({ status: 502 });
      const logs = JSON.stringify(logger.mock.calls);
      expect(logs).toContain('api_json_parse_failed');
      expect(logs).not.toContain('PRIVATE_');
    } finally {
      logger.mockRestore();
    }
  });
  it.each([
    { ...success, stop_reason: 'max_tokens' },
    { ...success, stop_reason: 'tool_use' },
    { ...success, role: 'user' },
    { ...success, content: [] },
    { ...success, content: [{ type: 'thinking', thinking: 'private' }] },
    { ...success, content: [{ type: 'text', text: 'x'.repeat(24001) }] }
  ])('rejects incomplete or invalid output', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(createProvider({ CLAUDE_TOKEN: 'test' }, fetcher).chat(input)).rejects.toMatchObject({ status: 502 });
  });
  it('strips thinking markup from text blocks', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ...success, content: [{ type: 'text', text: 'private</think>Hello!' }]
    }));
    expect(await createProvider({ CLAUDE_TOKEN: 'test' }, fetcher).chat(input))
      .toEqual({ role: 'assistant', content: 'Hello!' });
  });
  it('sanitizes network errors and diagnostics', async () => {
    const logger = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE_NETWORK_ERROR'));
      await expect(createProvider({ CLAUDE_TOKEN: 'PRIVATE_TOKEN', AI_DEBUG: '1' }, fetcher).chat(input))
        .rejects.toThrow('Cannot get a usable response from Claude');
      expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_');
      expect(JSON.stringify(logger.mock.calls)).toContain('request_failed');
    } finally {
      logger.mockRestore();
    }
  });
  it('correlates safe response metadata and only emits masked output in explicit development mode', async () => {
    const logger = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fixture = {
      ...success,
      content: [{ type: 'text', text: '{"reply":"Amina is in Cairo.","intake":{}}' }]
    };
    try {
      vi.stubEnv('NODE_ENV', 'development');
      const provider = createProvider({
        CLAUDE_TOKEN: 'test', AI_DEBUG: '1', AI_DEBUG_RAW_FICTIONAL: '1'
      }, vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture)));
      await provider.chat({ ...input, diagnostics: { requestId: 'trace-123', attempt: 'repair' } });
      let logs = JSON.stringify(logger.mock.calls);
      expect(logs).toContain('trace-123');
      expect(logs).toContain('repair');
      expect(logs).toContain('stopReason');
      expect(logs).toContain('raw_response_redacted');
      expect(logs).not.toContain('Amina');
      expect(logs).not.toContain('Cairo');

      logger.mockClear();
      vi.stubEnv('NODE_ENV', 'production');
      const productionProvider = createProvider({
        CLAUDE_TOKEN: 'test', AI_DEBUG: '1', AI_DEBUG_RAW_FICTIONAL: '1'
      }, vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture)));
      await productionProvider.chat(input);
      logs = JSON.stringify(logger.mock.calls);
      expect(logs).not.toContain('raw_response_redacted');
      expect(logs).not.toContain('Amina');
    } finally {
      vi.unstubAllEnvs();
      logger.mockRestore();
    }
  });
  it('redacts free text, identifiers, and secrets while retaining JSON shape labels', () => {
    const output = redactRawModelOutput(
      '{"reply":"Amina lives in Cairo","api_key":"sk-ant-testsecret","status":"declined"}'
    );
    expect(output).toContain('"reply"');
    expect(output).toContain('"status":"declined"');
    expect(output).not.toContain('Amina');
    expect(output).not.toContain('Cairo');
    expect(output).not.toContain('sk-ant-testsecret');
  });
  it.each(['timeout', 'cancel'])('handles %s', async (mode) => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
    const provider = new ClaudeProvider({ token: 'test', model: 'test', timeoutMs: mode === 'timeout' ? 10 : 1000 }, fetcher);
    const response = provider.chat({ ...input, signal: controller.signal });
    if (mode === 'cancel') controller.abort();
    await expect(response).rejects.toMatchObject({ status: mode === 'timeout' ? 504 : 499 });
  });
  it('validates shared timeout and Claude model configuration', () => {
    expect(() => createProvider({ CLAUDE_TOKEN: 'test', AI_TIMEOUT_MS: 'bad' })).toThrow();
    expect(() => createProvider({ CLAUDE_TOKEN: 'test', CLAUDE_MODEL: 'bad\nmodel' })).toThrow();
  });
});
