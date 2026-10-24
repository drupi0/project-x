export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const MAX_MESSAGE_LENGTH = 4000;
// JSON state and quoted memory are larger than the short user-facing reply.
export const MAX_MODEL_OUTPUT_LENGTH = 24000;
export const MAX_HISTORY_MESSAGES = 21;
export const MAX_HISTORY_CHARACTERS = 16000;
export const MAX_BODY_BYTES = 100000;

/** Keep complete recent turns, beginning with a user message. */
export function recentHistory(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  let size = recent.reduce((sum, message) => sum + message.content.length, 0);
  while (recent.length > 1 && (size > MAX_HISTORY_CHARACTERS || recent[0].role !== 'user')) {
    size -= recent.shift()!.content.length;
  }
  return recent;
}
