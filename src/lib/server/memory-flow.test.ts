import { describe, expect, it, vi } from 'vitest';
import { handleChat } from './chat-handler';
import { INITIAL_INTAKE } from '../interview/intake';
import { EMPTY_MEMORY, type MemoryUpdate } from '../interview/memory-types';
import { recentHistory, type ChatMessage } from '../types/chat';
import { rememberQuestion } from '../interview/memory';

const { stage, informationAdequate, readyForSummary, profile, categories, details, ...modelIntake } = INITIAL_INTAKE;
const output = (reply: string, updates: MemoryUpdate[] = [], question: unknown = null, intake = modelIntake) =>
  ({ role: 'assistant', content: JSON.stringify({ reply, intake, updates, question }) });
const request = (messages: ChatMessage[], intake = INITIAL_INTAKE, memory = EMPTY_MEMORY) =>
  new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, intake, memory }) });
const preferred: MemoryUpdate = { field: 'preferredName', status: 'answered', value: 'Samir', quote: 'My name is Samir.', uncertain: false, correction: false };

describe('multi-turn chat continuity', () => {
  it('keeps an unclear response attached to the unanswered event-location question', async () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { field: 'locations', intent: 'ask', candidate: null });
    const chat = vi.fn().mockResolvedValue(output('Sorry, which city are you staying in?', [],
      { field: 'currentCity', intent: 'clarify', candidate: null }));
    const result = await (await handleChat(request([
      { role: 'user', content: 'Fictional practice.' },
      { role: 'assistant', content: 'Where did that happen?' },
      { role: 'user', content: 'Blue suitcase seven sideways calendar.' }
    ], INITIAL_INTAKE, memory), () => ({ chat }))).json();
    expect(result.message.content).toContain('repeat your last answer');
    expect(result.memory.lastQuestion.field).toBe('locations');
    expect(result.memory.facts.currentCity).toBeUndefined();
    expect(result.memory.clarificationAttempts.locations).toBe(1);
  });
  it('does not redirect an urgent safety clarification to the earlier historical question', async () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { field: 'locations', intent: 'ask', candidate: null });
    const chat = vi.fn().mockResolvedValue(output('Are you safe right now?', [],
      { field: 'current_safety', intent: 'clarify', candidate: null }, { ...modelIntake, urgentSafetyConcern: true }));
    const result = await (await handleChat(request([{ role: 'user', content: 'Police... tomorrow... not safe here.' }],
      INITIAL_INTAKE, memory), () => ({ chat }))).json();
    expect(result.message.content).toBe('Are you safe right now?');
    expect(result.memory.lastQuestion.field).toBe('current_safety');
    expect(result.intake.urgentSafetyConcern).toBe(true);
  });
  it('preserves context and facts when an unintelligible answer needs repetition', async () => {
    const initial = vi.fn().mockResolvedValue(output('Where did this happen?', [preferred], { field: 'locations', intent: 'ask', candidate: null }));
    const first = await (await handleChat(request([{ role: 'user', content: preferred.quote }]), () => ({ chat: initial }))).json();
    const reply = "Sorry, I didn't understand the place clearly. Could you say it again?";
    const chat = vi.fn().mockResolvedValue(output(reply, [], { field: 'locations', intent: 'clarify', candidate: null }));
    const garbled = 'Blue suitcase seven sideways calendar.';
    const response = await handleChat(request([
      { role: 'user', content: preferred.quote }, first.message, { role: 'user', content: garbled }
    ], first.intake, first.memory), () => ({ chat }));
    const result = await response.json();
    expect(result.message.content).toBe(reply);
    expect(result.memory.facts.preferredName.value).toBe('Samir');
    expect(result.memory.facts.locations).toBeUndefined();
    expect(result.intake.details.locations).toBe('not_asked');
    expect(result.intake.finishRequested).toBe(false);
    expect(result.memory.clarificationAttempts.locations).toBe(1);
    expect(chat.mock.calls[0][0].messages.at(-1).content).toBe(garbled);
    expect(chat.mock.calls[0][0].systemPrompt).toContain('UNCLEAR TRANSCRIPTION RECOVERY');
  });
  it('delivers spelling readback, retains it through repair, and confirms without asking again', async () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { field: 'preferredName', intent: 'clarify', candidate: null });
    const chat = vi.fn().mockResolvedValueOnce(output('Where are you staying?', [], { field: 'currentCity', intent: 'ask', candidate: null }));
    const first = await (await handleChat(request([{ role: 'user', content: 'S-A-M-I-R' }], INITIAL_INTAKE, memory), () => ({ chat }))).json();
    expect(first.message.content).toBe('Samir. Did I get that right?');
    expect(first.memory.lastQuestion).toEqual({ field: 'preferredName', intent: 'confirm', candidate: 'Samir' });
    expect(first.memory.facts.preferredName).toBeUndefined();
    chat.mockResolvedValueOnce({ role: 'assistant', content: '{malformed' })
      .mockResolvedValueOnce(output('Where are you staying?', [], { field: 'currentCity', intent: 'ask', candidate: null }));
    const second = await handleChat(request([{ role: 'user', content: 'Yes, Samir.' }], first.intake, first.memory), () => ({ chat }));
    const confirmed = await second.json();
    expect(second.status).toBe(200);
    expect(confirmed.memory.facts.preferredName).toMatchObject({ value: 'Samir', confirmed: true });
    expect(confirmed.memory.lastQuestion.field).toBe('currentCity');
    expect(confirmed.message.content.match(/\?/g)).toHaveLength(1);
  });
  it('retains facts beyond history trimming, corrects redundant questions, and survives malformed repair', async () => {
    const chat = vi.fn().mockResolvedValueOnce(output('Where are you staying?', [preferred], { field: 'currentCity', intent: 'ask', candidate: null }));
    const first = await handleChat(request([{ role: 'user', content: preferred.quote }]), () => ({ chat }));
    const data = await first.json();
    expect(data.intake.profile.preferredName.value).toBe('Samir');
    const longHistory: ChatMessage[] = [
      { role: 'user', content: preferred.quote }, data.message,
      ...Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: 'A fictional detail.' })),
      { role: 'user', content: 'June 2025.' }
    ];
    const history = recentHistory(longHistory);
    expect(history.some(message => message.content.includes('Samir'))).toBe(false);
    chat.mockResolvedValueOnce(output('What is your preferred name?', [], { field: 'preferredName', intent: 'ask', candidate: null }))
      .mockResolvedValueOnce(output('Where did the event happen?', [], { field: 'locations', intent: 'ask', candidate: null }));
    const second = await handleChat(request(history, data.intake, data.memory), () => ({ chat }));
    expect(second.status).toBe(200);
    const next = await second.json();
    expect(next.intake.profile.preferredName.value).toBe('Samir');
    expect(next.message.content).toBe('Where did the event happen?');
    expect(chat.mock.calls.at(-1)![0].systemPrompt).toContain('Samir');
    chat.mockResolvedValueOnce({ role: 'assistant', content: '{broken' })
      .mockResolvedValueOnce(output('Please continue.'));
    const repaired = await handleChat(request([...history, next.message, { role: 'user', content: 'Khartoum.' }].slice(-21), next.intake, next.memory), () => ({ chat }));
    expect(repaired.status).toBe(200);
    expect((await repaired.json()).memory.facts.preferredName.value).toBe('Samir');
  });
  it('does not speak repeated questions or internal errors after correction fails', async () => {
    const initial = vi.fn().mockResolvedValue(output('Please continue.', [preferred]));
    const first = await (await handleChat(request([{ role: 'user', content: preferred.quote }]), () => ({ chat: initial }))).json();
    const repeated = output('What is your name?', [], { field: 'preferredName', intent: 'ask', candidate: null });
    const chat = vi.fn().mockResolvedValueOnce(output('What is your name? Where are you?'))
      .mockResolvedValueOnce(repeated);
    const response = await handleChat(request([{ role: 'user', content: 'June.' }], first.intake, first.memory), () => ({ chat }));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.message.content).not.toMatch(/name|validation|malformed|retry/i);
    expect(result.intake.stage).not.toBe('ended');
    expect(result.intake.profile.preferredName.value).toBe('Samir');
  });
  it('logs field and stage metadata without any fact values or source quotes', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const chat = vi.fn().mockResolvedValue(output('Please continue.', [preferred]));
      await handleChat(request([{ role: 'user', content: preferred.quote }]), () => ({ chat }), true);
      const logs = JSON.stringify(log.mock.calls);
      expect(logs).toContain('state_transition');
      expect(logs).toContain('preferredName');
      expect(logs).not.toContain('Samir');
      expect(logs).not.toContain('My name');
    } finally { log.mockRestore(); }
  });
  it('does not log unexpected model-generated key names', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const chat = vi.fn().mockResolvedValue({ role: 'assistant', content: JSON.stringify({
        reply: 'Please continue.', intake: modelIntake, updates: [], question: null, PRIVATE_IDENTIFIER: true
      }) });
      await handleChat(request([{ role: 'user', content: 'Fictional test.' }]), () => ({ chat }), true);
      expect(JSON.stringify([...warning.mock.calls, ...info.mock.calls])).not.toContain('PRIVATE_IDENTIFIER');
      expect(JSON.stringify(warning.mock.calls)).toContain('[unexpected-field]');
    } finally { warning.mockRestore(); info.mockRestore(); }
  });
  it('transitions to summary only after all topics and meaningful details are supported', async () => {
    const quote = 'I am from Sudan in Egypt, safe now. Armed men threatened me in June 2025 in Khartoum. I have a screenshot and need advice.';
    const updates: MemoryUpdate[] = [
      ['countryOfOrigin', 'Sudan'], ['currentCountry', 'Egypt'], ['reason_for_fleeing', 'Threats'], ['current_safety', 'Safe now'],
      ['evidenceOrWitnessDetails', 'Reported screenshot'], ['assistance_needed', 'Advice'], ['keyEvents', 'Reported threats by armed men'],
      ['approximateDates', 'June 2025'], ['locations', 'Khartoum']
    ].map(([field, value]) => ({ field: field as MemoryUpdate['field'], value, quote, status: 'answered', uncertain: false, correction: false }));
    const chat = vi.fn().mockResolvedValue(output('We can review the account now.', updates));
    const response = await handleChat(request([{ role: 'user', content: quote }]), () => ({ chat }));
    const result = await response.json();
    expect(result.intake.stage).toBe('summary_offer');
    expect(result.intake.readyForSummary).toBe(true);
    expect(result.intake.profile.legalName.status).toBe('not_asked');
  });
});
