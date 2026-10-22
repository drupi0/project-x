export interface SpeechOutputProvider {
  voices(): SpeechSynthesisVoice[];
  speak(text: string, voiceURI?: string): Promise<void>;
  stop(): void;
}

export function chooseLocalVoice(voices: SpeechSynthesisVoice[], voiceURI = '', language = '') {
  const local = voices.filter(voice => voice.localService);
  if (voiceURI) {
    const selected = local.find(voice => voice.voiceURI === voiceURI);
    if (selected) return selected;
  }
  const languageBase = language.toLowerCase().split('-')[0];
  return local.find(voice => voice.default && voice.lang.toLowerCase().startsWith(languageBase)) ??
    local.find(voice => voice.lang.toLowerCase().startsWith(languageBase)) ??
    local.find(voice => voice.default) ?? local[0];
}

export class BrowserSpeechOutputProvider implements SpeechOutputProvider {
  voices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices().filter(voice => voice.localService);
  }

  speak(text: string, voiceURI = '') {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('Speech playback is unavailable in this browser.'));
    }
    const voices = this.voices();
    const voice = chooseLocalVoice(voices, voiceURI, navigator.language);
    if (!voice) return Promise.reject(new Error('No local speech voices are available on this device.'));
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    return new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = event => reject(new Error(event.error === 'canceled' || event.error === 'interrupted'
        ? 'Speech playback was stopped.' : 'The local voice could not speak this reply.'));
      window.speechSynthesis.speak(utterance);
    });
  }

  stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}
