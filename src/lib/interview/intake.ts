export const PROFILE_FIELDS = [
  'preferredName', 'legalName', 'countryOfOrigin', 'currentCountry', 'existingCase',
  'organizationOrRepresentative', 'caseReference', 'caseStatus', 'safeContactMethod'
] as const;

export const INTAKE_CATEGORIES = [
  'identity_location', 'reason_for_fleeing', 'current_safety', 'available_evidence', 'assistance_needed'
] as const;

export const STATEMENT_DETAILS = [
  'keyEvents', 'approximateDates', 'locations', 'peopleInvolved', 'harmOrThreats',
  'whyTargeted', 'fearOfReturn', 'evidenceOrWitnessDetails', 'currentProtectionConcerns'
] as const;

export type ProfileField = typeof PROFILE_FIELDS[number];
export type IntakeCategory = typeof INTAKE_CATEGORIES[number];
export type StatementDetail = typeof STATEMENT_DETAILS[number];
export type AnswerStatus = 'not_asked' | 'answered' | 'declined' | 'unknown';
export type InterviewStage = 'intake' | 'statement' | 'urgent' | 'summary_offer' | 'summary_review' | 'paused' | 'ended';
export type SummaryStatus = 'not_offered' | 'offered' | 'accepted' | 'confirmed' | 'declined';

export interface ProfileAnswer {
  status: AnswerStatus;
  value: string | null;
}

export interface IntakeState {
  profile: Record<ProfileField, ProfileAnswer>;
  categories: Record<IntakeCategory, AnswerStatus>;
  details: Record<StatementDetail, AnswerStatus>;
  urgentSafetyConcern: boolean;
  skipIntake: boolean;
  finishRequested: boolean;
  pauseRequested: boolean;
  summaryStatus: SummaryStatus;
  stage: InterviewStage;
  informationAdequate: boolean;
  readyForSummary: boolean;
}

const emptyProfile = (): Record<ProfileField, ProfileAnswer> => Object.fromEntries(
  PROFILE_FIELDS.map(field => [field, { status: 'not_asked', value: null }])
) as Record<ProfileField, ProfileAnswer>;

const emptyStatuses = <T extends string>(fields: readonly T[]): Record<T, AnswerStatus> => Object.fromEntries(
  fields.map(field => [field, 'not_asked'])
) as Record<T, AnswerStatus>;

export const INITIAL_INTAKE: IntakeState = {
  profile: emptyProfile(),
  categories: emptyStatuses(INTAKE_CATEGORIES),
  details: emptyStatuses(STATEMENT_DETAILS),
  urgentSafetyConcern: false,
  skipIntake: false,
  finishRequested: false,
  pauseRequested: false,
  summaryStatus: 'not_offered',
  stage: 'intake',
  informationAdequate: false,
  readyForSummary: false
};

export class IntakeValidationError extends Error {
  constructor(public field: string) {
    super('Invalid interview state.');
    this.name = 'IntakeValidationError';
  }
}

const ANSWER_STATUSES = new Set<AnswerStatus>(['not_asked', 'answered', 'declined', 'unknown']);
const SUMMARY_STATUSES = new Set<SummaryStatus>(['not_offered', 'offered', 'accepted', 'confirmed', 'declined']);
const CORE_PROFILE_FIELDS: ProfileField[] = ['preferredName', 'countryOfOrigin', 'currentCountry', 'existingCase'];
const CORE_STATEMENT_FACTS: StatementDetail[] = ['approximateDates', 'locations', 'peopleInvolved', 'harmOrThreats'];

function isResolved(status: AnswerStatus): boolean {
  return status !== 'not_asked';
}

function caseDetailsAreRelevant(profile: Record<ProfileField, ProfileAnswer>): boolean {
  return profile.existingCase.status === 'answered' &&
    ['yes', 'pending'].includes((profile.existingCase.value ?? '').toLowerCase());
}

function assertExactKeys(value: Record<string, unknown>, fields: readonly string[], prefix: string): void {
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new IntakeValidationError(`${prefix}.${key}:unexpected`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new IntakeValidationError(`${prefix}.${field}:missing`);
  }
}

function hasAdequateStatement(state: Pick<IntakeState, 'categories' | 'details'>): boolean {
  const supportingDetails = CORE_STATEMENT_FACTS.filter(field => state.details[field] === 'answered').length;
  return state.categories.reason_for_fleeing === 'answered' &&
    state.details.keyEvents === 'answered' && supportingDetails >= 2;
}

function calculateAdequacy(state: Omit<IntakeState, 'stage' | 'informationAdequate' | 'readyForSummary'>): boolean {
  const allTopicsAddressed = INTAKE_CATEGORIES.every(category => isResolved(state.categories[category]));
  return allTopicsAddressed && hasAdequateStatement(state);
}

/** Completion is code-owned: all five topics alone are not enough; a factual event and two concrete detail areas are required. */
export function evaluateIntake(
  state: Omit<IntakeState, 'stage' | 'informationAdequate' | 'readyForSummary'>
): IntakeState {
  const informationAdequate = calculateAdequacy(state);
  const readyForSummary = !state.pauseRequested && !state.urgentSafetyConcern &&
    (informationAdequate || state.finishRequested);
  const caseDetailsComplete = !caseDetailsAreRelevant(state.profile) ||
    (['organizationOrRepresentative', 'caseReference', 'caseStatus'] as const)
      .every(field => isResolved(state.profile[field].status));
  const intakeComplete = CORE_PROFILE_FIELDS.every(field => isResolved(state.profile[field].status)) && caseDetailsComplete;
  const stage: InterviewStage = state.pauseRequested ? 'paused'
    : state.urgentSafetyConcern ? 'urgent'
    : state.summaryStatus === 'confirmed' || state.summaryStatus === 'declined' ? 'ended'
    : state.summaryStatus === 'accepted' ? 'summary_review'
    : readyForSummary ? 'summary_offer'
    : intakeComplete || state.skipIntake ? 'statement' : 'intake';
  return { ...state, stage, informationAdequate, readyForSummary };
}

function validateStatusRecord<T extends string>(
  value: unknown,
  fields: readonly T[],
  prefix: string
): Record<T, AnswerStatus> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeValidationError(prefix);
  const raw = value as Record<string, unknown>;
  assertExactKeys(raw, fields, prefix);
  const result = {} as Record<T, AnswerStatus>;
  for (const field of fields) {
    if (!ANSWER_STATUSES.has(raw[field] as AnswerStatus)) throw new IntakeValidationError(`${prefix}.${field}`);
    result[field] = raw[field] as AnswerStatus;
  }
  return result;
}

export function validateIntakeState(value: unknown): IntakeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeValidationError('intake');
  const candidate = value as Record<string, unknown>;
  assertExactKeys(candidate, [
    'profile', 'categories', 'details', 'urgentSafetyConcern', 'skipIntake',
    'finishRequested', 'pauseRequested', 'summaryStatus'
  ], 'intake');
  const profileRaw = candidate.profile;
  if (!profileRaw || typeof profileRaw !== 'object' || Array.isArray(profileRaw)) {
    throw new IntakeValidationError('intake.profile');
  }
  const profileData = profileRaw as Record<string, unknown>;
  const profile = {} as Record<ProfileField, ProfileAnswer>;
  for (const field of PROFILE_FIELDS) {
    const answer = profileData[field];
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new IntakeValidationError(`intake.profile.${field}`);
    }
    const item = answer as Record<string, unknown>;
    assertExactKeys(item, ['status', 'value'], `intake.profile.${field}`);
    if (!ANSWER_STATUSES.has(item.status as AnswerStatus)) {
      throw new IntakeValidationError(`intake.profile.${field}.status`);
    }
    if (field === 'safeContactMethod' && item.status === 'answered') {
      throw new IntakeValidationError('intake.profile.safeContactMethod');
    }
    if (item.status === 'answered') {
      if (typeof item.value !== 'string' || !item.value.trim() || item.value.length > 300) {
        throw new IntakeValidationError(`intake.profile.${field}.value`);
      }
      if (field === 'existingCase' && !['yes', 'pending', 'no'].includes(item.value.trim().toLowerCase())) {
        throw new IntakeValidationError('intake.profile.existingCase.value');
      }
      profile[field] = { status: 'answered', value: item.value.trim() };
    } else {
      if (item.value !== null) throw new IntakeValidationError(`intake.profile.${field}.value`);
      profile[field] = { status: item.status as AnswerStatus, value: null };
    }
  }

  const categories = validateStatusRecord(candidate.categories, INTAKE_CATEGORIES, 'intake.categories');
  const details = validateStatusRecord(candidate.details, STATEMENT_DETAILS, 'intake.details');
  for (const field of ['urgentSafetyConcern', 'skipIntake', 'finishRequested', 'pauseRequested'] as const) {
    if (typeof candidate[field] !== 'boolean') throw new IntakeValidationError(`intake.${field}`);
  }
  if (!SUMMARY_STATUSES.has(candidate.summaryStatus as SummaryStatus)) {
    throw new IntakeValidationError('intake.summaryStatus');
  }
  return evaluateIntake({
    profile,
    categories,
    details,
    urgentSafetyConcern: candidate.urgentSafetyConcern as boolean,
    skipIntake: candidate.skipIntake as boolean,
    finishRequested: candidate.finishRequested as boolean,
    pauseRequested: candidate.pauseRequested as boolean,
    summaryStatus: candidate.summaryStatus as SummaryStatus
  });
}

export interface InterviewSummary {
  profile: Record<ProfileField, ProfileAnswer>;
  statementTopics: Record<IntakeCategory, AnswerStatus>;
  statementDetails: Record<StatementDetail, AnswerStatus>;
  completeness: 'sufficient_for_initial_review' | 'incomplete';
  unresolved: string[];
  declined: string[];
  unknown: string[];
}

/** A structured, browser-memory-only status summary; narrative facts stay in the conversation for user review. */
export function summarizeIntake(state: IntakeState): InterviewSummary {
  const unresolved: string[] = [];
  const declined: string[] = [];
  const unknown: string[] = [];
  const record = (label: string, status: AnswerStatus) => {
    if (status === 'not_asked') unresolved.push(label);
    else if (status === 'declined') declined.push(label);
    else if (status === 'unknown') unknown.push(label);
  };
  for (const field of PROFILE_FIELDS) {
    if (field === 'legalName' || field === 'safeContactMethod') continue;
    if (!caseDetailsAreRelevant(state.profile) &&
        ['organizationOrRepresentative', 'caseReference', 'caseStatus'].includes(field)) continue;
    record(field, state.profile[field].status);
  }
  for (const category of INTAKE_CATEGORIES) record(category, state.categories[category]);
  for (const detail of STATEMENT_DETAILS) record(detail, state.details[detail]);
  return {
    profile: state.profile,
    statementTopics: state.categories,
    statementDetails: state.details,
    completeness: state.informationAdequate ? 'sufficient_for_initial_review' : 'incomplete',
    unresolved,
    declined,
    unknown
  };
}

export interface InterviewTurn {
  reply: string;
  intake: Omit<IntakeState, 'stage' | 'informationAdequate' | 'readyForSummary'>;
}

/** Deterministic protection for unambiguous name-only preferences and legal-name responses. */
export function enforceNameDisclosure(turn: { reply: string; intake: IntakeState }, userText: string) {
  const match = userText.trim().match(
    /^(?:just|only|please use just|i prefer (?:to use )?(?:just )?|i(?:'ll| will)? use just)\s+([\p{L}\p{M}][\p{L}\p{M}'’ -]{0,79})[.!]?$/iu
  );
  if (match) {
    const name = match[1].trim().replace(/[.!?]+$/, '').trim();
    if (name) {
      const profile = {
        ...turn.intake.profile,
        preferredName: { status: 'answered' as const, value: name },
        legalName: { status: 'declined' as const, value: null }
      };
      const intake = evaluateIntake({ ...turn.intake, profile });
      return { reply: `Of course, I’ll use ${name}.`, intake };
    }
  }
  if (/\b(?:i(?:'d| would) rather not|i prefer not to|i do not want to|i don't want to|i am not comfortable|i'm not comfortable)\b.{0,60}\b(?:give|provide|share|say|disclose|answer)\b.{0,30}\blegal name\b|\blegal name\b.{0,50}\b(?:prefer not|rather not|do not want|don't want|not comfortable)\b/iu.test(userText)) {
    const intake = evaluateIntake({
      ...turn.intake,
      profile: { ...turn.intake.profile, legalName: { status: 'declined', value: null } }
    });
    return { reply: 'That’s okay; we can leave your legal name blank.', intake };
  }
  if (/\b(?:i don't know|i do not know|not sure|unsure)\b.{0,40}\blegal name\b|\blegal name\b.{0,40}\b(?:i don't know|i do not know|not sure|unsure)\b/iu.test(userText)) {
    const intake = evaluateIntake({
      ...turn.intake,
      profile: { ...turn.intake.profile, legalName: { status: 'unknown', value: null } }
    });
    return { reply: 'That’s okay; we can leave it unknown.', intake };
  }
  return turn;
}

export class InterviewOutputError extends Error {
  constructor(
    public kind: 'multiple_questions' | 'malformed_output',
    public stage: 'json_parse' | 'root_schema' | 'reply_schema' | 'question_count' | 'intake_schema',
    public field?: string,
    public diagnostics?: {
      contentLength: number;
      fenceCount: number;
      objectCandidateCount: number;
      parseAttemptCount: number;
      hasReplyKeyMarker: boolean;
      hasIntakeKeyMarker: boolean;
    }
  ) {
    super(kind === 'multiple_questions' ? 'The response contains multiple spoken questions.' : 'The interview response could not be validated.');
    this.name = 'InterviewOutputError';
  }
}

function balancedJsonObjects(content: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

/** Models may wrap the required JSON in prose or markdown. Try every plausible object,
 * then validate the unchanged response schema; never expose wrapper text as a reply. */
function parseJsonResponse(content: string): unknown {
  const candidates: string[] = [];
  const trimmed = content.trim();
  if (trimmed) candidates.push(trimmed);
  for (const match of content.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    const block = match[1].trim();
    if (block) candidates.push(block);
    candidates.push(...balancedJsonObjects(block));
  }
  candidates.push(...balancedJsonObjects(content));
  const uniqueCandidates = [...new Set(candidates)];
  let parseAttemptCount = 0;
  let parsedFallback: unknown;
  for (const candidate of uniqueCandidates) {
    try {
      parseAttemptCount += 1;
      const parsed: unknown = JSON.parse(candidate);
      if (parsedFallback === undefined) parsedFallback = parsed;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const value = parsed as Record<string, unknown>;
        if ('reply' in value || 'intake' in value) return parsed;
      }
    } catch {
      // Continue to the next wrapper/object candidate without logging model content.
    }
  }
  if (parsedFallback !== undefined) return parsedFallback;
  throw new InterviewOutputError('malformed_output', 'json_parse', '$', {
    contentLength: content.length,
    fenceCount: [...content.matchAll(/```/g)].length,
    objectCandidateCount: uniqueCandidates.length,
    parseAttemptCount,
    hasReplyKeyMarker: /["']reply["']\s*:/.test(content),
    hasIntakeKeyMarker: /["']intake["']\s*:/.test(content)
  });
}

export function parseInterviewTurn(
  content: string,
  onStage?: (stage: 'json_parse_succeeded' | 'schema_validation_succeeded') => void
): { reply: string; intake: IntakeState } {
  const parsed = parseJsonResponse(content);
  onStage?.('json_parse_succeeded');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InterviewOutputError('malformed_output', 'root_schema', '$');
  }
  const value = parsed as Record<string, unknown>;
  try { assertExactKeys(value, ['reply', 'intake'], 'response'); }
  catch (error) {
    throw new InterviewOutputError('malformed_output', 'root_schema',
      error instanceof IntakeValidationError ? error.field : '$');
  }
  if (typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 4000) {
    throw new InterviewOutputError('malformed_output', 'reply_schema', 'reply');
  }
  if ((value.reply.match(/[?¿؟？]/g) ?? []).length > 1) {
    throw new InterviewOutputError('multiple_questions', 'question_count', 'reply');
  }
  try {
    const intake = validateIntakeState(value.intake);
    onStage?.('schema_validation_succeeded');
    return { reply: value.reply.trim(), intake };
  }
  catch (error) {
    throw new InterviewOutputError('malformed_output', 'intake_schema',
      error instanceof IntakeValidationError ? error.field : 'intake');
  }
}
