# Implementation verification

## Follow-up: use native Ollama from Compose (2026-10-22)

Removed the Ollama service and model volume from Compose; the app now defaults to `host.docker.internal:11434`, allowing Docker Desktop's app container to call host-installed Ollama. Restrict the explicit host allowlist to that host gateway. Containerized Ollama is no longer started by the project. Started the local server with cloud features disabled (`OLLAMA_NO_CLOUD=1`); native `ollama list` showed `qwen3:4b` (2.5 GB).

Verification: Compose rebuilt and restarted the app successfully; the app container received HTTP 200 from host Ollama `/api/tags`, found the configured model, and its homepage returned HTTP 200. `docker compose ps` showed no Ollama container; the existing Whisper container remained healthy. TypeScript and all 104 tests passed in the image build. A live chat request reached native Ollama but returned HTTP 502 because the model exhausted the configured 2,048-token generation budget before producing a final answer; the transport/model-not-found issue is resolved, but this request did not validate a usable model reply.

## Follow-up: browser-local spoken replies (2026-10-22)

Replaced the Kokoro container/server endpoint with a replaceable browser-side `SpeechOutputProvider` using installed `speechSynthesis` voices filtered to `localService === true`. Added local-language/default voice selection, voice picker, auto-speak toggle, per-message Speak buttons and Stop control. No speech text/audio leaves the browser for TTS, and Docker no longer contains Kokoro configuration or service. The interrupted image pull was not continued.

Verification passed: `npm run check` (0 errors, 0 warnings), `npm test` (104 tests), `docker compose --profile voice config --quiet`, and `docker compose build app` (Node 22 production image with checks/tests/build). The rebuilt app container is running and the homepage returned HTTP 200. Unit tests verify that only local voices are selected, preferred language and user choice are respected, and the adapter invokes the browser speech API with the selected installed voice. Browser/device playback remains unverified: the optional Playwright package is not installed, and local voice availability differs by browser/OS.

## Follow-up: replaceable Whisper speech input (2026-10-22)

Added a provider-neutral WAV-in/text-out `/api/transcribe` endpoint, `SpeechToTextProvider` interface, Whisper adapter/factory, memory-only browser recording and WAV normalization, transcript review, cancellation, and a separate Compose speech service. Existing AI providers and interview behavior remain separate.

Verification: TypeScript reports 0 errors/warnings; all 100 unit tests pass; production app and pinned whisper.cpp v1.8.3 images build. App and Whisper health checks pass. A synthetic sentence was transcribed through the real app endpoint and local multilingual Whisper `tiny` model; no chat/Claude call was made. The unsupported `--no-context` CLI flag was removed (the pinned server already defaults to no prior-audio context).

Browser verification passed at 390×844 with generated audio: real MediaRecorder/Web Audio conversion, draft append/review/correction, no automatic chat send, explicit Send, cancellation, restart, microphone track cleanup, permission denial, empty browser storage and no page errors. Provider responses were mocked for the browser workflow test. Synthetic speech tests do not verify physical microphones, mobile Safari, accents, background noise or target-language accuracy.

Audio/transcript bodies are not logged or persisted by the app. Whisper uses a read-only filesystem, in-memory scratch space and disabled log retention; model files persist in their own volume. `.env` credentials were preserved.

## Follow-up: Docker Compose (2026-10-21)

Added a multi-stage Node 22 Dockerfile, Compose services for the app and Ollama, a persistent Ollama model volume, health checks, loopback-only app publishing, runtime-only credential injection, and a Docker build context that excludes `.env` files. The runtime app runs as a non-root user. Docker Ollama hosts require an explicit, narrow allowlist opt-in.

Passed: `docker compose config --quiet`, Linux container image build, TypeScript (0 errors/warnings), all 72 tests, production build, Compose app startup and health check. Verified the runtime image has no `.env` file. The initial dependency lock needed regeneration with Linux optional bindings; the resulting lock supports the tested Linux build. SvelteKit 3 requires a build-time `paths.origin` for local HTTP, so Compose supplies `APP_ORIGIN` during the build.

An end-to-end HTTP test through the running app container and a temporary simulated Ollama container verified Compose DNS, system prompt forwarding, final-answer filtering, HTTP 400 validation and foreign-origin HTTP 403 rejection. The temporary test container was removed afterward. No real Claude request was sent. The app was restored to the user's existing `.env` configuration.

Not verified: actual Ollama inference inside Docker. The official Ollama image pull was stopped because the multi-GB download was slow; no model was downloaded into Docker. The README includes service startup and model-pull commands. GPU acceleration is not configured. Physical microphone/mobile browser coverage and live browser speech playback remain device-dependent and untested.

## Follow-up: optional Claude provider

`CLAUDE_TOKEN` now selects a server-only Claude Messages API provider, ahead of `AI_PROVIDER`; blank/absent tokens retain Ollama. `CLAUDE_MODEL` is configurable. The page discloses remote processing when Claude is selected. Provider failures do not trigger an Ollama fallback.

Verification passed: TypeScript (0 errors/warnings), 65 tests, production build. Claude tests cover selection precedence, history/system prompt mapping, authentication headers, text-only reply extraction, invalid/truncated responses, HTTP failures, timeout, cancellation and sanitized diagnostics. A production-server check with a fake sentinel credential confirmed that the page displays the Claude disclosure without exposing the credential; no inference request was sent in that check.

No real `CLAUDE_TOKEN` is configured in this environment, so live Anthropic authentication, billing/model access and generation remain unverified.

## Follow-up: hide model thinking

Server-side final-reply filtering now strips thinking blocks, including template-opened blocks with only a closing `</think>` in the generated content. Separate thinking fields are excluded. Unfinished thinking and token-limit truncation return a retry error. Filtering happens before the final reply length check and before the response reaches browser history.

Verification passed: TypeScript (0 errors/warnings), 44 tests, production build. A live request through `/api/chat` using the installed Ollama model and the fictional-test greeting `hi, good day` returned only:

> Hi there! Good day to you too. How can I help you share your fictional character’s experience? 😊

This confirms the reported delimiter-based leak is filtered for the tested request; arbitrary unmarked deliberation cannot be reliably distinguished from normal text. Restart an existing conversation to clear previously displayed reasoning.

## Follow-up: Ollama diagnostics

Ollama 0.40.6 is now reachable with `qwen3:4b` installed. A real `hello` request completed, but the model returned deliberation rather than a short greeting. Its installed chat template unconditionally opens a thinking block. Native server logs confirm successful HTTP 200 chat requests, so the observed problem is response behavior rather than connection failure. This supersedes the original installation limitation below; interview behavior is still not validated.

Added `npm run logs:ollama` to follow the macOS desktop server log and opt-in `npm run dev:debug` / `AI_DEBUG=1` metadata diagnostics. A regression test verifies that prompt, story, reply, thinking and error text do not appear in app diagnostics, and that diagnostics are off by default.

Follow-up verification passed: TypeScript (0 errors/warnings), 34 tests, and production build.

Performed on 2026-10-20.

| Check | Result |
| --- | --- |
| Runtime | Node 22.23.3 via temporary npm runtime; system Node 20.19.5 is too old for SvelteKit 3 |
| `npm run check` | Passed: 0 errors, 0 warnings |
| `npm test` | Passed: 33 tests |
| `npm run build` | Passed: client and Node server output |
| Development server | Running on loopback; home page returned HTTP 200 |
| Live endpoint validation | System-role injection rejected with HTTP 400 and `Cache-Control: no-store` |
| Missing Ollama | Actual endpoint returned a useful unavailable-model error; UI remained usable |
| Browser smoke check | Passed in headless Chrome at 390×844 and 1280×900 |
| Browser interactions | Mocked successful replies, context forwarding, retry without duplicate messages, restart, end during pending request, stale-response suppression, refresh clearing |
| Browser storage | No local storage, session storage or cookies after conversation/reset |
| Browser runtime | No page errors; no horizontal overflow at tested sizes |
| Client build inspection | No Ollama address, model default or private configuration names found in generated client files |
| Dependency audit at installation | No vulnerabilities reported |

## Not verified

Ollama is not installed and nothing is listening on `localhost:11434` in this environment. No actual model inference was performed. Successful provider responses in automated tests and the browser were simulated. Context transport is verified, but live model recall, language support, interview instruction adherence, inference latency and hardware suitability remain unverified. Run the fictional conversation checklist in README after installing Ollama and downloading the model.

The browser smoke test is optional tooling, not a production dependency. With Playwright available and the development server running, **stop Ollama first** so the unavailable-model assertion can run:

```sh
node scripts/browser-smoke.mjs
```

Set `PLAYWRIGHT_MODULE` to an absolute Playwright `index.mjs` path when using an externally installed copy; set `CHROME_PATH` to a Chrome executable if Playwright's browser is not installed. `APP_URL` defaults to `http://127.0.0.1:5173`. This run used an npm-cached Playwright and the machine's installed Chrome.

This is a local POC, not a validated legal interview system. A working live-model exchange remains an acceptance item to verify in an Ollama-equipped environment.
