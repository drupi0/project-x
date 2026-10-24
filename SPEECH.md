# Replaceable speech-to-text

Whisper converts speech to editable text. Assistant replies can be spoken by the browser's installed local voices; no TTS server, image pull, third-party endpoint, or additional environment setting is needed. Claude/Ollama still handles conversation through `/api/chat`. Input transcription is replaceable on the server, and output speech is behind a separate browser-side provider interface.

## Start with Docker

```sh
docker compose --profile voice up -d --build --wait app whisper
docker compose --profile voice ps
```

First startup builds whisper.cpp and downloads the selected Whisper model. Assistant replies can be spoken automatically or with a per-message **Speak** control. Use the voice selector to choose an installed local voice. Browser speech is produced locally and no text/audio is posted to a speech service. The browser may require a user gesture before playback.

First start builds whisper.cpp v1.8.3 and downloads the multilingual `tiny` model (about 75 MB). The model downloader must finish before Whisper starts. The app stays available during setup; recording before readiness may return a retry error. Start `ollama` separately if using it instead of Claude for chat.

Open http://127.0.0.1:3000, select **Record message**, allow microphone access, speak a fictional sentence, and select **Stop & transcribe**. Review/correct the resulting draft and press **Send**. Recording appends to an existing draft; it never sends a chat message automatically. Cancel, Restart, End, and navigation release the microphone and ignore late results. Typing remains available when voice fails.

The call-like mode uses browser energy-based voice activity to start a recording, then Whisper's batch `/inference` endpoint to transcribe it. It waits for about 2.2 seconds of detected silence as an automatic end-of-turn fallback; while speaking, the user can tap **I’m done speaking**. During AI speech, **Interrupt AI and speak** stops local playback and returns to listening. Microphone capture requests browser echo cancellation, noise suppression, and automatic gain control. These are pragmatic turn-taking aids, not semantic turn detection: Whisper does not stream partial transcripts or indicate whether a thought is complete, and browser audio processing varies by device. A manual interruption cannot recover speech captured before it is pressed.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `STT_PROVIDER` | `whisper` | Speech factory selection, independent of `AI_PROVIDER` |
| `WHISPER_BASE_URL` | `http://127.0.0.1:8081` | Native-development speech server |
| `DOCKER_WHISPER_BASE_URL` | `http://whisper:8080` | Compose's speech server origin |
| `STT_ALLOW_DOCKER` | `0` | Compose sets `1` for exact Docker service/host names |
| `STT_TIMEOUT_MS` | `120000` | 1,000–120,000 ms transcription deadline |
| `WHISPER_MODEL` | `tiny` | Compose model: tiny/base/small; optional `.en` for English-only |

Change `WHISPER_MODEL=base` or `small` for an accuracy/speed comparison and rerun the startup command. These models need more memory and disk. The multilingual default preserves the spoken language rather than translating to English.

For native development, run a compatible server with your downloaded model:

```sh
whisper-server --host 127.0.0.1 --port 8081 --model /path/to/ggml-tiny.bin --language auto
```

Do not enable realtime transcript printing, debug dumps, or conversion. The app already sends WAV, so ffmpeg/`--convert` is unnecessary. A built Node app outside Compose needs `BODY_SIZE_LIMIT=2M`; Compose sets this automatically. Vite development does not use the adapter's 512 KB default.

The pinned v1.8.3 server disables prior-audio context by default; it does not accept a `--no-context` command-line option.

## Replace a service

The browser records with MediaRecorder and converts audio in memory to mono 16 kHz PCM16 WAV. `POST /api/transcribe` accepts the raw `audio/wav` body and returns `{ "text": "recognized words" }` or a safe `{ "error": "..." }` response.

`src/lib/server/speech/provider.ts` defines `SpeechToTextProvider.transcribe({ audio, signal, vocabulary? })`. The endpoint validates audio and an optional URI-encoded JSON vocabulary header. `whisper.ts` sends session vocabulary through the pinned server's multipart `prompt` field, explicitly clearing it on requests without hints. The response includes trimmed `text` and unchanged `rawText`; the browser keeps original transcripts separate from edits and interpreted facts. This adapter reports no confidence score. `index.ts` selects the implementation from private environment settings.

To replace Whisper, implement this interface, register it in the factory, and change deployment/configuration. Keep the WAV-in/text-out contract. No provider-specific changes are needed in the recorder, review UI, chat interface, or interview prompt. Speech output has its own `SpeechOutputProvider` interface in `src/lib/speech-output/provider.ts`; its browser implementation selects voices with `localService === true`. A future speech output provider can implement the same client-side contract.

## Limits and privacy

- Recordings are limited to 60 seconds and normalized uploads to 1,920,044 bytes. The server validates actual body size and canonical WAV headers, and rejects near-silent input. The energy check is not reliable voice-activity detection.
- Call mode does not identify speakers and cannot distinguish speech from similar background sounds reliably. For careful testing, use a quiet environment and review/correct transcripts; a transcript is not verified testimony.
- Transcription may mishear names/dates or hallucinate. The `tiny` model is for initial testing; review every transcript and use fictional speech only.
- Audio remains in browser, application server and speech service memory. No audio/transcript files are written by the app. The speech container uses a read-only filesystem, tmpfs scratch space, no published port, and disabled log retention. Its persistent volume holds models.
- With Claude active, pressing Send transmits the reviewed text and chat history to Anthropic. Recording/transcription itself never calls Claude.
- Cancellation prevents stale UI updates and aborts requests; immediate cancellation of inference depends on the service noticing a disconnect.
- Browser permission, capture and decoding support vary. Unsupported browsers can still type. Microphones require localhost/loopback or HTTPS; testing on a phone over LAN requires HTTPS and deliberate networking changes.
- Synthesis quality and voice availability vary across languages and devices. Only voices reported as local by the browser are used. Autoplay can be blocked by browser policy; use the per-reply **Speak** button.
- No streaming recognition, telephony, audio persistence, or public deployment hardening is included.

Reference: [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/blob/v1.8.3/examples/server/README.md).

## Verification commands

`npm run check` and `npm test` cover the provider abstraction, WAV validation, byte limits, silence, configuration, timeouts, sanitized errors, and key interview-prompt safeguards. Model behavior still requires scripted evaluation against each configured model.

`node scripts/voice-browser-smoke.mjs` uses an externally installed Playwright (optionally `PLAYWRIGHT_MODULE` and `CHROME_PATH`, as in the existing browser test). It generates an in-browser audio tone to exercise recording/conversion and the VAD call loop, mocks transcription/chat/speech responses, and checks review, explicit sending, cancellation, restart, AI-speech interruption/resumed listening, microphone cleanup and permission denial. It never uses the actual microphone.

On macOS with `say`, ffmpeg, Node 22, the app and Whisper running, `node scripts/voice-live-smoke.mjs` generates synthetic speech and verifies real transcription. The temporary synthetic audio file is deleted afterward. It sends no chat request. Physical microphones, mobile Safari and target-language accuracy still need device testing.
