import { describe, expect, it } from 'vitest';
import {
  INITIAL_INTAKE, INTAKE_CATEGORIES, PROFILE_FIELDS, STATEMENT_DETAILS,
  enforceNameDisclosure, evaluateIntake, parseInterviewTurn, summarizeIntake, type IntakeState
} from './intake';

function stateWithCoreProfile(): IntakeState {
  const profile = { ...INITIAL_INTAKE.profile };
  for (const [field, value] of [
    ['preferredName', 'Sam'], ['countryOfOrigin', 'Sudan'],
    ['currentCountry', 'Egypt'], ['existingCase', 'no']
  ] as const) profile[field] = { status: 'answered', value };
  return evaluateIntake({ ...INITIAL_INTAKE, profile });
}

function detailedState(): IntakeState {
  const current = stateWithCoreProfile();
  return evaluateIntake({
    ...current,
    categories: Object.fromEntries(INTAKE_CATEGORIES.map(category => [category, 'answered'])) as typeof current.categories,
    details: {
      ...current.details,
      keyEvents: 'answered', approximateDates: 'answered', locations: 'answered'
    }
  });
}

const { stage: _stage, informationAdequate: _adequacy, readyForSummary: _ready, ...initialModelState } = INITIAL_INTAKE;

describe('two-stage intake and completion evaluator', () => {
  it('starts in intake and marks all details not asked', () => {
    expect(INITIAL_INTAKE.stage).toBe('intake');
    expect(PROFILE_FIELDS.every(field => INITIAL_INTAKE.profile[field].status === 'not_asked')).toBe(true);
    expect(STATEMENT_DETAILS.every(field => INITIAL_INTAKE.details[field] === 'not_asked')).toBe(true);
  });

  it('moves a new fictional user with no existing case into statement stage after core intake', () => {
    const state = stateWithCoreProfile();
    expect(state.profile.existingCase).toEqual({ status: 'answered', value: 'no' });
    expect(state.stage).toBe('statement');
    expect(state.readyForSummary).toBe(false);
  });

  it('supports an existing case and keeps optional case association details separate', () => {
    const base = stateWithCoreProfile();
    const profile = { ...base.profile, existingCase: { status: 'answered' as const, value: 'Pending' } };
    const state = evaluateIntake({ ...base, profile });
    expect(state.stage).toBe('intake');
    const withCaseDetails = evaluateIntake({
      ...state,
      profile: {
        ...profile,
        organizationOrRepresentative: { status: 'answered', value: 'Fictional Legal Aid' },
        caseReference: { status: 'unknown', value: null },
        caseStatus: { status: 'answered', value: 'Pending review' }
      }
    });
    expect(withCaseDetails.stage).toBe('statement');
    expect(withCaseDetails.profile.caseReference.status).toBe('unknown');
  });

  it('allows the user to skip intake and proceed with the statement', () => {
    const state = evaluateIntake({ ...INITIAL_INTAKE, skipIntake: true });
    expect(state.stage).toBe('statement');
    expect(state.profile.caseReference.status).toBe('not_asked');
  });

  it('can reach narrative adequacy without collecting identifying intake fields', () => {
    const current = evaluateIntake({
      ...INITIAL_INTAKE,
      skipIntake: true,
      categories: Object.fromEntries(INTAKE_CATEGORIES.map(category => [category, 'answered'])) as typeof INITIAL_INTAKE.categories,
      details: { ...INITIAL_INTAKE.details, keyEvents: 'answered', approximateDates: 'answered', harmOrThreats: 'answered' }
    });
    expect(current.informationAdequate).toBe(true);
    expect(current.stage).toBe('summary_offer');
    expect(current.profile.legalName.status).toBe('not_asked');
  });

  it('preserves an unknown case reference as unknown, not fabricated', () => {
    const base = stateWithCoreProfile();
    const profile = { ...base.profile, caseReference: { status: 'unknown' as const, value: null } };
    const state = evaluateIntake({ ...base, profile });
    expect(state.profile.caseReference).toEqual({ status: 'unknown', value: null });
  });

  it('allows refusal to provide names and does not require personal information to proceed', () => {
    const base = stateWithCoreProfile();
    const profile = {
      ...base.profile,
      preferredName: { status: 'declined' as const, value: null },
      legalName: { status: 'declined' as const, value: null }
    };
    const state = evaluateIntake({ ...base, profile });
    expect(state.stage).toBe('statement');
  });

  it('does not offer a complete summary when five topics are complete but story detail is insufficient', () => {
    const base = stateWithCoreProfile();
    const state = evaluateIntake({
      ...base,
      categories: Object.fromEntries(INTAKE_CATEGORIES.map(category => [category, 'answered'])) as typeof base.categories,
      details: { ...base.details, keyEvents: 'answered', approximateDates: 'unknown', locations: 'declined' }
    });
    expect(state.informationAdequate).toBe(false);
    expect(state.readyForSummary).toBe(false);
    expect(state.stage).toBe('statement');
  });

  it('allows summary when meaningful event detail and all five topics are covered', () => {
    const state = detailedState();
    expect(state.informationAdequate).toBe(true);
    expect(state.readyForSummary).toBe(true);
    expect(state.stage).toBe('summary_offer');
  });

  it('offers an explicitly incomplete summary on voluntary early termination', () => {
    const state = evaluateIntake({ ...INITIAL_INTAKE, finishRequested: true });
    expect(state.stage).toBe('summary_offer');
    expect(state.informationAdequate).toBe(false);
    expect(state.readyForSummary).toBe(true);
    expect(summarizeIntake(state).completeness).toBe('incomplete');
  });

  it('lets a user decline traumatic details and records the refusal without pressure', () => {
    const base = stateWithCoreProfile();
    const state = evaluateIntake({ ...base, details: { ...base.details, harmOrThreats: 'declined' } });
    expect(state.details.harmOrThreats).toBe('declined');
    expect(summarizeIntake(state).declined).toContain('harmOrThreats');
  });

  it('prioritizes urgent safety and pauses over routine completion', () => {
    const adequate = detailedState();
    expect(evaluateIntake({ ...adequate, urgentSafetyConcern: true }).stage).toBe('urgent');
    expect(evaluateIntake({ ...adequate, pauseRequested: true }).stage).toBe('paused');
  });

  it.each([
    ['accepted', 'summary_review'], ['confirmed', 'ended'], ['declined', 'ended']
  ] as const)('evaluates summary status %s as %s', (summaryStatus, stage) => {
    expect(evaluateIntake({ ...detailedState(), summaryStatus }).stage).toBe(stage);
  });

  it('builds a structured end summary with unresolved, declined, and unknown items', () => {
    const base = stateWithCoreProfile();
    const state = evaluateIntake({
      ...base,
      profile: { ...base.profile, caseReference: { status: 'unknown', value: null } },
      categories: { ...base.categories, available_evidence: 'declined' },
      details: { ...base.details, keyEvents: 'unknown' }
    });
    const summary = summarizeIntake(state);
    expect(summary.profile.caseReference.status).toBe('unknown');
    expect(summary.declined).toContain('available_evidence');
    expect(summary.unknown).toContain('keyEvents');
    expect(summary.unresolved).toContain('reason_for_fleeing');
    expect(summary.completeness).toBe('incomplete');
  });
});

describe('model turn extraction', () => {
  it('extracts only the reply and validates new profile, topic, and detail state', () => {
    const state = stateWithCoreProfile();
    const { stage: _stage, informationAdequate: _adequate, readyForSummary: _ready, ...modelState } = state;
    const result = parseInterviewTurn(JSON.stringify({ reply: 'What happened next?', intake: modelState }));
    expect(result.reply).toBe('What happened next?');
    expect(result.intake.stage).toBe('statement');
    expect(result.intake.readyForSummary).toBe(false);
  });

  it.each([
    (json: string) => `Here is the response:\n\n${json}`,
    (json: string) => `Some explanation first.\n\n\`\`\`json\n${json}\n\`\`\``,
    (json: string) => `\`\`\`text\nexample\n\`\`\`\n\n\`\`\`json\n${json}\n\`\`\``
  ])('finds the structured turn despite common model wrappers', wrap => {
    const json = JSON.stringify({ reply: 'What happened next?', intake: initialModelState });
    expect(parseInterviewTurn(wrap(json)).reply).toBe('What happened next?');
  });

  it('enforces no more than one question in the user-facing reply', () => {
    expect(() => parseInterviewTurn(JSON.stringify({ reply: 'When? Where?', intake: initialModelState })))
      .toThrow('multiple spoken questions');
  });

  it('rejects malformed state with a field-safe validation error', () => {
    const intake = {
      ...INITIAL_INTAKE,
      profile: { ...INITIAL_INTAKE.profile, caseReference: { status: 'answered', value: null } }
    };
    expect(() => parseInterviewTurn(JSON.stringify({ reply: 'Okay.', intake })))
      .toThrow('could not be validated');
  });

  it.each([
    [{ reply: 'Hello.' }, 'response.intake:missing'],
    [{ reply: 'Hello.', intake: initialModelState, unexpected: true }, 'response.unexpected:unexpected'],
    [{ reply: 'Hello.', intake: { ...initialModelState, extra: 'value' } }, 'intake.extra:unexpected']
  ])('identifies missing or unexpected schema fields', (value, field) => {
    try {
      parseInterviewTurn(JSON.stringify(value));
      throw new Error('expected invalid output');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'malformed_output', field });
    }
  });

  it('reports safe format-only diagnostics for malformed JSON', () => {
    const privateContent = 'PRIVATE_STORY ```json { "reply": "PRIVATE_REPLY", "intake": ';
    try {
      parseInterviewTurn(privateContent);
      throw new Error('expected parse failure');
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'malformed_output', stage: 'json_parse', field: '$',
        diagnostics: {
          contentLength: privateContent.length,
          fenceCount: 1,
          hasReplyKeyMarker: true,
          hasIntakeKeyMarker: true
        }
      });
      expect(JSON.stringify((error as Error).message)).not.toContain('PRIVATE_');
    }
  });

  it('keeps a preferred-only name out of legalName and records legal-name refusal', () => {
    const modelTurn = parseInterviewTurn(JSON.stringify({
      reply: 'I have recorded Amina as your legal name.',
      intake: {
        categories: INITIAL_INTAKE.categories, details: INITIAL_INTAKE.details,
        urgentSafetyConcern: false, skipIntake: false, finishRequested: false,
        pauseRequested: false, summaryStatus: 'not_offered',
        profile: {
          ...INITIAL_INTAKE.profile,
          preferredName: { status: 'answered', value: 'Amina' },
          legalName: { status: 'answered', value: 'Amina' }
        }
      }
    }));
    const corrected = enforceNameDisclosure(modelTurn, 'Just Amina.');
    expect(corrected.reply).toBe('Of course, I’ll use Amina.');
    expect(corrected.intake.profile.preferredName).toEqual({ status: 'answered', value: 'Amina' });
    expect(corrected.intake.profile.legalName).toEqual({ status: 'declined', value: null });
  });

  it('preserves an explicit legal-name refusal or uncertainty as separate statuses', () => {
    const turn = { reply: 'Okay.', intake: INITIAL_INTAKE };
    expect(enforceNameDisclosure(turn, "I prefer not to provide my legal name.").intake.profile.legalName)
      .toEqual({ status: 'declined', value: null });
    expect(enforceNameDisclosure(turn, "I don't know my legal name.").intake.profile.legalName)
      .toEqual({ status: 'unknown', value: null });
  });

  it('does not store a safe contact method in a prototype that has no follow-up workflow', () => {
    const intake = {
      ...INITIAL_INTAKE,
      profile: { ...INITIAL_INTAKE.profile, safeContactMethod: { status: 'answered', value: 'fictional phone' } }
    };
    expect(() => parseInterviewTurn(JSON.stringify({ reply: 'Noted.', intake })))
      .toThrow('could not be validated');
  });
});
