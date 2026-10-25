import { describe, expect, it } from 'vitest';
import { INITIAL_INTAKE, evaluateIntake, parseInterviewTurn } from './intake';
import { EMPTY_MEMORY, validateMemory, type MemoryUpdate, type InterviewMemory } from './memory-types';
import { questionBlocked, reconcileTurn, rememberQuestion, vocabularyForSession } from './memory';

const update = (field: MemoryUpdate['field'], value: string | null, quote: string, extra: Partial<MemoryUpdate> = {}): MemoryUpdate =>
  ({ field, value, quote, status: value === null ? 'unknown' : 'answered', uncertain: false, correction: false, ...extra });
const input = (text: string) => [{ role: 'user' as const, content: text }];
const turn = (updates: MemoryUpdate[] = []) => ({ reply: 'Please continue.', intake: INITIAL_INTAKE, updates });
const opening = () => reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn([
  update('preferredName', 'Samir', "My name is Samir. I'm from Sudan and staying in Cairo."),
  update('countryOfOrigin', 'Sudan', "My name is Samir. I'm from Sudan and staying in Cairo."),
  update('currentCity', 'Cairo', "My name is Samir. I'm from Sudan and staying in Cairo.")
]), input("My name is Samir. I'm from Sudan and staying in Cairo."));

describe('session memory transitions', () => {
  it('retains name, origin and city when later model snapshots forget them', () => {
    const first = opening();
    const next = reconcileTurn(first.intake, first.memory, turn(), input('Around June 2025.'));
    expect(next.intake.profile.preferredName.value).toBe('Samir');
    expect(next.intake.profile.countryOfOrigin.value).toBe('Sudan');
    expect(next.memory.facts.currentCity?.value).toBe('Cairo');
    expect(validateMemory(next.memory)).toEqual(next.memory);
    expect(questionBlocked(next.intake, next.memory, { field: 'preferredName', intent: 'ask', candidate: null })).toBe(true);
  });
  it('handles a bare name as an answer to the preceding preferred-name question', () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { field: 'preferredName', intent: 'ask', candidate: null });
    const result = reconcileTurn(INITIAL_INTAKE, memory, turn(), input('Samir.'));
    expect(result.intake.profile.preferredName.value).toBe('Samir');
    expect(result.intake.profile.legalName.status).toBe('not_asked');
  });
  it('keeps Just Samir as a preferred-name choice and protects a legal-name refusal', () => {
    const first = opening();
    const memory = rememberQuestion(first.memory, { field: 'legalName', intent: 'ask', candidate: null });
    const result = reconcileTurn(first.intake, memory, turn([update('legalName', 'Samir', 'Just Samir.')]), input('Just Samir.'));
    expect(result.intake.profile.preferredName.value).toBe('Samir');
    expect(result.intake.profile.legalName).toEqual({ status: 'declined', value: null });
    const next = reconcileTurn(result.intake, result.memory, turn(), input('My brother disappeared.'));
    expect(questionBlocked(next.intake, next.memory, { field: 'legalName', intent: 'ask', candidate: null })).toBe(true);
  });
  it('does not interpret Just Cairo as a name outside a name discussion', () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { field: 'currentCity', intent: 'ask', candidate: null });
    expect(reconcileTurn(INITIAL_INTAKE, memory, turn(), input('Just Cairo.')).intake.profile.preferredName.status).toBe('not_asked');
  });
  it.each(['Khartoum', 'Mogadishu'])('retains a directly reported location: %s', value => {
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn([update('locations', value, value)]), input(value));
    expect(result.memory.facts.locations?.value).toBe(value);
    expect(questionBlocked(result.intake, result.memory, { field: 'locations', intent: 'ask', candidate: null })).toBe(true);
  });
  it.each([['K-H-A-R-T-O-U-M', 'Khartoum'], ['A-S-M-A-R-A', 'Asmara']])('recognizes explicitly spelled vocabulary without a location dictionary: %s', (raw, value) => {
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn([update('locations', value, raw)]), input(raw));
    expect(result.memory.facts.locations).toBeUndefined();
    expect(result.memory.pending.locations).toMatchObject({ value, uncertain: true });
    expect(vocabularyForSession(result.memory)).not.toContain(value);
  });
  it('keeps car tom uncertain until yes confirms the proposed spelling', () => {
    const raw = 'It happened in car tom.';
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn([update('locations', 'Khartoum', raw, { uncertain: true })]), input(raw));
    expect(result.intake.details.locations).toBe('unknown');
    expect(result.memory.facts.locations).toBeUndefined();
    expect(result.memory.pending.locations?.quote).toBe(raw);
    expect(vocabularyForSession(result.memory)).not.toContain('Khartoum');
    const memory = rememberQuestion(result.memory, { field: 'locations', intent: 'confirm', candidate: 'Khartoum' });
    const confirmed = reconcileTurn(result.intake, memory, turn(), input('Yes.'));
    expect(confirmed.memory.facts.locations).toMatchObject({ value: 'Khartoum', confirmed: true, uncertain: false });
    expect(confirmed.intake.details.locations).toBe('answered');
    expect(vocabularyForSession(confirmed.memory)).toContain('Khartoum');
    expect(confirmed.memory.clarificationAttempts.locations).toBe(0);
  });
  it('preserves a prior answer while holding an uncertain alternative separately', () => {
    const first = opening();
    const result = reconcileTurn(first.intake, first.memory,
      turn([update('currentCity', 'Cairo?', 'car row', { uncertain: true })]), input('car row'));
    expect(result.memory.facts.currentCity?.value).toBe('Cairo');
  });
  it('applies an explicit date correction and retains a superseded version', () => {
    const june = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn([update('approximateDates', 'June 2025', 'June 2025')]), input('June 2025'));
    const july = reconcileTurn(june.intake, june.memory, turn([update('approximateDates', 'July 2025', 'No, July 2025.', { correction: true })]), input('No, July 2025.'));
    expect(july.memory.facts.approximateDates).toMatchObject({ value: 'July 2025', previous: ['June 2025'] });
    const later = reconcileTurn(july.intake, july.memory, turn(), input('I have a screenshot.'));
    expect(later.memory.facts.approximateDates?.value).toBe('July 2025');
  });
  it('does not regress to intake when an already-started statement receives a blank extraction', () => {
    const previous = evaluateIntake({ ...opening().intake, skipIntake: true });
    const result = reconcileTurn(previous, opening().memory, turn(), input('My brother disappeared.'));
    expect(result.intake.stage).toBe('statement');
    expect(result.intake.profile.preferredName.value).toBe('Samir');
  });
  it('allows a voluntary new answer to reopen a declined field', () => {
    const declined = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY,
      turn([update('preferredName', null, 'Skip my name.', { status: 'declined' })]), input('Skip my name.'));
    const answered = reconcileTurn(declined.intake, declined.memory,
      turn([update('preferredName', 'Samir', 'You can call me Samir.', { correction: true })]), input('You can call me Samir.'));
    expect(answered.intake.profile.preferredName).toEqual({ status: 'answered', value: 'Samir' });
  });
  it('stops clarification after two unsuccessful attempts without marking a fact known', () => {
    const q = { field: 'locations' as const, intent: 'clarify' as const, candidate: null };
    let memory = rememberQuestion(EMPTY_MEMORY, q);
    let state = INITIAL_INTAKE;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = reconcileTurn(state, memory, turn([update('locations', null, "I don't know.")]), input("I don't know."));
      state = result.intake;
      memory = attempt === 0 ? rememberQuestion(result.memory, q) : result.memory;
    }
    expect(memory.clarificationAttempts.locations).toBe(2);
    expect(state.details.locations).toBe('unknown');
    expect(questionBlocked(state, memory, q)).toBe(true);
    expect(state.stage).not.toBe('ended');
  });
  it('binds a refusal to the last field and does not block urgent safety clarification', () => {
    const q = { field: 'harmOrThreats' as const, intent: 'ask' as const, candidate: null };
    const result = reconcileTurn(INITIAL_INTAKE, rememberQuestion(EMPTY_MEMORY, q), turn(), input('Skip.'));
    expect(result.intake.details.harmOrThreats).toBe('declined');
    expect(questionBlocked(result.intake, result.memory, q)).toBe(true);
    const memory: InterviewMemory = { ...EMPTY_MEMORY, clarificationAttempts: { current_safety: 2 } };
    expect(questionBlocked({ ...INITIAL_INTAKE, urgentSafetyConcern: true }, memory,
      { field: 'current_safety', intent: 'clarify', candidate: null })).toBe(false);
  });
  it('retains evidence attribution without implying a file was received or verified', () => {
    const text = 'My cousin says she has a screenshot. I have not seen it.';
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY,
      turn([update('available_evidence', 'Reported by cousin: screenshot; not seen by speaker.', text)]), input(text));
    expect(result.memory.facts.available_evidence?.quote).toBe(text);
    expect(result.memory.facts.available_evidence?.confirmed).toBe(false);
    expect(result.memory.facts.available_evidence?.value).toContain('Reported by cousin');
  });
  it('rejects unsupported source quotes and keeps narrative completeness factual', () => {
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY,
      turn([update('keyEvents', 'Invented event', 'an assistant suggestion')]), input('Yes.'));
    expect(result.memory.facts.keyEvents).toBeUndefined();
    expect(result.intake.details.keyEvents).toBe('not_asked');
    expect(result.intake.readyForSummary).toBe(false);
  });
  it('does not create invalid case state that fails on the next API request', () => {
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY,
      turn([update('existingCase', 'unregistered', 'unregistered')]), input('unregistered'));
    expect(result.intake.profile.existingCase.status).toBe('not_asked');
    expect(result.memory.facts.existingCase).toBeUndefined();
  });
  it('records a direct request for help without inventing a needed service', () => {
    const result = reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn(), input('I need help understanding a letter.'));
    expect(result.intake.categories.assistance_needed).toBe('answered');
    expect(result.memory.facts.assistance_needed?.value).toBe('I need help understanding a letter');
    expect(reconcileTurn(INITIAL_INTAKE, EMPTY_MEMORY, turn(), input('I do not need help.')).intake.categories.assistance_needed).toBe('not_asked');
  });
  it('rejects malformed memory and retains the spoken-question restriction', () => {
    expect(() => validateMemory({ ...EMPTY_MEMORY, clarificationAttempts: { locations: 999 } })).toThrow();
    const { stage, informationAdequate, readyForSummary, ...intake } = INITIAL_INTAKE;
    expect(() => parseInterviewTurn(JSON.stringify({ reply: 'Where? When?', intake, updates: [], question: null }))).toThrow('multiple spoken questions');
    expect(() => parseInterviewTurn(JSON.stringify({ reply: 'Where?', intake, updates: [], question: null }))).toThrow();
  });
});
