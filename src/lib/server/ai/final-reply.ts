import { AIError } from './provider';

/** Some Ollama templates open <think> before generated content starts,
 * so the returned content can contain only the closing tag. */
export function finalReply(content: string): string {
  const closingTags = [...content.matchAll(/<\/think\s*>/gi)];
  const lastClose = closingTags.at(-1);
  const answer = (lastClose
    ? content.slice(lastClose.index! + lastClose[0].length)
    : content).trim();

  // Never expose a partial thinking block or an answerless thinking response.
  if (!answer || /<think(?:\s|>|$)/i.test(answer)) {
    throw new AIError('The model did not finish a usable reply. Please retry.', 502);
  }
  return answer;
}
