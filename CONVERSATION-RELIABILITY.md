# Conversation reliability — 2026-10-23

## Findings

The voice path records a browser audio segment, converts it to WAV, posts it to `/api/transcribe`, then appends the recognized text to the chat. `/api/chat` receives recent messages and browser-held intake state. Neither endpoint stores a durable session.

The previous handler returned the model's whole intake snapshot as the next state. Nothing merged it with prior answers. If Claude reset an answered field to `not_asked`, the browser accepted that replacement and the completion evaluator could move back to intake. Repair requests did receive the original state; there was no separate deliberate reset in the repair path. However, a successfully repaired response could still overwrite it.

History is limited to 21 messages/16,000 characters. Profile strings survived only if the model copied them, while event details were mostly coverage flags. Once old messages left the request, flags such as `approximateDates: answered` could not tell Claude what date was reported. There was also no field associated with the last question and no clarification counter.

Whisper was receiving audio with no session vocabulary. Its output was trimmed and forwarded as text, with no separate raw transcript record. The pinned [whisper.cpp v1.8.3 server](https://github.com/ggml-org/whisper.cpp/blob/v1.8.3/examples/server/server.cpp) supports the multipart `prompt` parameter. Its parameters are reused across requests, so the adapter now explicitly sends an empty prompt when there are no hints.

## Changes

The browser now sends both `intake` and bounded `memory` with each chat request. It clears both on Restart, End & clear, or refresh. Ending the voice call alone keeps the page's interview available, as before. No database, browser storage, accounts, or case-system submission were added.

Claude returns a short reply, control flags, source-quoted factual updates, and the field/intent of its next question. The server validates and merges updates. An omitted field does not delete an earlier answer. Explicit corrections can replace values, with up to three previous values kept as superseded versions. A declined question stays declined until the person voluntarily reopens it. Stage continuity survives extraction omissions, while urgency and pauses retain priority.

Memory separates current facts, uncertain candidates, source quotes, and old values. `confirmed` means wording directly supplied/spelled or explicitly confirmed by the person; it does **not** mean independent factual or evidence verification. New updates must quote the latest user message. Names/identity values need literal support or a preceding confirmation. There is no automatic case association. Model extraction still needs human review.

Short answers are interpreted against the preceding question. A confirmation such as “Yes” resolves the proposed candidate. “Just Samir” in a name discussion records preferred name and legal-name refusal. Explicitly spelled names/places are recognized generically; there is no Sudan-specific place dictionary. Model interpretation handles other natural-language answers, with small deterministic shortcuts for unambiguous answers.

Clarification questions are counted per field when delivered. After two unsuccessful clarifications the field remains unknown/uncertain and another routine clarification is blocked. A currently urgent safety question is exempt. Successful answers reset the counter. Already resolved/declined fields and routine investigation after summary readiness trigger one repair attempt. If repairing repetition still fails validation, a neutral continuation preserves validated facts without ending or submitting the interview. Unparseable responses still use the existing safe retry error.

Identity/location coverage is derived from resolved origin and current location. Reported evidence details also cover the evidence topic. These mappings add no inferred facts or verification. They prevent the model from recording facts while forgetting the separate topic flag. The five-topic and narrative-depth completion criteria remain in place.

An explicit English request beginning “I need/want/would like/am looking for help/assistance/support” is also retained verbatim as assistance needed if the model omitted that field. It does not infer a service or legal need. Other phrasings/languages rely on the model's contextual extraction.

Whisper receives a bounded list of confirmed names/places from the current session through the optional provider-neutral vocabulary parameter. Nothing is added based on presumed nationality. Its raw output is retained separately in page memory from editable chat text and interpreted facts. No confidence score is invented: this adapter's JSON response does not expose one. Pending interpretations are excluded from vocabulary hints.

## Structured-output adjustment

The first implementation asked Claude for both the full intake snapshot and the new updates. A live synthetic request returned HTTP 400: “The compiled grammar is too large.” A minimal connectivity request succeeded, isolating the problem to the response schema. Removing duplicate profile/category/detail snapshots from model output resolved the compilation failure. The complete browser/API intake state is still returned and strictly validated; legacy full model responses remain accepted by a separate strict parsing branch. Current Claude output uses the compact delta schema.

The provider output limit is now separate from the 4,000-character spoken-message limit, since JSON metadata can exceed it. Claude has a 4,096-token output allowance. Provider/model selection is unchanged. See [Anthropic's structured-output limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Files

- `src/lib/interview/memory-types.ts`: bounded memory/update/question types and strict validation.
- `src/lib/interview/memory.ts`: merge, correction, spelling, question suppression, clarification counts, stage continuity, and vocabulary selection.
- `src/lib/interview/intake.ts`, `output-schema.ts`, `system-prompt.ts`: compact response parsing, provider schema, contextual instructions.
- `src/lib/server/chat-handler.ts`, `chat-validation.ts`: memory request/response transport, repair, metadata-only diagnostics.
- `src/lib/components/ChatWindow.svelte`, `ChatInput.svelte`, `VoiceCall.svelte`, `VoiceInput.svelte`: memory lifetime, original transcript retention, vocabulary forwarding, and stale transcription suppression.
- `src/lib/server/speech/provider.ts`, `whisper.ts`, `handler.ts`, `src/routes/api/transcribe/+server.ts`, `src/lib/types/speech.ts`, `src/lib/speech-output/vocabulary.ts`: optional speech vocabulary, raw output, validated metadata, count-only diagnostics.
- `src/lib/server/ai/claude.ts`, `ollama.ts`, `src/lib/types/chat.ts`: separate structured-output size limit; Claude output allowance.
- `memory.test.ts`, `memory-flow.test.ts`, existing chat/Claude/speech tests: regression coverage.
- `scripts/smoke-interview.mjs`, `scripts/smoke-transcription.mjs`: optional live synthetic checks.

## Repeat the fictional Samir simulation

Refresh the page after deployment and start a new practice call. Use fictional information only.

1. “My name is Samir. I'm from Sudan and I'm staying in Cairo, Egypt. I'm safe right now.”
2. “I have no existing or pending refugee or asylum case. Just Samir; I prefer not to provide my legal name.”
3. “Armed men took my brother and threatened me, so I left. This happened around June 2025 in Khartoum.”
4. “Correction: that happened in July 2025, not June.”
5. “My cousin says she has a screenshot of the threat. I haven't seen it myself.”
6. “I need help with expired registration papers. Nobody has threatened arrest or deportation. I'm safe now.”

Expect Samir to remain the preferred name, legal name declined, July to be current with June superseded, evidence attributed to the cousin, and transition toward a factual summary. The exact reply wording varies.

For a transcription clarification test, provide an ambiguous place pronunciation. If asked whether the spelling is correct, answer “Yes”; it should not ask for the same location again. Try spelling a different city to confirm this is not a hardcoded Khartoum rule. Decline a question, or answer two successive clarification attempts with uncertainty, and check that it moves on. Urgent protection concerns should override routine completion.

Run automated regressions with `npm test` and `npm run check`. Optional live checks:

```sh
node scripts/smoke-interview.mjs
node scripts/smoke-transcription.mjs
```

The first uses the configured AI provider and sends fixed fictional data. The second requires macOS `say`, generates temporary speech, exercises the real app and Whisper, prints match counts only, and deletes the generated recording afterward. Neither saves interviews or raw response logs.

With `AI_DEBUG=1`, `docker compose logs -f app` shows request IDs, original/repair attempts, state transitions, enum field names, clarification counts, message counts, vocabulary counts, and transcription sizes. It does not log source quotes, transcript text, values, or credentials. Unexpected model-generated schema keys are replaced with a generic diagnostic label. Fresh-state metadata is emitted on the next request; clearing the page does not send interview data to a logging endpoint.

## Limits

Verification: all 184 automated tests passed, TypeScript/Svelte checks reported no errors or warnings, and the production image built. The real six-turn Claude simulation retained identity, refusal and the corrected date and reached summary readiness. Generated English speech passed through real Whisper with and without hints. See [VERIFICATION.md](VERIFICATION.md) for the tested scope.

- This is bounded session continuity, not a full incident/evidence database. Long accounts and more than three corrections per field can exceed what fits in model memory. Full original chat remains in page memory, but only recent wording and bounded facts are sent to Claude.
- Source-quote validation prevents unsupported spans, not incorrect interpretation. Model-supplied question targets and correction labels can be wrong. The server cannot guarantee semantic neutrality or detect every compound question from punctuation.
- Proper-noun hints can help but can also bias recognition. They do not replace confirmation. No target-language, accent, trauma, or noisy physical-call accuracy claim follows from synthetic tests.
- The existing batch Whisper path and roughly 2.2-second silence fallback remain. There is no new semantic end-of-turn detector, streaming recognition, speaker identification, or automatic spoken interruption detector. Use the existing manual interruption control.
- Browser microphone/TTS behavior and mobile devices require manual testing. There is no real testimony storage, real case matching, evidence authentication, or legal submission.
