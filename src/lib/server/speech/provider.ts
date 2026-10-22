import type { Transcription } from '../../types/speech';

export interface SpeechToTextProvider {
  transcribe(input: { audio: Uint8Array; signal?: AbortSignal }): Promise<Transcription>;
}

export class SpeechError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
