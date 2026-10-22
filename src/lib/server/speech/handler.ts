import { SpeechError, type SpeechToTextProvider } from './provider';
import { readAudio } from './validation';
import { isAllowedRequestOrigin } from '../request-origin';

export async function handleTranscription(request: Request, getProvider: () => SpeechToTextProvider) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const origin = request.headers.get('origin');
  if (origin && !isAllowedRequestOrigin(origin, request.url)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
  try {
    const audio = await readAudio(request);
    return Response.json(await getProvider().transcribe({ audio, signal: request.signal }), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof SpeechError ? error.message : 'Transcription failed. Please try again.' }, {
      status: error instanceof SpeechError ? error.status : 500, headers
    });
  }
}
