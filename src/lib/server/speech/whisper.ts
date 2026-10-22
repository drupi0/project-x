import { SpeechError, type SpeechToTextProvider } from './provider';
import { MAX_MESSAGE_LENGTH } from '../../types/chat';

export class WhisperProvider implements SpeechToTextProvider {
  constructor(private config: { baseUrl: string; timeoutMs: number }, private fetcher: typeof fetch = fetch) {}

  async transcribe({ audio, signal }: Parameters<SpeechToTextProvider['transcribe']>[0]) {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    try {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'recording.wav');
      form.set('response_format', 'json');
      form.set('language', 'auto');
      const response = await this.fetcher(new URL('/inference', this.config.baseUrl), {
        method: 'POST', body: form, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      if (!response.ok) throw new SpeechError('The transcription service could not respond. Check that its model is ready and retry.');
      const data = await response.json();
      if (typeof data?.text !== 'string' || !data.text.trim()) {
        throw new SpeechError('No words were recognized. Please record again or type your message.', 422);
      }
      if (data.text.length > MAX_MESSAGE_LENGTH) throw new SpeechError('The transcript is too long. Please record a shorter message.', 422);
      return { text: data.text.trim() };
    } catch (error) {
      if (error instanceof SpeechError) throw error;
      if (timeout.aborted) throw new SpeechError('Transcription took too long. Try a shorter recording.', 504);
      if (signal?.aborted) throw new SpeechError('Transcription was cancelled.', 499);
      // Do not log audio, transcripts, raw service errors, or service addresses.
      throw new SpeechError('Cannot reach the transcription service. Start the voice service and retry.');
    }
  }
}
