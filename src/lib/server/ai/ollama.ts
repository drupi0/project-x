import { AIError, type AIProvider } from './provider';
import { MAX_MESSAGE_LENGTH } from '../../types/chat';
import { finalReply } from './final-reply';

export class OllamaProvider implements AIProvider {
  constructor(
    private config: { baseUrl: string; model: string; timeoutMs: number; debug?: boolean },
    private fetcher: typeof fetch = fetch
  ) {}

  async chat({ systemPrompt, messages, signal }: Parameters<AIProvider['chat']>[0]) {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const started = Date.now();
    const requestId = crypto.randomUUID();
    // Only explicitly selected metadata may enter logs. Never log bodies or error objects.
    const log = (event: string, details: Record<string, number | boolean | string> = {}) => {
      if (this.config.debug) console.info('[ollama]', JSON.stringify({
        requestId, event, model: this.config.model, elapsedMs: Date.now() - started, ...details
      }));
    };
    log('request_started', { messageCount: messages.length });
    try {
      const response = await this.fetcher(new URL('/api/chat', this.config.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          think: false,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          // Allow room for models that generate thinking despite think:false.
          // Only the final answer is returned to the browser.
          options: { temperature: 0.3, num_predict: 2048, num_ctx: 16384 }
        })
      });
      log('response_headers', { status: response.status });
      if (!response.ok) {
        if (response.status === 404) {
          throw new AIError('The configured model was not found. Download it with Ollama, then retry.');
        }
        throw new AIError('The local model could not respond. Check Ollama and try again.');
      }
      const data = await response.json();
      const content = data?.message?.content;
      log('response_received', {
        completed: data?.done === true,
        tokenLimitReached: data?.done_reason === 'length',
        hasThinking: typeof data?.message?.thinking === 'string' && data.message.thinking.length > 0,
        hasContent: typeof content === 'string' && content.trim().length > 0,
        ...(Number.isFinite(data?.eval_count) ? { generatedTokens: data.eval_count } : {}),
        ...(Number.isFinite(data?.prompt_eval_count) ? { promptTokens: data.prompt_eval_count } : {})
      });
      if (data?.done === false || data?.done_reason === 'length') {
        throw new AIError('The model did not finish a usable reply. Please retry.', 502);
      }
      if (data?.message?.role !== 'assistant' || typeof content !== 'string' ||
          !content.trim()) {
        throw new AIError('The model returned an invalid response. Please retry.', 502);
      }
      const answer = finalReply(content);
      if (answer.length > MAX_MESSAGE_LENGTH) {
        throw new AIError('The model returned an invalid response. Please retry.', 502);
      }
      return { role: 'assistant' as const, content: answer };
    } catch (error) {
      log('request_failed', {
        category: timeout.aborted ? 'timeout' : signal?.aborted ? 'cancelled'
          : error instanceof AIError ? 'provider_error' : 'network_or_json_error',
        status: error instanceof AIError ? error.status : 0
      });
      if (error instanceof AIError) throw error;
      if (timeout.aborted) throw new AIError('The model took too long. Please retry; its first response may need more time.', 504);
      if (signal?.aborted) throw new AIError('The request was cancelled.', 499);
      throw new AIError('Cannot reach the local model. Start Ollama and check the server configuration.');
    }
  }
}
