/** Conservative transcript parsing, not speech recognition or a pronunciation dictionary.
 * Only explicit single-letter sequences are joined. Never guess bee/B or see/C.
 */
export function spellingCandidate(text: string): string | null {
  const normalized = text.normalize('NFC')
    .replace(/\b([a-z])\s+as in\s+[\p{L}\p{M}]+/giu, '$1');
  const matches = [...normalized.matchAll(
    /(?<![\p{L}\p{M}])(?:\p{L}\p{M}*[\s,،.\-–]+){2,}\p{L}\p{M}*(?![\p{L}\p{M}])/gu
  )];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const prefix = normalized.slice(0, match.index).trim();
  const suffix = normalized.slice(match.index! + match[0].length).trim();
  // Reject partial sequences with an unrecognized/ambiguous letter in the middle
  // or at the end. Free narrative is never silently joined into a name.
  if (prefix && !/\b(?:spelled|spelling|spell|letters are)\s*[:,-]?$/iu.test(prefix)) return null;
  if (suffix && !/^[.!]$/u.test(suffix)) return null;
  const letters = matches[0][0].split(/[\s,،.\-–]+/u).filter(Boolean);
  if (letters.length > 80) return null;
  const joined = letters.join('');
  // Title case Latin sequences only; preserve other writing systems unchanged.
  return /^[a-z]+$/iu.test(joined)
    ? joined[0].toUpperCase() + joined.slice(1).toLowerCase() : joined;
}

export const PROPER_NOUN_FIELDS = [
  'preferredName', 'legalName', 'countryOfOrigin', 'currentCountry', 'currentCity', 'locations'
] as const;
