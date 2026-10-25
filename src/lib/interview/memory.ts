import {
  enforceNameDisclosure, evaluateIntake, INTAKE_CATEGORIES, PROFILE_FIELDS, STATEMENT_DETAILS,
  type AnswerStatus, type IntakeState, type ProfileField
} from './intake';
import { type InterviewMemory, type InterviewQuestion, type MemoryField, type MemoryUpdate } from './memory-types';
import type { ChatMessage } from '../types/chat';
import { spellingCandidate, PROPER_NOUN_FIELDS } from './spelling';

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const yes = (text: string) => /^(yes|yeah|yes that's right|that's right|correct|نعم|أيوه|ايوه)[.!،\s]*$/iu.test(text.trim());
const noAnswer = (text: string) => /^(i don't know|i do not know|not sure|i can't remember|i cannot remember)[.!\s]*$/i.test(text.trim());
const refusal = (text: string) => /^(skip(?: this(?: question)?)?|i(?:'d| would) rather not(?: answer)?|i (?:don't|do not) want to (?:answer|discuss (?:it|that))|prefer not to answer)[.!\s]*$/i.test(text.trim());
const properNoun = (field: string) => (PROPER_NOUN_FIELDS as readonly string[]).includes(field);
const confirms = (text: string, candidate: string | null) => yes(text) || !!candidate &&
  /^(yes|yeah|correct|نعم)[,،\s]+/iu.test(text.trim()) &&
  normalize(text.trim().replace(/^(yes|yeah|correct|نعم)[,،\s]+/iu, '').replace(/[.!]$/, '')) === normalize(candidate);

export function fieldStatus(state: IntakeState, field: MemoryField): AnswerStatus {
  if (field in state.profile) return state.profile[field as ProfileField].status;
  if (field in state.categories) return state.categories[field as keyof typeof state.categories];
  if (field in state.details) return state.details[field as keyof typeof state.details];
  return 'not_asked';
}
function setField(state: IntakeState, update: Pick<MemoryUpdate, 'field' | 'status' | 'value'>) {
  if (update.field in state.profile) {
    state.profile[update.field as ProfileField] = { status: update.status, value: update.value };
  } else if (update.field in state.categories) {
    state.categories[update.field as keyof typeof state.categories] = update.status;
  } else if (update.field in state.details) {
    state.details[update.field as keyof typeof state.details] = update.status;
  }
}

/** Bounded continuity, not a database or a claim that model extraction is verified. */
export function reconcileTurn(
  prior: IntakeState,
  memory: InterviewMemory,
  turn: { reply: string; intake: IntakeState; updates?: MemoryUpdate[]; question?: InterviewQuestion | null },
  messages: ChatMessage[]
) {
  const state = structuredClone(turn.intake);
  const nextMemory = structuredClone(memory);
  const latest = messages.at(-1)!.content;
  const lastQuestion = memory.lastQuestion;
  const updates = [...(turn.updates ?? [])];
  const accepted: MemoryField[] = [];
  const ignored: MemoryField[] = [];
  const spelling = spellingCandidate(latest);
  const spellingField = updates.find(update => properNoun(update.field) && spelling && normalize(update.value ?? '') === normalize(spelling))?.field
    ?? (lastQuestion && properNoun(lastQuestion.field) ? lastQuestion.field as MemoryField : undefined);
  if (spelling && spellingField) {
    // Override even a model update that prematurely calls spelled letters certain.
    for (let i = updates.length - 1; i >= 0; i--) if (updates[i].field === spellingField) updates.splice(i, 1);
    updates.push({ field: spellingField, status: 'answered', value: spelling, quote: latest.slice(0, 600),
      uncertain: true, correction: false });
  }
  const confirmation = lastQuestion?.intent === 'confirm' && confirms(latest, lastQuestion.candidate);
  const rejected = lastQuestion?.intent === 'confirm' && /^(no|nope|لا)[.!\s]*$/iu.test(latest.trim());
  if (rejected && lastQuestion.field !== 'review') {
    // Rejection is not affirmation and does not erase an older confirmed value.
    for (let i = updates.length - 1; i >= 0; i--) if (updates[i].field === lastQuestion.field) updates.splice(i, 1);
    delete nextMemory.pending[lastQuestion.field];
  }
  // A direct request for help is itself the assistance answer, even if the model
  // filed the same sentence only under protection concerns. Retain the person's
  // exact words; do not infer what assistance they ought to want.
  const helpRequest = latest.match(/(?:^|[.!?]\s+)(I (?:need|want|would like|am looking for) (?:help|assistance|support)\b[^.!?]{0,250})/i)?.[1];
  if (helpRequest && !updates.some(update => update.field === 'assistance_needed')) {
    updates.push({ field: 'assistance_needed', status: 'answered', value: helpRequest,
      quote: helpRequest, uncertain: false, correction: false });
  }

  // Omission is not a correction. Model snapshots must not erase resolved facts.
  for (const field of PROFILE_FIELDS) {
    if (turn.updates || prior.profile[field].status !== 'not_asked') state.profile[field] = { ...prior.profile[field] };
  }
  for (const field of INTAKE_CATEGORIES) {
    if (turn.updates || prior.categories[field] !== 'not_asked') state.categories[field] = prior.categories[field];
  }
  for (const field of STATEMENT_DETAILS) {
    if (turn.updates || prior.details[field] !== 'not_asked') state.details[field] = prior.details[field];
  }
  // Current directly supplied short answers bind to the previous question, not a
  // newly generated question. A suggested spelling needs the person's confirmation.
  if (lastQuestion?.field === 'preferredName' && lastQuestion.intent === 'ask' &&
      /^[\p{L}\p{M}][\p{L}\p{M}'’-]{0,79}[.!]?$/u.test(latest.trim()) &&
      !yes(latest) && !noAnswer(latest) && !refusal(latest) && !/^(no|maybe|hello|hi|okay|ok)[.!]?$/i.test(latest.trim())) {
    const value = latest.trim().replace(/[.!]$/, '');
    if (!updates.some(update => update.field === 'preferredName')) {
      updates.push({ field: 'preferredName', status: 'answered', value, quote: latest,
        uncertain: false, correction: false });
    }
  }
  if (lastQuestion && lastQuestion.field !== 'review' && (confirmation || noAnswer(latest) || refusal(latest))) {
    const status = refusal(latest) ? 'declined' : noAnswer(latest) ? 'unknown' : 'answered';
    updates.push({ field: lastQuestion.field, status, value: status === 'answered' ? lastQuestion.candidate : null,
      quote: latest, uncertain: false, correction: false });
  }
  for (const update of updates) {
    const old = memory.facts[update.field];
    // A verbatim source span must come from THIS user turn, never assistant text.
    if (!normalize(latest).includes(normalize(update.quote))) { ignored.push(update.field); continue; }
    const confirming = lastQuestion?.field === update.field && lastQuestion.intent === 'confirm' &&
      confirmation && normalize(update.value ?? '') === normalize(lastQuestion.candidate ?? '');
    const isProfile = update.field in state.profile;
    const literalValue = update.value !== null && normalize(latest).includes(normalize(update.value));
    const reconstructed = !!spelling && update.field === spellingField && normalize(update.value ?? '') === normalize(spelling);
    const semanticCase = update.field === 'existingCase' && ['yes', 'no', 'pending'].includes(update.value ?? '');
    if (update.field === 'existingCase' && update.status === 'answered' &&
        !['yes', 'no', 'pending'].includes((update.value ?? '').trim().toLowerCase())) {
      ignored.push(update.field); continue;
    }
    // A recognizer/model guess must not replace an established name/location.
    if (isProfile && update.status === 'answered' && !literalValue && !confirming && !semanticCase && !update.uncertain) {
      ignored.push(update.field); continue;
    }
    if (update.field === 'legalName' && update.status === 'answered' &&
        lastQuestion?.field !== 'legalName' && !/\b(?:legal|full) name\b/i.test(latest)) {
      ignored.push(update.field); continue;
    }
    if ((update.uncertain || reconstructed) && !confirming) {
      if (fieldStatus(prior, update.field) === 'declined') { ignored.push(update.field); continue; }
      // Keep the existing answer and the uncertain candidate separate.
      nextMemory.pending[update.field] = { ...update, uncertain: true };
      // A newly reconstructed spelling is progress. Reserve one read-back turn
      // even after two failed repetitions; identical repeated spelling cannot
      // keep resetting the budget.
      if (reconstructed && memory.pending[update.field]?.value !== update.value) {
        nextMemory.clarificationAttempts[update.field] = Math.min(1, memory.clarificationAttempts[update.field] ?? 0);
      }
      if (fieldStatus(prior, update.field) === 'not_asked') setField(state, { ...update, status: 'unknown', value: null });
      continue;
    }
    if (old?.value && update.value !== old.value && update.status === 'answered' && !update.correction && !confirming) {
      // New narrative can expand a field, but changing a specific established
      // identity/date/place needs an explicit correction or confirmation.
      if (isProfile || ['currentCity', 'locations', 'approximateDates'].includes(update.field)) {
        nextMemory.pending[update.field] = { ...update, uncertain: true };
        ignored.push(update.field); continue;
      }
    }
    if (fieldStatus(prior, update.field) === 'declined' && update.status !== 'declined' &&
        !literalValue && !update.correction) { ignored.push(update.field); continue; }
    const previous = old?.value && old.value !== update.value ? [...old.previous, old.value].slice(-3) : old?.previous ?? [];
    if (old?.status === 'answered' && update.status === 'unknown' && !update.correction) {
      nextMemory.pending[update.field] = { ...update, uncertain: true };
      continue;
    }
    nextMemory.facts[update.field] = { ...update, uncertain: false, confirmed: update.status === 'answered' && (confirming || literalValue || old?.confirmed === true && old.value === update.value), previous };
    delete nextMemory.pending[update.field];
    setField(state, update);
    if (update.status !== 'unknown') nextMemory.clarificationAttempts[update.field] = 0;
    accepted.push(update.field);
  }

  // Do not turn "just [any phrase]" into a name. Use the preceding name question
  // or an already established preferred name as context.
  const nameContext = lastQuestion?.field === 'preferredName' || lastQuestion?.field === 'legalName' ||
    /\bname\b/i.test(messages.at(-2)?.content ?? '') ||
    !!prior.profile.preferredName.value && normalize(latest).includes(normalize(prior.profile.preferredName.value));
  let reply = turn.reply;
  if (nameContext) {
    const protectedTurn = enforceNameDisclosure({ reply, intake: state }, latest);
    const handled = protectedTurn.intake !== state;
    reply = protectedTurn.reply;
    Object.assign(state.profile, protectedTurn.intake.profile);
    if (handled) {
      for (const field of ['preferredName', 'legalName'] as const) {
        const answer = state.profile[field];
        if (answer.status === 'not_asked') continue;
        if (field === 'preferredName' && (!answer.value || !normalize(latest).includes(normalize(answer.value)))) continue;
        const old = memory.facts[field];
        const changed = !!old?.value && old.value !== answer.value;
        nextMemory.facts[field] = { field, status: answer.status, value: answer.value, quote: latest.slice(0, 600), uncertain: false,
          correction: changed, confirmed: field === 'preferredName' && answer.status === 'answered',
          previous: changed ? [...(old?.previous ?? []), old!.value!].slice(-3) : old?.previous ?? [] };
        delete nextMemory.pending[field];
        nextMemory.clarificationAttempts[field] = 0;
        accepted.push(field);
      }
    }
  }

  if (lastQuestion && lastQuestion.field !== 'review' && (memory.clarificationAttempts[lastQuestion.field] ?? 0) >= 2 &&
      !accepted.includes(lastQuestion.field) && !state.urgentSafetyConcern) {
    if (fieldStatus(state, lastQuestion.field) === 'not_asked') {
      setField(state, { field: lastQuestion.field, status: 'unknown', value: null });
    }
  }
  // Coverage follows collected facts, not a second model decision about flags.
  // These mappings establish topic coverage only; they add no facts/verification.
  const origin = state.profile.countryOfOrigin.status;
  const location = state.profile.currentCountry.status !== 'not_asked'
    ? state.profile.currentCountry.status : nextMemory.facts.currentCity?.status ?? 'not_asked';
  if (state.categories.identity_location === 'not_asked' && origin !== 'not_asked' && location !== 'not_asked') {
    state.categories.identity_location = origin === 'answered' && location === 'answered' ? 'answered' : 'unknown';
  }
  if (state.categories.available_evidence === 'not_asked' && state.details.evidenceOrWitnessDetails !== 'not_asked') {
    state.categories.available_evidence = state.details.evidenceOrWitnessDetails;
  }
  state.skipIntake ||= prior.skipIntake;
  state.finishRequested ||= prior.finishRequested;
  if (state.summaryStatus === 'confirmed' && prior.summaryStatus !== 'accepted') state.summaryStatus = prior.summaryStatus;
  if (state.summaryStatus === 'declined' && !state.finishRequested &&
      !['summary_offer', 'summary_review'].includes(prior.stage)) state.summaryStatus = prior.summaryStatus;
  if (prior.urgentSafetyConcern && !accepted.some(field => ['current_safety', 'currentProtectionConcerns'].includes(field))) {
    state.urgentSafetyConcern = true;
  }
  if (prior.summaryStatus === 'accepted' && ['not_offered', 'offered'].includes(state.summaryStatus)) {
    state.summaryStatus = 'accepted';
  }
  nextMemory.statementStarted ||= ['statement', 'summary_offer', 'summary_review', 'ended'].includes(prior.stage);
  let evaluated = evaluateIntake(state);
  if (nextMemory.statementStarted && evaluated.stage === 'intake') evaluated = { ...evaluated, stage: 'statement' };
  nextMemory.statementStarted ||= evaluated.stage === 'statement';
  let question = turn.question ?? null;
  // A reconstructed spelling must be read back, not silently accepted. Preserve
  // safety, pause, and completion precedence; the candidate remains pending there.
  if (spelling && spellingField && nextMemory.pending[spellingField] &&
      !evaluated.urgentSafetyConcern && !evaluated.pauseRequested && !evaluated.finishRequested &&
      (nextMemory.clarificationAttempts[spellingField] ?? 0) < 2) {
    reply = `${spelling}. Did I get that right?`;
    question = { field: spellingField, intent: 'confirm', candidate: spelling };
  }
  return { reply, intake: evaluated, memory: nextMemory, accepted, ignored, question,
    spellingDetected: !!spelling && !!spellingField };
}

export function questionBlocked(state: IntakeState, memory: InterviewMemory, question: InterviewQuestion | null): boolean {
  if (!question) return false;
  if (question.field === 'review') return !state.readyForSummary && state.stage !== 'summary_review';
  if (!state.urgentSafetyConcern && (state.readyForSummary || state.stage === 'summary_review') &&
      !memory.pending[question.field]) return true;
  if (fieldStatus(state, question.field) === 'declined' || memory.facts[question.field]?.status === 'declined') return true;
  const status = memory.pending[question.field] ? 'unknown'
    : memory.facts[question.field]?.status ?? fieldStatus(state, question.field);
  const safetyQuestion = ['current_safety', 'currentProtectionConcerns'].includes(question.field);
  if (state.urgentSafetyConcern && safetyQuestion) return false;
  if (status === 'declined') return true;
  if ((memory.clarificationAttempts[question.field] ?? 0) >= 2) return true;
  return status === 'answered' || status === 'unknown' && question.intent === 'ask';
}

export function rememberQuestion(memory: InterviewMemory, question: InterviewQuestion | null): InterviewMemory {
  const next = structuredClone(memory);
  next.lastQuestion = question;
  if (question && question.field !== 'review' && question.intent !== 'ask') {
    next.clarificationAttempts[question.field] = Math.min(2, (next.clarificationAttempts[question.field] ?? 0) + 1);
  }
  return next;
}

/** Hint only with user-confirmed names/places; never add a country-specific dictionary. */
export function vocabularyForSession(memory: InterviewMemory): string[] {
  return ['preferredName', 'countryOfOrigin', 'currentCountry', 'currentCity', 'locations']
    .flatMap(field => {
      const fact = memory.facts[field as MemoryField];
      return fact?.confirmed && !fact.uncertain && fact.value ? [fact.value] : [];
    });
}
