# Refugee AI Interview Assistant — Conversation and Voice Input POC

A locally served SvelteKit proof of concept for exploring neutral conversational interviewing, with text, voice input and optional spoken AI replies. Uses TypeScript, native CSS and Ollama by default, or Claude when `CLAUDE_TOKEN` is set, with no AI frameworks, accounts, analytics or application-side conversation persistence. Whisper runs as a replaceable local transcription service; spoken replies use only the browser's installed local voices. See [SPEECH.md](SPEECH.md) for setup and architecture.

**Use fictional test stories only. Do not enter real testimony or personal identifiers.** The assistant is not a lawyer or a UNHCR representative. It cannot assess refugee eligibility, give legal advice or promise outcomes. Model instructions are behavioral guidance, not a guarantee.

The intended product direction and layered interview safeguards are documented in [IMPLEMENTATION.md](IMPLEMENTATION.md). It distinguishes the refugee-led UNHCR-oriented product goal from this fictional-only technical prototype and lists the reviews required before any real-user testing.

The practice conversation has two stages: an optional refugee intake, followed by personal-statement development. It tracks profile answers, five statement topics, and selected event-detail coverage in browser memory only. The server offers a complete summary only after the topic and narrative-depth threshold is met; users may finish early for an explicitly incomplete summary. These model-extracted statuses can be wrong and are practice guidance only, not a case record, legal assessment, or submission. Use fictional names and stories only. No case matching, contact collection, durable storage, or legal-system integration is implemented.

## Requirements and setup

- Node.js **22.17 or later** (Node 22 LTS recommended), npm.
- For local inference, [Ollama](https://ollama.com/download) installed on the same machine. Download the installer for macOS/Windows; Linux installation instructions are on that page. Ollama is not required when using Claude.
- Enough memory and disk space for the chosen model. `qwen3:4b` downloads several GB; generation speed depends on hardware and context size.

If using nvm, run `nvm install` and `nvm use` in this directory.

Start Ollama with cloud features disabled. Quit an already running Ollama desktop app before starting a separate server:

```sh
OLLAMA_NO_CLOUD=1 ollama serve
```

In another terminal, download the default model:

```sh
ollama pull qwen3:4b
ollama list
```

Downloading the software and model needs internet access; Ollama interviews use the local model afterward. Do not use Ollama cloud models or configure an external proxy. See [Ollama local-only mode](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features). Claude mode requires internet access for each request.

Install and start:

```sh
npm install
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:5173** (or the local URL printed by Vite). The server binds to loopback by default. Do not expose this unauthenticated POC publicly.

## Docker Compose

Requires Docker Engine/Desktop with Compose. Host Node.js is not required. The image builds with Node 22, runs the checks/tests, and starts the production SvelteKit Node server as a non-root user. A generated `package-lock.json` makes container installs reproducible.

If `.env` does not exist, copy `.env.example` to `.env`; preserve an existing file and its credentials. Compose reads `.env` automatically. Credentials are passed at runtime and excluded from the image/build context.

**With Claude:** set `CLAUDE_TOKEN` in `.env`.

**With your local Ollama installation:** start Ollama on the host first and check that the selected model exists locally:

```sh
ollama list
ollama pull qwen3:4b  # only if this model is not listed
docker compose up -d --build --wait
```

The normal Compose command starts the app and its required local Whisper transcription service. The first start downloads the configured Whisper model and can take a while. Use **Start voice call** to hear the introduction, speak naturally, and pause; the browser detects the end of your turn, Whisper transcribes it, and the AI replies aloud before listening again. **End call** stops the microphone. Spoken replies use local voices installed on the current device/browser; voice availability and language quality depend on the device. This is turn-based browser audio, not a real telephone call or full-duplex streaming.

The app calls the host service through `http://host.docker.internal:11434`. Model downloads happen through the native `ollama` command and are not stored in Docker.

Open **http://127.0.0.1:3000**. `APP_PORT` changes the host port and configured origin together. Use the documented address: the API checks request origins. Compose no longer starts an Ollama container; the app contacts your local installation via Docker Desktop's `host.docker.internal` address.

```sh
docker compose ps
docker compose logs -f app
docker compose down
```

`down` preserves the `whisper-models` volume. This volume holds transcription model files, not application interviews. Docker retains bounded app container logs; app diagnostics exclude conversation content and credentials.

After editing runtime settings in `.env`, run `docker compose up -d app` to recreate the container with updated values; `docker compose restart` alone does not reload environment settings. After code changes or changing `APP_PORT`, run `docker compose up -d --build app`. SvelteKit 3's public origin is configured at build time via `APP_ORIGIN`, which Compose derives from `APP_PORT`. This setup does not mount source code or provide hot reload.

### Ollama connection and model selection

Compose uses `DOCKER_OLLAMA_BASE_URL=http://host.docker.internal:11434` by default. This is Docker Desktop's host-service address; keep your local Ollama server running. The `OLLAMA_MODEL` name must match a model in the native `ollama list`. To change it, download it with `ollama pull <model>` and set `OLLAMA_MODEL` in `.env` before recreating the app. The app does not start Ollama or download models.

`OLLAMA_ALLOW_DOCKER=1` is set only inside Compose and permits the exact `host.docker.internal` host; arbitrary remote Ollama URLs are rejected. Claude selection still takes precedence whenever its token is non-blank. For native Node development, the default `OLLAMA_BASE_URL=http://localhost:11434` is used instead.

## Configuration

All variables are private, declared in `src/env.ts`, and read only by the server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_TOKEN` | empty | Anthropic API key; a non-blank value selects Claude ahead of `AI_PROVIDER` |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | Claude model ID; configurable without code changes |
| `AI_PROVIDER` | `ollama` | Used only when `CLAUDE_TOKEN` is absent or blank |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server origin; Compose supplies the host installation address |
| `OLLAMA_ALLOW_DOCKER` | `0` | Exact host gateway allowlist; set automatically in Compose |
| `OLLAMA_MODEL` | `qwen3:4b` | Locally downloaded model name |
| `AI_TIMEOUT_MS` | `120000` | Request deadline; 1,000–300,000 ms |
| `AI_DEBUG` | `0` | Set to `1` for metadata-only provider diagnostics in the server terminal |
| `AI_DEBUG_RAW_FICTIONAL` | `0` | Development-only opt-in for masked Claude output-shape diagnostics; ignored in production |

Compose-only settings: `APP_PORT=3000` and `DOCKER_OLLAMA_BASE_URL=http://host.docker.internal:11434`. These are not exposed to the browser.

### Using Claude

Set an **Anthropic API key** in your private `.env` file and restart the server:

```env
CLAUDE_TOKEN=your-anthropic-api-key
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

`CLAUDE_TOKEN` is this app's variable name for an API key; it does not refer to a Claude browser cookie or Claude Code subscription token. Requests use the [Anthropic Messages API](https://platform.claude.com/docs/en/api/http/messages) with API-key authentication. API access and billing are separate from this application.

A non-blank token always selects Claude, even if `AI_PROVIDER=ollama`. Unset the token (or set it to an empty value) and restart to return to local Ollama. A Claude failure produces an error; it never silently switches to Ollama.

**Claude mode sends message history and interview instructions to Anthropic.** The UI labels remote inference and discloses this before messages are sent. Application history remains in browser memory, but the local-only processing guarantee does not apply to Claude; provider handling and retention are governed by your Anthropic account/API terms. Use fictional stories only. The key is server-only and is never included in page data, browser requests, logs or API responses.

Restart the development server after changing `.env`. To change the model, run `ollama pull <model>` and update `OLLAMA_MODEL`; application code stays unchanged. The provider disables thinking output and caps generated tokens. Models must support Ollama's chat API and the selected options.

### Viewing logs

On macOS with the Ollama desktop app, follow its native server log in a separate terminal:

```sh
npm run logs:ollama
```

This follows `~/.ollama/logs/server.log`; Ctrl+C stops following without stopping Ollama. For `ollama serve` launched manually, its native logs appear in that process's terminal instead. Native Ollama logs are managed by Ollama, not the application.

For application-side request diagnostics, stop the existing development server and run:

```sh
npm run dev:debug
```

Alternatively set `AI_DEBUG=1` in `.env` and restart `npm run dev`. Events in the server terminal include a correlation ID shared across the chat, original Claude request, and repair attempt; response completion/stop reason, content-block types and lengths; and safe validation stage/field information. Prompts, replies, thinking text, raw upstream errors, credentials and service addresses are excluded. Diagnostics are off by default and are not sent to the browser or written to files by the app.

For a temporary formatting investigation only, set `AI_DEBUG_RAW_FICTIONAL=1` separately and run the app with `npm run dev` (`NODE_ENV=development`). This emits a **masked shape view**, not readable testimony: schema keys and status enums remain visible, while free text, names, numbers and other words are replaced. It is intended only for fictional test conversations. Do not enable it for real testimony; stop the development server after the test. The production Docker image sets `NODE_ENV=production`, does not pass this flag through, and never emits this diagnostic even if the flag is present in the host `.env`.

The locally installed `qwen3:4b` template was observed to start a thinking block despite `think: false`. The provider now removes thinking through the final `</think>` delimiter (including when the template supplied the opening tag) and ignores the separate `thinking` field. Only the final reply reaches the browser and subsequent history. Unfinished thinking, empty final replies, and token-limit truncation produce a retry error instead. The output budget allows up to 2,048 tokens for the model to reach its final answer; the final reply still has the 4,000-character limit. This filters recognizable thinking markup, not arbitrary unmarked prose, and does not guarantee model behavior. A non-thinking instruct model remains a separate configuration choice.

## Try a fictional conversation

1. Send: “This is fiction. My character Mira left the town of Luma after receiving threats.”
2. Reply to the assistant's question, then ask: “What name and town did I mention?” It should recall Mira and Luma.
3. Say: “Correction: the town was Neri.” Confirm later replies use the correction.
4. Try “I don’t remember,” “I prefer not to answer,” and a message in another supported language.
5. Ask “Do I qualify for refugee status?” It should decline to decide or give legal advice.
6. Click **Restart**. The introduction should return and previous messages disappear.
7. Click **End & clear**, including during generation. A late response must not reappear.
8. Stop Ollama, then send a message. A useful error should appear. Start Ollama and choose **Retry message**; the user message should appear only once. **Edit message** lets you change a failed message.
9. Check a narrow mobile viewport and keyboard navigation.
10. Start a voice call, allow microphone access, and try a short fictional reply. Pause to let the AI respond aloud, then continue; **End call** should stop microphone capture, while **Restart** and **End & clear** clear conversation history and stop playback.

## Architecture

```text
src/
  env.ts                         Private environment declarations
  lib/
    types/chat.ts                Transport-neutral messages and context limits
    interview/system-prompt.ts   Introduction and centralized interview instructions
    components/                  ChatWindow, ChatInput, ChatMessage
    server/
      ai/provider.ts             AIProvider interface and safe error type
      ai/ollama.ts               Ollama HTTP adapter, timeout and cancellation
      ai/claude.ts               Claude Messages adapter, timeout and cancellation
      ai/index.ts                Provider factory and configuration validation
      speech-output/provider.ts  Replaceable browser-side synthesis contract; local voices only
      chat-validation.ts         Request and message validation
      chat-handler.ts            Provider-independent request handling
      chat.test.ts               Validation, adapter and handler tests
  routes/
    +page.svelte                 Local chat UI and disclaimer
    api/chat/+server.ts          POST /api/chat endpoint
```

The UI owns chronological history in component memory. The endpoint is stateless and prepends the system prompt on every request. The recent context window has at most 21 messages and 16,000 UTF-16 characters, preserving complete recent turns. Individual messages are limited to 4,000 characters and request bodies to 100,000 bytes. Oversized API input is rejected; the UI trims old context before sending and tells the user when it has done so. Older messages remain visible until reset but may no longer be known to the model.

Requests are serialized in the UI. Failed messages can be retried without appending them twice. Restart/end aborts the browser request and invalidates any late response. Provider calls receive cancellation signals and have an independent deadline; immediate cessation of model computation on disconnect depends on the server/runtime.

To add a provider later, implement `AIProvider.chat` and register it in the factory. The UI and interview prompt do not depend on Ollama. Text messages also provide a boundary for future speech transcription and synthesis, neither of which is implemented here.

### API

```sh
curl http://127.0.0.1:5173/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"This is a fictional test story."}]}'
```

Successful response:

```json
{"message":{"role":"assistant","content":"What would you like to share about this fictional story?"}}
```

Send alternating `user` and `assistant` messages, starting and ending with `user`. Never send a `system` role. Errors return `{"error":"..."}` with an appropriate 4xx/5xx status. Foreign browser origins are rejected. Responses use `Cache-Control: no-store`. The model's raw error bodies and internal addresses are never returned.

## Checks

```sh
npm run check
npm test
npm run build
npm run preview
```

The test suite uses injected fetch implementations and a fake provider: it does not need Ollama or send stories externally. It covers malformed messages, role ordering, count/content/body limits, context trimming, prompt/history propagation, model configuration, unsafe remote addresses, invalid responses, upstream errors, timeout, origin checks and sanitized errors.

## Privacy and limitations

- The app does not write interviews to a database, disk, cookies, browser storage or analytics. Refresh/reset/end clears application state; this is not a secure memory-erasure guarantee.
- In Ollama mode, prompts and replies exist transiently in browser, server and Ollama memory. Keep Ollama cloud features disabled and do not enable request-body logging or add logging proxies. Claude mode sends this data to Anthropic, subject to provider policies. OS diagnostics, browser extensions and separately configured runtime logs are outside this app's control.
- Generated text is rendered as text, never HTML. There are no external fonts, tracking scripts or remote assets.
- The introduction and controls are English; model replies can follow the user's language. Quality varies by model/language.
- Recent-context limits mean earlier details can be forgotten. No summarization or durable case state is implemented.
- Full JSON replies are used rather than streaming. Slow hardware or model cold starts can hit the configurable timeout.
- There is no authentication, public deployment hardening, multi-user rate limiting or independent verification of model safety. Never use this POC for real applications.
- Voice input/transcription and optional browser-local spoken output are included; messaging platforms, telephone, document exports and evidence retrieval are not.

## Future phases (not implemented)

See [SPEECH.md](SPEECH.md) for replaceable Whisper transcription and local browser speech output.

2. Improve voice interaction with target-language/device testing and turn-taking controls.
3. Structured interview workflow, corrections, confirmations and reviewable summaries.
4. Telegram and WhatsApp integrations.
5. Incoming telephone calls and real-time voice.
6. Statements, country evidence, witness invitations and secure case management.

See `VERIFICATION.md` for the checks performed in the implementation environment and remaining verification.
