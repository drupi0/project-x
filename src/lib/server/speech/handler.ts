import { SpeechError, type SpeechToTextProvider } from './provider';
import { readAudio } from './validation';
import { isAllowedRequestOrigin } from '../request-origin';
import { readVocabulary } from '../../speech-output/vocabulary';

export async function handleTranscription(request: Request, getProvider: () => SpeechToTextProvider, debug = false) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const origin = request.headers.get('origin');
  if (origin && !isAllowedRequestOrigin(origin, request.url)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
  try {
    let vocabulary: string[];
    try { vocabulary = readVocabulary(request.headers.get('X-Transcription-Vocabulary')); }
    catch { throw new SpeechError('The transcription context is invalid. Please retry.', 400); }
    const audio = await readAudio(request);
    if (debug) console.info('[speech]', JSON.stringify({ event: 'transcription_started', audioBytes: audio.length, vocabularyCount: vocabulary.length }));
    const result = await getProvider().transcribe({ audio, signal: request.signal, ...(vocabulary.length ? { vocabulary } : {}) });
    if (debug) console.info('[speech]', JSON.stringify({ event: 'transcription_completed', characterCount: result.text.length, confidenceAvailable: false }));
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof SpeechError ? error.message : 'Transcription failed. Please try again.' }, {
      status: error instanceof SpeechError ? error.status : 500, headers
    });
  }
}
