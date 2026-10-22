import { describe, expect, it, vi } from 'vitest';
import { BrowserSpeechOutputProvider, chooseLocalVoice } from './provider';

const voice = (voiceURI: string, lang: string, localService: boolean, isDefault = false) =>
  ({ voiceURI, lang, localService, default: isDefault }) as SpeechSynthesisVoice;

describe('local speech voice selection', () => {
  const voices = [
    voice('remote-en', 'en-US', false, true),
    voice('local-en', 'en-GB', true),
    voice('local-es', 'es-ES', true, true)
  ];

  it('never selects a non-local voice and prefers a matching installed language', () => {
    expect(chooseLocalVoice(voices, '', 'en-US')?.voiceURI).toBe('local-en');
  });

  it('uses an explicitly selected local voice', () => {
    expect(chooseLocalVoice(voices, 'local-es', 'en-US')?.voiceURI).toBe('local-es');
  });

  it('falls back to the default local voice and reports no local choice', () => {
    expect(chooseLocalVoice(voices, '', 'fr-FR')?.voiceURI).toBe('local-es');
    expect(chooseLocalVoice([voices[0]], '', 'en-US')).toBeUndefined();
  });

  it('speaks through the browser API using the chosen on-device voice', async () => {
    class FakeUtterance {
      voice?: SpeechSynthesisVoice;
      lang = '';
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(public text: string) {}
    }
    const api = { getVoices: () => voices, cancel: vi.fn(), speak: vi.fn((utterance: FakeUtterance) => utterance.onend?.()) };
    vi.stubGlobal('window', { speechSynthesis: api });
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    try {
      await new BrowserSpeechOutputProvider().speak('Hello there.', 'local-en');
      expect(api.cancel).toHaveBeenCalledOnce();
      expect(api.speak).toHaveBeenCalledOnce();
      expect(api.speak.mock.calls[0][0].voice?.voiceURI).toBe('local-en');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
