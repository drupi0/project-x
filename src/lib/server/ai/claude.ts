import { AIError, type AIProvider } from './provider';
import { MAX_MESSAGE_LENGTH } from '../../types/chat';
import { finalReply } from './final-reply';
import { CLAUDE_INTERVIEW_OUTPUT_SCHEMA } from '../../interview/output-schema';
import { redactRawModelOutput } from './redact-debug-output';

export class ClaudeProvider implements AIProvider {
  constructor(
    private config: { token: string; model: string; timeoutMs: number; debug?: boolean; debugRawFictional?: boolean },
    private fetcher: typeof fetch = fetch
  ) {}

  async chat({ systemPrompt, messages, signal, diagnostics }: Parameters<AIProvider['chat']>[0]) {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const started = Date.now();
    const requestId = diagnostics?.requestId ?? crypto.randomUUID();
    const attempt = diagnostics?.attempt ?? 'original';
    const log = (event: string, status?: number, details: Record<string, unknown> = {}) => {
      if (this.config.debug) console.info('[claude]', JSON.stringify({
        requestId, attempt, event, ...(status === undefined ? {} : { status }),
        elapsedMs: Date.now() - started, ...details
      }));
    };
    log('request_started');
    try {
      const response = await this.fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.token,
          'anthropic-version': '2023-06-01'
        },
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 2048,
          stream: false,
          output_config: {
            format: { type: 'json_schema', schema: CLAUDE_INTERVIEW_OUTPUT_SCHEMA }
          },
          system: systemPrompt,
          messages
        })
      });
      log('response_headers', response.status, {
        contentType: response.headers.get('content-type') ?? 'missing'
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          throw new AIError('Claude authentication failed. Check CLAUDE_TOKEN and API access.', 503);
        }
        if (response.status === 429) {
          throw new AIError('Claude is rate limited. Please wait a moment and retry.', 429);
        }
        if (response.status === 404) {
          throw new AIError('The configured Claude model is unavailable. Check CLAUDE_MODEL.', 503);
        }
        throw new AIError('Claude could not respond. Check API access and retry.', 503);
      }
      let data: any;
      try {
        data = await response.json();
      } catch {
        log('api_json_parse_failed', response.status);
        throw new AIError('Claude returned an unreadable API response. Please retry.', 502);
      }
      log('api_json_parse_succeeded');
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const text = blocks
        .filter((block: { type?: unknown; text?: unknown } | null) =>
          block?.type === 'text' && typeof block.text === 'string')
        .map((block: { text: string }) => block.text).join('\n\n');
      log('response_metadata', undefined, {
        responseRole: typeof data?.role === 'string' ? data.role : 'missing',
        completionStatus: data?.stop_reason === 'end_turn' ? 'complete' : 'incomplete_or_other',
        stopReason: typeof data?.stop_reason === 'string' ? data.stop_reason : 'missing',
        contentBlockCount: blocks.length,
        contentBlockTypes: blocks.map((block: { type?: unknown }) =>
          typeof block?.type === 'string' ? block.type : 'unknown'),
        textBlockCount: blocks.filter((block: { type?: unknown; text?: unknown } | null) =>
          block?.type === 'text' && typeof block.text === 'string').length,
        textLength: text.length
      });
      if (this.config.debugRawFictional && process.env.NODE_ENV === 'development') {
        // This is intentionally redacted: keep structure, schema keys, and enum values only.
        console.info('[claude]', JSON.stringify({
          requestId, attempt, event: 'raw_response_redacted', content: redactRawModelOutput(text)
        }));
      }
      if (data?.role !== 'assistant' || data?.stop_reason !== 'end_turn' ||
          !Array.isArray(data?.content)) {
        throw new AIError('Claude did not finish a usable reply. Please retry.', 502);
      }
      // Thinking, tool-use, and other non-text blocks never enter the conversation.
      if (!text.trim()) {
        log('content_extraction_failed', undefined, { category: 'no_text_blocks' });
        throw new AIError('Claude did not return a usable text response. Please retry.', 502);
      }
      log('content_extracted', undefined, { contentType: 'text', textLength: text.length });
      const content = finalReply(text);
      if (content.length > MAX_MESSAGE_LENGTH) {
        throw new AIError('Claude returned an oversized reply. Please retry.', 502);
      }
      log('request_completed');
      return { role: 'assistant' as const, content };
    } catch (error) {
      log(timeout.aborted ? 'request_timeout' : signal?.aborted ? 'request_cancelled' : 'request_failed');
      if (error instanceof AIError) throw error;
      if (timeout.aborted) throw new AIError('Claude took too long. Please retry.', 504);
      if (signal?.aborted) throw new AIError('The request was cancelled.', 499);
      throw new AIError('Cannot get a usable response from Claude. Check the connection and retry.', 503);
    }
  }
}
