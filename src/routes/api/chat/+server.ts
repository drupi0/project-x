import * as env from '$app/env/private';
import { createProvider } from '#lib/server/ai/index.ts';
import { handleChat } from '#lib/server/chat-handler.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => handleChat(request, () => createProvider(env), env.AI_DEBUG === '1');
