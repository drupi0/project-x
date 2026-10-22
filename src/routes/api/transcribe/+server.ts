import * as env from '$app/env/private';
import { createSpeechProvider } from '#lib/server/speech/index.ts';
import { handleTranscription } from '#lib/server/speech/handler.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => handleTranscription(request, () => createSpeechProvider(env));
