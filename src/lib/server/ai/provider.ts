import type { ChatMessage } from '../../types/chat';

export interface AIProvider {
  chat(input: {
    systemPrompt: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    diagnostics?: { requestId: string; attempt: 'original' | 'repair' };
  }): Promise<ChatMessage>;
}

export class AIError extends Error {
  constructor(message: string, public status = 503) {
    super(message);
    this.name = 'AIError';
  }
}
