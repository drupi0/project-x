import { MAX_BODY_BYTES, MAX_HISTORY_CHARACTERS, MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH, type ChatMessage } from '../types/chat';
import { INITIAL_INTAKE, validateIntakeState, type IntakeState } from '../interview/intake';
import { validateMemory, type InterviewMemory } from '../interview/memory-types';

export class ValidationError extends Error {}

export function validateMessages(input: unknown): ChatMessage[] {
  if (!input || typeof input !== 'object' || !('messages' in input) || !Array.isArray(input.messages)) {
    throw new ValidationError('Provide a messages array.');
  }
  const messages = input.messages;
  if (!messages.length || messages.length > MAX_HISTORY_MESSAGES || messages.length % 2 !== 1) {
    throw new ValidationError(`Send an odd number of messages, from 1 to ${MAX_HISTORY_MESSAGES}.`);
  }
  let total = 0;
  const validated = messages.map((message, index): ChatMessage => {
    const expected = index % 2 === 0 ? 'user' : 'assistant';
    if (!message || typeof message !== 'object' || message.role !== expected) {
      throw new ValidationError('Messages must alternate user and assistant, beginning and ending with user.');
    }
    if (typeof message.content !== 'string' || !message.content.trim() ||
        message.content.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(`Each message must contain 1–${MAX_MESSAGE_LENGTH} characters.`);
    }
    total += message.content.length;
    return { role: expected, content: message.content.trim() };
  });
  if (total > MAX_HISTORY_CHARACTERS) throw new ValidationError('The conversation context is too large.');
  return validated;
}

type ChatRequestData = { messages: ChatMessage[]; intake: IntakeState; memory?: InterviewMemory };
export function validateChatRequest(input: unknown): ChatRequestData {
  const messages = validateMessages(input);
  if (!input || typeof input !== 'object') throw new ValidationError('Provide a chat request.');
  const candidate = input as Record<string, unknown>;
  // The browser sends back the complete state previously returned by this
  // server, including derived fields. Accept those fields but always recompute
  // them here; never trust client-provided stage/completion decisions.
  try { return {
    messages,
    intake: candidate.intake === undefined ? INITIAL_INTAKE : validateIntakeState(candidate.intake, { allowComputedFields: true }),
    ...(candidate.memory === undefined ? {} : { memory: validateMemory(candidate.memory) })
  }; }
  catch { throw new ValidationError('The interview state is invalid. Restart the conversation and retry.'); }
}

/** Bound the actual request bytes, even when Content-Length is absent or misleading. */
export async function readChatRequest(request: Request): Promise<ChatMessage[]> {
  return (await readChatRequestData(request)).messages;
}

export async function readChatRequestData(request: Request): Promise<ChatRequestData> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new ValidationError('Send JSON with Content-Type: application/json.');
  }
  if (!request.body) throw new ValidationError('A request body is required.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ValidationError('The request is too large.');
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return validateChatRequest(JSON.parse(body));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('The request must contain valid JSON.');
  } finally {
    reader.releaseLock();
  }
}
