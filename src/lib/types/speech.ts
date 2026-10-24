export const AUDIO_SAMPLE_RATE = 16000;
export const MAX_AUDIO_SECONDS = 60;
export const MAX_AUDIO_BYTES = 44 + AUDIO_SAMPLE_RATE * MAX_AUDIO_SECONDS * 2;

export interface Transcription { text: string; rawText?: string }
