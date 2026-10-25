# Spelling and name clarification — 2026-10-24

## Findings

The existing Whisper.cpp adapter uses batch `/inference`, `language=auto`, and
bounded per-session `prompt` hints. Its selected JSON response exposes text, not
confidence. It already preserves `rawText` separately and hints only with confirmed
session vocabulary. No new provider parameters, models, or VAD changes are needed.
The exact audio responsible for “Som Mir” was not available; its acoustic cause
cannot be established from the reported conversation alone.

Application defects found:

- Spelled letters counted as literal evidence and were immediately marked confirmed.
- An uncertain model interpretation of a profile name was discarded if it was not
  literally present in the transcript, preventing it from becoming a pending candidate.
- “Yes, Samir” was not recognized by the deterministic short-confirmation handler.
- The legal-name refusal safeguard updated memory only if it changed the reply text.
  If the model already used the same safe acknowledgment, memory could miss the refusal.
- Clarification counts existed, but instructions did not explicitly change strategies
  after failed repetition or provide alternatives when spelling was inaccessible.

## Changes and files

- `src/lib/interview/spelling.ts`: conservative Unicode letter-sequence parser.
  Accepts hyphens, spaces, commas, explicit spelling prefixes and “S as in Sam”.
  Rejects ambiguous spoken letter names, multiple candidates and partial sequences.
- `src/lib/interview/memory.ts`: reconstructed names/places stay pending; readback
  and explicit confirmation are required. “Yes, candidate” and rejection bind to the
  preceding question. Confirmed values survive pending corrections, and superseded
  values remain in existing bounded history. Legal-name refusals update memory even
  when the model already supplies the safe acknowledgment.
- `src/lib/interview/system-prompt.ts`: repetition → spelling → alternatives/skip
  guidance; partial-letter clarification, multilingual limitations, contextual short
  replies, and no assumption that unfamiliar names are transcription errors.
- `src/lib/server/chat-handler.ts`: uses the reconciled readback question as the
  next turn's context. Debug metadata adds spelling detection and field-only pending,
  confirmed and declined lists; no transcript, candidate or name values are logged.
- `src/lib/interview/spelling.test.ts`, `memory.test.ts`, and
  `src/lib/server/memory-flow.test.ts`: parser, state and HTTP/retry regressions.
- `scripts/smoke-transcription.mjs`: optional `--spelling` synthetic audio check.

The wire schema is unchanged. Existing `not_asked`, `unknown`, and `declined` statuses
remain; uncertainty is represented by `memory.pending`, confirmation by
`memory.facts[field].confirmed`. “Confirmed” means wording reported/confirmed by the
participant, never independent verification. Raw transcripts remain separate in
browser memory, not persistent storage.

Existing field-level attempts and last-question context are reused. After two
unsuccessful optional-field clarifications, routine clarification is blocked. A
newly reconstructed spelling permits one readback even after failed repetitions;
repeating the identical candidate does not replenish that budget. Urgent safety,
pause and requested completion retain priority.

## Verification

- `npm test`: 209 passing tests across 8 files.
- `npm run check`: zero errors/warnings.
- `docker compose build app`: checks, all tests and production build pass on Node 22.
- Host `npm run build`: fails at SvelteKit prerender because host Node 20 lacks
  `Promise.withResolvers`; use the project's required Node >=22.17 or Docker.
- `node scripts/smoke-transcription.mjs --spelling`: real running Whisper returned
  the synthetic S-A-M-I-R letter sequence with and without hints. Temporary synthetic
  audio is removed; output reports counts and booleans only. This is a recognition
  probe, not proof of microphone, accent or conversational quality.

## Short fictional voice regression

1. Start a fresh fictional interview and give “Samir” as the preferred name.
2. If genuinely misheard, repeat once, then spell “S, A, M, I, R”. The assistant
   should read it back; the reconstructed name must not be confirmed yet.
3. Say “Yes, Samir”. Continue into the story: it should not ask for the name again.
4. When asked about a legal name, say “Just Samir”. It should acknowledge the
   preferred name and leave legal-name disclosure declined, not missing audio.
5. Voluntarily correct it: “Actually, it's Sameer, spelled S-A-M-E-E-R”. Confirm
   the readback. The new value should replace Samir only after confirmation.
6. Repeat with a fictional location. Reject a wrong suggestion with “No”; it must
   not become confirmed. If spelling is difficult, say so and try slow speech or skip.

Run `node scripts/smoke-transcription.mjs --spelling` for the separate audio probe.
Use fictional information only; do not enable raw production logging.

## Limitations

Ambiguity detection, strategy selection and partial-letter repair still depend on
Claude and the transcript: the server cannot know that a plausible “Som Mir” was
misheard without contextual evidence. The normalizer supports explicit Unicode
letters, not every language's spoken letter names or transliteration conventions.
No confidence scores or pronunciation dictionary are invented. Deterministic
confirmation shortcuts cover English and some Arabic; other language interpretation
uses Claude. The deterministic readback fallback is English. Human accents, noisy
microphones, unsupported writing systems and live interruptions need manual testing.
No case association, storage or legal-system submission was added.
