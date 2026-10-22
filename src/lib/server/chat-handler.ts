import type { AIProvider } from './ai/provider';
import { AIError } from './ai/provider';
import { readChatRequestData, ValidationError } from './chat-validation';
import { enforceNameDisclosure, InterviewOutputError, parseInterviewTurn } from '../interview/intake';
import { promptForIntake } from '../interview/system-prompt';
import { isAllowedRequestOrigin } from './request-origin';

export async function handleChat(request: Request, getProvider: () => AIProvider, debug = false): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const requestId = crypto.randomUUID();
  const origin = request.headers.get('origin');
  if (origin && !isAllowedRequestOrigin(origin, request.url)) {
    return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
  }
  try {
    const { messages, intake } = await readChatRequestData(request);
    const provider = getProvider();
    const systemPrompt = promptForIntake(intake);
    let turn: ReturnType<typeof parseInterviewTurn>;
    const parseOutput = (content: string, attempt: 'original' | 'repair') => parseInterviewTurn(content, stage => {
      if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt, event: stage }));
    });
    try {
      const raw = await provider.chat({
        systemPrompt, messages, signal: request.signal, diagnostics: { requestId, attempt: 'original' }
      });
      turn = enforceNameDisclosure(parseOutput(raw.content, 'original'), messages.at(-1)!.content);
    } catch (error) {
      if (!(error instanceof InterviewOutputError)) throw error;
      if (debug) console.warn('[chat]', JSON.stringify({
        requestId, event: 'output_validation_failed', kind: error.kind, stage: error.stage,
        ...(error.field ? { field: error.field } : {}),
        ...(error.diagnostics ? { diagnostics: error.diagnostics } : {})
      }));
      if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt: 'repair', event: 'response_repair_started' }));
      let repaired: Awaited<ReturnType<AIProvider['chat']>>;
      try {
        repaired = await provider.chat({
          systemPrompt: `${systemPrompt}\n\nRESPONSE REPAIR\nYour previous generated output failed response validation. Do not mention this error. Reassess the same conversation and intake state, then return one valid JSON response. The spoken reply may contain at most one question. If several details need follow-up, keep the single highest-priority question; preserve urgent safety guidance. Rewrite naturally rather than deleting punctuation.`,
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
        turn = enforceNameDisclosure(parseOutput(repaired.content, 'repair'), messages.at(-1)!.content);
        if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt: 'repair', event: 'output_validation_succeeded' }));
        if (debug) console.info('[chat]', JSON.stringify({ requestId, attempt: 'repair', event: 'response_repair_succeeded' }));
      } catch (repairError) {
        if (!(repairError instanceof InterviewOutputError)) throw repairError;
        if (debug) console.warn('[chat]', JSON.stringify({
          requestId, attempt: 'repair', event: 'response_repair_failed',
          kind: repairError.kind, stage: repairError.stage,
          ...(repairError.field ? { field: repairError.field } : {}),
          ...(repairError.diagnostics ? { diagnostics: repairError.diagnostics } : {})
        }));
        throw new AIError('I couldn’t prepare a clear reply just now. Please retry or continue by text.', 502);
      }
    }
    return Response.json({
      message: { role: 'assistant', content: turn.reply },
      intake: turn.intake
    }, { headers });
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : error instanceof AIError ? error.status : 500;
    const message = error instanceof ValidationError || error instanceof AIError
      ? error.message : 'Something went wrong. Please try again.';
    // Deliberately never log errors or request data: provider errors can contain testimony.
    return Response.json({ error: message }, { status, headers });
  }
}
