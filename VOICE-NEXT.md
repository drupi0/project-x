# Voice testing options

Update: recording with replaceable Whisper transcription and browser speech using installed local voices are now implemented; see [SPEECH.md](SPEECH.md). Output uses only voices marked local by the browser and does not download a model or send speech text to a service.

Start with push-to-talk: record a short utterance, transcribe it, let the user review/correct the text, send it through the existing `/api/chat`, and read the assistant's final reply aloud. Keep text input available and provide Stop/Replay controls. This reuses the current interview logic and avoids introducing simultaneous recording/playback and interruption handling yet.

## Recommended no-API-fee prototype

- **Capture:** browser `getUserMedia` + `MediaRecorder`, with microphone permission and audio held temporarily. Negotiate the browser's supported recording format and normalize audio for transcription. Microphone access requires a secure context; local loopback testing works, but testing from a phone over a LAN generally needs HTTPS. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- **Speech to text:** local `whisper.cpp` HTTP server. It is MIT-licensed, supports CPU inference and Apple Silicon acceleration, and can run without a paid transcription service. Start by evaluating a multilingual `base` or `small` model on the actual target languages; `.en` models are English-only. Quality and latency need testing with accents and background noise. [Project](https://github.com/ggml-org/whisper.cpp), [HTTP server](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md)
- **Text to speech:** browser `speechSynthesis`, restricted to installed voices where `localService === true`. It avoids a model download and sends no reply text to a TTS server; voice and language availability vary by device. [MDN local voices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService)
- **Conversation:** keep Ollama for no model API charges. Claude still incurs its own API charges if configured, even if speech processing is local.

“Free” here means no per-request service charge: the computer, electricity, downloads and implementation still have costs. Only fictional recordings should be used. Transcription errors must be correctable, and silence must not be treated as reliable testimony. Do not save audio or log transcripts; if conversion requires a temporary file, delete it on success, failure and cancellation.

## Other options

**Fast browser-only demonstration:** Web Speech API recognition plus synthesis. This is quick to prototype without setting up an STT server, but recognition support varies and browsers may send audio to their own remote recognition service. It is not a reliable offline/private baseline. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)

**Alternative hosted or self-hosted synthesis:** if installed voices prove unsuitable, another `SpeechOutputProvider` can later call a local or remote TTS service. Keep it opt-in and disclose any remote processing because reply text could contain sensitive details.

The microphone, Whisper transcription and local browser speech are now available. Full-duplex, interruption-aware call behavior remains future work.
