import { describe, expect, it } from 'vitest';
import { spellingCandidate } from './spelling';
import { INITIAL_INTAKE } from './intake';
import { EMPTY_MEMORY, validateMemory, type MemoryUpdate } from './memory-types';
import { reconcileTurn, rememberQuestion, questionBlocked, vocabularyForSession } from './memory';
import { promptForIntake } from './system-prompt';

const input = (content: string) => [{ role: 'user' as const, content }];
const turn = (updates: MemoryUpdate[] = [], reply = 'Please continue.') => ({ reply, intake: INITIAL_INTAKE, updates });
const ask = { field: 'preferredName' as const, intent: 'ask' as const, candidate: null };
const update = (value: string, quote: string, uncertain = false): MemoryUpdate =>
  ({ field: 'preferredName', value, quote, status: 'answered', uncertain, correction: false });

describe('conservative spoken spelling', () => {
  it.each(['S-A-M-I-R', 'S, A, M, I, R', 'S A M I R', 'S as in Sam, A, M, I, R', 'My name is spelled S A M I R'])('reconstructs %s', raw => {
    expect(spellingCandidate(raw)).toBe('Samir');
  });
  it.each([['س ا م ي ر', 'سامير'], ['Ж А Н', 'ЖАН'], ['É L I', 'ÉLI']])('preserves non-ASCII letters: %s', (raw, expected) => {
    expect(spellingCandidate(raw)).toBe(expected);
  });
  it.each(['Samir', 'Som Mir', 'S A bee I R', 'S A M I bee R', 'S A M I R or S A M E R', 'I am a person', 'S A M maybe'])('does not guess from %s', raw => {
    expect(spellingCandidate(raw)).toBeNull();
  });
});

describe('proper noun confirmation state', () => {
  it('holds a model-interpreted Som Mir candidate without silently confirming it', () => {
    const result = reconcileTurn(INITIAL_INTAKE, rememberQuestion(EMPTY_MEMORY, ask),
      turn([update('Samir', 'Som Mir', true)]), input('Som Mir'));
    expect(result.memory.pending.preferredName?.value).toBe('Samir');
    expect(result.memory.facts.preferredName).toBeUndefined();
    expect(vocabularyForSession(result.memory)).not.toContain('Samir');
  });
  it.each(['Yes.', 'Yes, Samir.'])('requires a confirmation turn and accepts %s contextually', answer => {
    const first = reconcileTurn(INITIAL_INTAKE, rememberQuestion(EMPTY_MEMORY, ask),
      turn([update('Samir', 'S-A-M-I-R')]), input('S-A-M-I-R'));
    expect(first.memory.pending.preferredName).toMatchObject({ value: 'Samir', quote: 'S-A-M-I-R' });
    expect(first.intake.profile.preferredName.value).toBeNull();
    expect(first.reply).toBe('Samir. Did I get that right?');
    expect(first.question).toEqual({ field: 'preferredName', intent: 'confirm', candidate: 'Samir' });
    const next = reconcileTurn(first.intake, rememberQuestion(first.memory, first.question), turn(), input(answer));
    expect(next.memory.facts.preferredName).toMatchObject({ value: 'Samir', confirmed: true });
    expect(validateMemory(next.memory)).toEqual(next.memory);
    expect(questionBlocked(next.intake, next.memory, ask)).toBe(true);
    expect(next.intake.profile.legalName.status).toBe('not_asked');
  });
  it('does not accept a rejected location or erase the old confirmed value', () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { field: 'locations', intent: 'confirm', candidate: 'Khartoum' });
    const result = reconcileTurn(INITIAL_INTAKE, memory, turn([{
      ...update('Khartoum', 'No.'), field: 'locations'
    }]), input('No.'));
    expect(result.memory.facts.locations).toBeUndefined();
    expect(result.memory.pending.locations).toBeUndefined();
  });
  it('confirms corrected spelling before replacing an existing name and keeps history', () => {
    const first = reconcileTurn(INITIAL_INTAKE, rememberQuestion(EMPTY_MEMORY, ask), turn(), input('Samir'));
    const corrected = reconcileTurn(first.intake, first.memory,
      turn([update('Sameer', "Actually, it's Sameer, spelled S-A-M-E-E-R.")]), input("Actually, it's Sameer, spelled S-A-M-E-E-R."));
    expect(corrected.memory.facts.preferredName?.value).toBe('Samir');
    expect(corrected.memory.pending.preferredName?.value).toBe('Sameer');
    const confirmed = reconcileTurn(corrected.intake, rememberQuestion(corrected.memory, corrected.question), turn(), input('Yes'));
    expect(confirmed.memory.facts.preferredName).toMatchObject({ value: 'Sameer', confirmed: true, previous: ['Samir'] });
    expect(confirmed.memory.pending.preferredName).toBeUndefined();
  });
  it('allows one readback after failed repetitions, but does not reset for identical spelling', () => {
    const memory = { ...rememberQuestion(EMPTY_MEMORY, ask), clarificationAttempts: { preferredName: 2 } };
    const first = reconcileTurn(INITIAL_INTAKE, memory, turn(), input('S A M I R'));
    expect(first.question?.intent).toBe('confirm');
    expect(questionBlocked(first.intake, first.memory, first.question)).toBe(false);
    const next = reconcileTurn(first.intake, rememberQuestion(first.memory, first.question), turn(), input('S A M I R'));
    expect(next.memory.clarificationAttempts.preferredName).toBe(2);
    expect(questionBlocked(next.intake, next.memory, { ...ask, intent: 'clarify' })).toBe(true);
  });
  it('records Just Samir refusal even when the model already uses the safe reply', () => {
    const first = reconcileTurn(INITIAL_INTAKE, rememberQuestion(EMPTY_MEMORY, ask), turn(), input('Samir'));
    const result = reconcileTurn(first.intake,
      rememberQuestion(first.memory, { field: 'legalName', intent: 'ask', candidate: null }),
      turn([], 'Of course, I’ll use Samir.'), input('Just Samir.'));
    expect(result.memory.facts.legalName).toMatchObject({ status: 'declined', value: null, confirmed: false });
    expect(validateMemory(result.memory)).toEqual(result.memory);
    expect(questionBlocked(result.intake, result.memory, { field: 'legalName', intent: 'clarify', candidate: null })).toBe(true);
  });
  it('does not turn inability to spell into a name, refusal, or confirmation', () => {
    const memory = rememberQuestion(EMPTY_MEMORY, { ...ask, intent: 'clarify' });
    const result = reconcileTurn(INITIAL_INTAKE, memory, turn(), input("I don't know how to spell it in English."));
    expect(result.memory.facts.preferredName).toBeUndefined();
    const prompt = promptForIntake(result.intake, result.memory);
    expect(prompt).toContain('Offer saying it slowly');
    expect(prompt).toContain('do not ask them to spell in English again');
  });
  it('does not override an urgent safety response with spelling readback', () => {
    const result = reconcileTurn(INITIAL_INTAKE, rememberQuestion(EMPTY_MEMORY, ask),
      { ...turn([], 'Are you safe right now?'), intake: { ...INITIAL_INTAKE, urgentSafetyConcern: true } }, input('S A M I R'));
    expect(result.reply).toBe('Are you safe right now?');
    expect(result.memory.pending.preferredName?.value).toBe('Samir');
  });
});
