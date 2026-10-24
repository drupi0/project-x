// Optional LIVE provider test: these explicitly fictional messages go to the configured model.
// node scripts/smoke-interview.mjs — app must be running. No credentials or raw replies are logged.
import assert from 'node:assert/strict';
const base = new URL(process.env.TEST_APP_URL || 'http://127.0.0.1:3000');
assert(['localhost', '127.0.0.1'].includes(base.hostname), 'Use the local fictional test app.');
const messages = [];
let intake, memory;
const story = [
  'This is fictional practice. My name is Samir. I am from Sudan, currently in Cairo, Egypt. I am safe right now.',
  'I have no existing or pending refugee or asylum case. Please use just Samir; I prefer not to provide my legal name.',
  'I left because armed men took my brother and threatened me. This happened around June 2025 in Khartoum.',
  'Correction: that happened in July 2025, not June.',
  'My cousin says she has a screenshot of the threatening message. I have not seen it myself.',
  'I need help with expired registration papers. Nobody has threatened me with arrest or deportation, and I am safe now.'
];
for (const [index, content] of story.entries()) {
  messages.push({ role: 'user', content });
  const response = await fetch(new URL('/api/chat', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, intake, memory }), signal: AbortSignal.timeout(310000)
  });
  assert.equal(response.status, 200, `Turn ${index + 1} failed`);
  const data = await response.json();
  ({ intake, memory } = data);
  messages.push(data.message);
  assert.equal(intake.profile.preferredName.value, 'Samir', 'Preferred name was lost');
  assert.equal(intake.profile.countryOfOrigin.value, 'Sudan', 'Origin was lost');
  assert((data.message.content.match(/[?؟？]/g) ?? []).length <= 1);
  if (index >= 1) assert.equal(intake.profile.legalName.status, 'declined');
  if (index >= 3) assert.match(memory.facts.approximateDates?.value ?? '', /July|2025-07/i);
  console.log({ turn: index + 1, stage: intake.stage, retainedFacts: Object.keys(memory.facts).length,
    nextField: memory.lastQuestion?.field ?? null });
}
assert(intake.readyForSummary, 'Initial account should be ready for summary.');
console.log('Fictional intake retained identity, refusal, correction, and reached summary.');
