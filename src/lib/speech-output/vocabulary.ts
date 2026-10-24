// Small, Unicode-safe metadata header keeps the existing audio/wav transport.
export function vocabularyHeaders(words: string[]): Record<string, string> {
  return { 'X-Transcription-Vocabulary': encodeURIComponent(JSON.stringify(words.slice(0, 8).map(word => word.slice(0, 100)))) };
}
export function readVocabulary(header: string | null): string[] {
  if (!header) return [];
  if (header.length > 6000) throw new Error('Invalid vocabulary.');
  const value: unknown = JSON.parse(decodeURIComponent(header));
  if (!Array.isArray(value) || value.length > 8 || value.some(word =>
    typeof word !== 'string' || !word.trim() || word.length > 100 || /[\u0000-\u001f]/.test(word))) {
    throw new Error('Invalid vocabulary.');
  }
  return [...new Set(value as string[])];
}
