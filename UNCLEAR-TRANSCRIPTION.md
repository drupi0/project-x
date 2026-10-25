# Unclear transcript recovery (2026-10-25)

Claude receives transcripts, not audio. Context can help interpret imperfect wording,
but cannot recover words that were lost with certainty. No provider or microphone
pipeline changes were made.

Changes:

- `src/lib/interview/system-prompt.ts`: explicitly apologize and request repetition
  when text is unintelligible; use the previous question and confirmed memory; keep
  plausible interpretations pending, not asserted facts. Preserve clear portions,
  prioritize fragmented safety disclosures, and do not confuse failed recognition
  with refusal, unknown facts, consent, or an instruction to end.
- `src/lib/server/chat-handler.ts`: a no-new-facts clarification cannot switch away
  from the previous unanswered field. Preserve safety/pause/finish priority and the
  existing clarification limit. A narrow English fallback asks the user to repeat
  their last answer. Debugging logs field identifiers only.
- `src/lib/server/memory-flow.test.ts`: regression tests for preserved context and
  facts, wrong-field clarification, and safety override.
- `scripts/smoke-unclear-transcription.mjs`: live configured-provider evaluation of
  four synthetic transcript scenarios. No raw replies or testimony are printed.

Live testing found Claude apologized for gibberish but switched from event location
to current city. Explicit prompting alone did not resolve this reliably. The server
guard now retains the original clarification target.

Verification:

- 212 automated tests pass on the host; Docker's production build, checks and its
  211-test snapshot pass (the additional safety regression was added afterward).
- Final live test: all four cases passed (unintelligible answer, contextual unclear
  place, short confirmation, fragmented safety disclosure).
- App rebuilt/restarted; app and Whisper healthy.

Repeat with `node scripts/smoke-unclear-transcription.mjs`. This exercises the real
configured conversational model via `/api/chat`, not a mock, but feeds synthetic
text rather than noisy audio. A pass is not a guarantee across model samples,
languages or accents. Actual microphone/noise tests remain necessary. If Claude
mistakenly treats gibberish as meaningful, this narrow guard cannot detect every
such error. Earlier raw transcripts and confirmed facts remain separate, in-memory.

Expected example (illustrative, not an exact model-output snapshot):

Assistant: Where did that happen?
Transcript: Blue suitcase seven sideways calendar.
Assistant: Sorry, I didn't understand that clearly. Could you repeat your last answer?

For “car tom” in a discussion about Sudan, a tentative confirmation may be useful;
it must not silently turn into a confirmed location. For “Yes” after a spelling
confirmation, accept that answer rather than requesting unnecessary repetition.
