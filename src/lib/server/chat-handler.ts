import type { AIProvider } from './ai/provider';
import { AIError } from './ai/provider';
import { readChatRequestData, ValidationError } from './chat-validation';
import { InterviewOutputError, parseInterviewTurn } from '../interview/intake';
import { EMPTY_MEMORY, MEMORY_FIELDS } from '../interview/memory-types';
import { questionBlocked, reconcileTurn, rememberQuestion } from '../interview/memory';
import { promptForIntake } from '../interview/system-prompt';
import { isAllowedRequestOrigin } from './request-origin';

const safeFieldParts = new Set<string>([...MEMORY_FIELDS, 'response', 'intake', 'reply', 'profile',
  'categories', 'details', 'status', 'value', 'updates', 'question', 'safeContactMethod',
  'urgentSafetyConcern', 'skipIntake', 'finishRequested', 'pauseRequested', 'summaryStatus',
  'stage', 'readyForSummary', 'informationAdequate', '$']);
function diagnosticField(field: string) {
  const [path, suffix] = field.split(':');
  return path.split('.').every(part => safeFieldParts.has(part)) &&
    (!suffix || ['missing', 'unexpected'].includes(suffix)) ? field : '[unexpected-field]';
}

export async function handleChat(request: Request, getProvider: () => AIProvider, debug = false): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const requestId = crypto.randomUUID();
  const origin = request.headers.get('origin');
  if (origin && !isAllowedRequestOrigin(origin, request.url)) {
    return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
  }
  try {
    const { messages, intake, memory = EMPTY_MEMORY } = await readChatRequestData(request);
    const provider = getProvider();
    const systemPrompt = promptForIntake(intake, memory);
    let turn: ReturnType<typeof reconcileTurn>;
    let retained: ReturnType<typeof reconcileTurn> | undefined;
    if (debug) console.info('[chat]', JSON.stringify({ requestId, event: 'context_prepared',
      messageCount: messages.length, memoryFieldCount: Object.keys(memory.facts).length,
      stage: intake.stage, freshState: messages.length === 1 && !Object.keys(memory.facts).length }));
    const parseOutput = (content: string, attempt: 'original' | 'repair') => {
      const parsed = parseInterviewTurn(content, stage => {
        if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt, event: stage }));
      });
      const result = reconcileTurn(retained?.intake ?? intake, retained?.memory ?? memory, parsed, messages);
      retained = result;
      const question = /[?؟？]/u.test(result.reply) ? parsed.question ?? null : null;
      if (questionBlocked(result.intake, result.memory, question)) {
        throw new InterviewOutputError('repeated_question', 'conversation', question?.field);
      }
      result.memory = rememberQuestion(result.memory, question);
      return result;
    };
    try {
      const raw = await provider.chat({
        systemPrompt, messages, signal: request.signal, diagnostics: { requestId, attempt: 'original' }
      });
      turn = parseOutput(raw.content, 'original');
    } catch (error) {
      if (!(error instanceof InterviewOutputError)) throw error;
      if (debug) console.warn('[chat]', JSON.stringify({
        requestId, event: 'output_validation_failed', kind: error.kind, stage: error.stage,
        ...(error.field ? { field: diagnosticField(error.field) } : {}),
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {})
      }));
      if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt: 'repair', event: 'response_repair_started' }));
      let repaired: Awaited<ReturnType<AIProvider['chat']>>;
      try {
        repaired = await provider.chat({
          systemPrompt: `${retained ? promptForIntake(retained.intake, retained.memory) : systemPrompt}\n\nRESPONSE REPAIR\nYour previous generated output failed response validation (${error.kind}${error.kind === 'repeated_question' ? `: do not ask again about ${error.field}` : ''}). Do not mention this error. Reassess the same conversation and intake state, then return one valid JSON response. The spoken reply may contain at most one question. If several details need follow-up, keep the single highest-priority question; preserve urgent safety guidance. Rewrite naturally rather than deleting punctuation.`,
          messages,
          signal: request.signal,
          diagnostics: { requestId, attempt: 'repair' }
        });
      } catch (repairError) {
        if (debug) console.warn('[chat]', JSON.stringify({
          requestId, event: 'response_repair_failed', stage: 'provider',
          kind: repairError instanceof AIError ? 'provider_error' : 'unexpected_error',
          ...(repairError instanceof AIError ? { status: repairError.status } : {})
        }));
        throw new AIError('I couldn’t prepare a clear reply just now. Please retry or continue by text.', 502);
      }
      try {
        turn = parseOutput(repaired.content, 'repair');
        if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt: 'repair', event: 'output_validation_succeeded' }));
        if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt: 'repair', event: 'response_repair_succeeded' }));
      } catch (repairError) {
        if (!(repairError instanceof InterviewOutputError)) throw repairError;
        if (debug) console.warn('[chat]', JSON.stringify({
          requestId, attempt: 'repair', event: 'response_repair_failed',
          kind: repairError.kind, stage: repairError.stage,
          ...(repairError.field ? { field: diagnosticField(repairError.field) } : {}),
          ...(repairError.diagnostics ? { diagnostics: repairError.diagnostics } : {})
        }));
        if (retained && (error.kind === 'repeated_question' || repairError.kind === 'repeated_question')) {
          // Preserve validated facts even if repairing a repetitive question fails.
          // This contains no invented facts and never ends or submits an interview.
          turn = { ...retained, memory: rememberQuestion(retained.memory, retained.intake.readyForSummary
              ? { field: 'review', intent: 'ask', candidate: null } : null),
            reply: retained.intake.urgentSafetyConcern
              ? 'If you are in immediate danger, seek trusted local human help if it is safe. You can pause here.'
              : retained.intake.readyForSummary ? 'Would you like a brief summary of what you shared?'
              : 'We can leave that point for now. You can continue whenever you’re ready.' };
        } else {
          throw new AIError('I couldn’t prepare a clear reply just now. Please retry or continue by text.', 502);
        }
      }
    }
    if (debug) console.info('[chat]', JSON.stringify({ requestId, event: 'state_transition',
      from: intake.stage, to: turn.intake.stage, updatedFields: turn.accepted,
      ignoredFields: turn.ignored, clarificationAttempts: turn.memory.clarificationAttempts }));
    return Response.json({
      message: { role: 'assistant', content: turn.reply },
      intake: turn.intake,
      memory: turn.memory
    }, { headers });
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : error instanceof AIError ? error.status : 500;
    const message = error instanceof ValidationError || error instanceof AIError
      ? error.message : 'Something went wrong. Please try again.';
    // Deliberately never log errors or request data: provider errors can contain testimony.
    return Response.json({ error: message }, { status, headers });
  }
}
