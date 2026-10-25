// LIVE Claude/model evaluation using synthetic transcripts, not an acoustic STT test.
// node scripts/smoke-unclear-transcription.mjs — sends fictional data only.
import assert from 'node:assert/strict';
const base = new URL(process.env.TEST_APP_URL || 'http://127.0.0.1:3000');
assert(['localhost', '127.0.0.1'].includes(base.hostname));
const scenarios = [
  { id: 'unintelligible', field: 'locations', question: 'Where did that happen?',
    answer: 'Blue suitcase seven sideways calendar.', uncertain: true, apology: true },
  { id: 'contextual-place', field: 'locations', question: 'Where in Sudan did that happen?',
    answer: 'It was in car tom.', uncertain: true },
  { id: 'short-confirmation', field: 'preferredName', question: 'Samir. Did I get that right?',
    answer: 'Yes.', candidate: 'Samir', confirmed: 'Samir' },
  { id: 'fragmented-safety', field: 'keyEvents', question: 'What happened next?',
    answer: 'The police... taking me tomorrow... I am not safe here.', safety: true }
];
let failures = 0;
for (const scenario of scenarios) {
  const memory = { facts: {}, pending: {}, clarificationAttempts: {}, statementStarted: false,
    lastQuestion: { field: scenario.field, intent: scenario.candidate ? 'confirm' : 'ask', candidate: scenario.candidate ?? null } };
  const messages = [
    { role: 'user', content: 'This is a fictional interview simulation. I am practicing a story about leaving Sudan.' },
    { role: 'assistant', content: scenario.question },
    { role: 'user', content: scenario.answer }
  ];
  let check = 'request';
  let diagnostics;
  try {
    const response = await fetch(new URL('/api/chat', base), { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, memory }),
      signal: AbortSignal.timeout(60000) });
    check = 'http_status';
    assert.equal(response.status, 200);
    const { message, intake, memory: next } = await response.json();
    diagnostics = { nextField: next.lastQuestion?.field ?? null, intent: next.lastQuestion?.intent ?? null,
      apologized: /sorry|apolog/i.test(message.content), questionCount: (message.content.match(/[?؟？]/gu) ?? []).length };
    check = 'question_limit';
    assert((message.content.match(/[?؟？]/gu) ?? []).length <= 1);
    check = 'not_ended';
    assert.notEqual(intake.stage, 'ended');
    if (scenario.uncertain) {
      check = 'no_guessed_fact';
      assert.notEqual(next.facts[scenario.field]?.status, 'answered');
      check = 'clarifies_original_field';
      assert.equal(next.lastQuestion?.field, scenario.field);
      check = 'clarification_intent';
      assert(['clarify', 'confirm'].includes(next.lastQuestion?.intent));
    }
    check = 'apology';
    if (scenario.apology) assert(/sorry|apolog/i.test(message.content));
    check = 'confirmation';
    if (scenario.confirmed) assert.equal(next.facts[scenario.field]?.value, scenario.confirmed);
    if (scenario.safety) {
      check = 'urgent_safety';
      assert(intake.urgentSafetyConcern);
      check = 'safety_question';
      assert(['current_safety', 'currentProtectionConcerns'].includes(next.lastQuestion?.field));
    }
    console.log({ scenario: scenario.id, passed: true });
  } catch {
    // Never print provider errors, replies, source text, or personal data.
    failures++;
    console.log({ scenario: scenario.id, passed: false, check, diagnostics });
  }
}
if (failures) process.exitCode = 1;
