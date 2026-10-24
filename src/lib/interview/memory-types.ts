// Provider-neutral, bounded session memory. Nothing here is persisted.
export const MEMORY_FIELDS = [
  'preferredName', 'legalName', 'countryOfOrigin', 'currentCountry', 'currentCity',
  'existingCase', 'organizationOrRepresentative', 'caseReference', 'caseStatus',
  'identity_location', 'reason_for_fleeing', 'current_safety', 'available_evidence', 'assistance_needed',
  'keyEvents', 'approximateDates', 'locations', 'peopleInvolved', 'harmOrThreats',
  'whyTargeted', 'fearOfReturn', 'evidenceOrWitnessDetails', 'currentProtectionConcerns'
] as const;
export type MemoryField = typeof MEMORY_FIELDS[number];
export interface MemoryUpdate {
  field: MemoryField;
  status: 'answered' | 'declined' | 'unknown';
  value: string | null;
  quote: string;
  uncertain: boolean;
  correction: boolean;
}
export interface InterviewQuestion {
  field: MemoryField | 'review';
  intent: 'ask' | 'clarify' | 'confirm';
  candidate: string | null;
}
export interface RememberedFact extends MemoryUpdate {
  confirmed: boolean;
  previous: string[];
}
export interface InterviewMemory {
  facts: Partial<Record<MemoryField, RememberedFact>>;
  pending: Partial<Record<MemoryField, MemoryUpdate>>;
  clarificationAttempts: Partial<Record<MemoryField, number>>;
  lastQuestion: InterviewQuestion | null;
  statementStarted: boolean;
}
export const EMPTY_MEMORY: InterviewMemory = {
  facts: {}, pending: {}, clarificationAttempts: {}, lastQuestion: null, statementStarted: false
};

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('memory_schema');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) {
    throw new Error('memory_schema');
  }
  return record;
}
function field(value: unknown): MemoryField {
  if (!MEMORY_FIELDS.includes(value as MemoryField)) throw new Error('memory_field');
  return value as MemoryField;
}
export function validateQuestion(value: unknown): InterviewQuestion | null {
  if (value === null) return null;
  const q = object(value, ['field', 'intent', 'candidate']);
  if (!['ask', 'clarify', 'confirm'].includes(q.intent as string) ||
      !(q.candidate === null || typeof q.candidate === 'string' && q.candidate.trim() && q.candidate.length <= 300) ||
      q.intent === 'confirm' && q.candidate === null) throw new Error('memory_question');
  return { field: q.field === 'review' ? 'review' : field(q.field), intent: q.intent as InterviewQuestion['intent'], candidate: q.candidate as string | null };
}
export function validateUpdate(value: unknown): MemoryUpdate {
  const u = object(value, ['field', 'status', 'value', 'quote', 'uncertain', 'correction']);
  if (!['answered', 'declined', 'unknown'].includes(u.status as string) ||
      typeof u.quote !== 'string' || !u.quote.trim() || u.quote.length > 600 ||
      typeof u.uncertain !== 'boolean' || typeof u.correction !== 'boolean' ||
      (u.status === 'answered' ? typeof u.value !== 'string' || !u.value.trim() || u.value.length > 300 : u.value !== null)) {
    throw new Error('memory_update');
  }
  return { field: field(u.field), status: u.status as MemoryUpdate['status'], value: u.value as string | null,
    quote: u.quote, uncertain: u.uncertain, correction: u.correction };
}
export function validateUpdates(value: unknown): MemoryUpdate[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error('memory_updates');
  const updates = value.map(validateUpdate);
  if (new Set(updates.map(update => update.field)).size !== updates.length) throw new Error('duplicate_memory_field');
  return updates;
}
export function validateMemory(value: unknown): InterviewMemory {
  if (value === undefined) return structuredClone(EMPTY_MEMORY);
  const m = object(value, ['facts', 'pending', 'clarificationAttempts', 'lastQuestion', 'statementStarted']);
  if (typeof m.statementStarted !== 'boolean') throw new Error('memory_stage');
  for (const record of [m.facts, m.pending, m.clarificationAttempts]) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('memory_schema');
    Object.keys(record).forEach(field);
  }
  const facts: InterviewMemory['facts'] = {};
  for (const [key, raw] of Object.entries(m.facts as Record<string, unknown>)) {
    const f = object(raw, ['field', 'status', 'value', 'quote', 'uncertain', 'correction', 'confirmed', 'previous']);
    const { confirmed, previous, ...update } = f;
    const parsed = validateUpdate(update);
    if (parsed.field !== key || typeof confirmed !== 'boolean' || !Array.isArray(previous) || previous.length > 3 ||
        previous.some(v => typeof v !== 'string' || v.length > 300) || confirmed && (parsed.uncertain || parsed.status !== 'answered')) throw new Error('memory_fact');
    facts[field(key)] = { ...parsed, confirmed, previous: previous as string[] };
  }
  const clarificationAttempts: InterviewMemory['clarificationAttempts'] = {};
  const pending: InterviewMemory['pending'] = {};
  for (const [key, raw] of Object.entries(m.pending as Record<string, unknown>)) {
    const update = validateUpdate(raw);
    if (update.field !== key || !update.uncertain) throw new Error('memory_pending');
    pending[field(key)] = update;
  }
  for (const [key, count] of Object.entries(m.clarificationAttempts as Record<string, unknown>)) {
    if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 2) throw new Error('memory_attempts');
    clarificationAttempts[field(key)] = count as number;
  }
  return { facts, pending, clarificationAttempts, lastQuestion: validateQuestion(m.lastQuestion), statementStarted: m.statementStarted };
}
