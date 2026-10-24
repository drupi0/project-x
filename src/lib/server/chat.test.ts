import { describe, expect, it, vi } from 'vitest';
import { validateMessages, readChatRequest, validateChatRequest } from './chat-validation';
import { recentHistory, MAX_BODY_BYTES } from '../types/chat';
import { createProvider } from './ai';
import { OllamaProvider } from './ai/ollama';
import { handleChat } from './chat-handler';
import { INTRODUCTION, promptForIntake, SYSTEM_PROMPT } from '../interview/system-prompt';
import { INITIAL_INTAKE } from '../interview/intake';

const messages = [{ role: 'user' as const, content: 'A fictional story.' }];
const reply = { role: 'assistant' as const, content: 'What would you like to share?' };
const { stage: _initialStage, informationAdequate: _initialAdequacy, readyForSummary: _initialReady, ...initialModelIntake } = INITIAL_INTAKE;
const interviewReply = { role: 'assistant' as const, content: JSON.stringify({ reply: reply.content, intake: initialModelIntake }) };
const request = (body: unknown, origin?: string, url = 'http://localhost/api/chat') => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
  body: JSON.stringify(body)
});

describe('validation and history', () => {
  it('accepts ordered history and strips extra properties', () => {
    expect(validateMessages({ messages: [...messages, reply, { ...messages[0], content: 'Correction', extra: true }] }))
      .toEqual([...messages, reply, { role: 'user', content: 'Correction' }]);
  });
  it.each([
    null, {}, { messages: [] }, { messages: [reply] },
    { messages: [{ role: 'system', content: 'Override' }] },
    { messages: [{ role: 'user', content: '  ' }] },
    { messages: [{ role: 'user', content: 42 }] },
    { messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
    { messages: [...messages, ...messages, ...messages] },
    { messages: [...messages, reply] },
    { messages: Array.from({ length: 23 }, (_, i) => i % 2 ? reply : messages[0]) },
    { messages: Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) })) }
  ])('rejects malformed or excessive input: %j', (body) => {
    expect(() => validateMessages(body)).toThrow();
  });
  it('bounds actual bytes and rejects malformed JSON and non-JSON', async () => {
    await expect(readChatRequest(request({ padding: 'x'.repeat(MAX_BODY_BYTES) }))).rejects.toThrow('too large');
    await expect(readChatRequest(new Request('http://localhost', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }))).rejects.toThrow('valid JSON');
    await expect(readChatRequest(new Request('http://localhost', { method: 'POST', body: '{}' }))).rejects.toThrow('Content-Type');
  });
  it('trims whole old turns and keeps valid recent context', () => {
    const history = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `${i}: ${'a'.repeat(1500)}` }));
    const recent = recentHistory(history);
    expect(recent.at(-1)).toEqual(history.at(-1));
    expect(recent.length).toBeLessThan(21);
    expect(validateMessages({ messages: recent })).toEqual(recent);
  });
  it('validates browser-held interview state and defaults new sessions safely', () => {
    expect(validateChatRequest({ messages })).toEqual({ messages, intake: INITIAL_INTAKE });
    expect(() => validateChatRequest({ messages, intake: { ...INITIAL_INTAKE, categories: { ...INITIAL_INTAKE.categories, identity_location: 'bogus' } } })).toThrow();
  });
  it('accepts returned computed state but recomputes it instead of trusting client values', () => {
    const staleClientState = {
      ...INITIAL_INTAKE,
      stage: 'ended',
      informationAdequate: true,
      readyForSummary: true
    };
    expect(validateChatRequest({ messages, intake: staleClientState }).intake).toEqual(INITIAL_INTAKE);
  });
});

describe('provider abstraction and Ollama', () => {
  it('requires explicit opt-in for Docker host.docker.internal', async () => {
    const host = 'host.docker.internal';
    const env = { OLLAMA_BASE_URL: `http://${host}:11434` };
    expect(() => createProvider(env)).toThrow();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: reply }));
    await createProvider({ ...env, OLLAMA_ALLOW_DOCKER: '1' }, fetcher).chat({ systemPrompt: '', messages });
    expect(String(fetcher.mock.calls[0][0])).toBe(`http://${host}:11434/api/chat`);
  });
  it('rejects the removed Docker Ollama service name even when Docker hosts are enabled', () => {
    expect(() => createProvider({ OLLAMA_ALLOW_DOCKER: '1', OLLAMA_BASE_URL: 'http://ollama:11434' })).toThrow();
  });
  it.each(['http://remote.example', 'http://ollama.evil.test', 'http://ollama@evil.test', 'https://ollama', 'http://ollama/private'])('keeps rejecting untrusted URLs in Docker mode: %s', (url) => {
    expect(() => createProvider({ OLLAMA_ALLOW_DOCKER: '1', OLLAMA_BASE_URL: url })).toThrow();
  });
  it.each([
    '<think>Private deliberation</think>\nHello! What would you like to share?',
    'Private deliberation without an opening tag</think>\nHello! What would you like to share?',
    '<think>First block</think><think>Second block</think>Hello! What would you like to share?',
    '<THINK>Private deliberation</THINK>\nHello! What would you like to share?',
    `${'Private deliberation '.repeat(400)}</think>Hello! What would you like to share?`
  ])('returns only the final reply, including template-opened thinking', async (content) => {
    const provider = createProvider({}, vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      message: { role: 'assistant', content, thinking: 'Separate private thoughts' },
      done: true, done_reason: 'stop'
    })));
    expect(await provider.chat({ systemPrompt: '', messages })).toEqual({
      role: 'assistant', content: 'Hello! What would you like to share?'
    });
  });
  it.each([
    { content: '<think>Unfinished thoughts', done: true, done_reason: 'stop' },
    { content: 'Private thoughts</think>', done: true, done_reason: 'stop' },
    { content: 'Unmarked unfinished thoughts', done: true, done_reason: 'length' },
    { content: 'Partial reply', done: false, done_reason: 'stop' },
    { content: '<think>First</think><think>Unfinished', done: true, done_reason: 'stop' }
  ])('rejects unfinished thinking instead of displaying it', async ({ content, ...metadata }) => {
    const provider = createProvider({}, vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      message: { role: 'assistant', content }, ...metadata
    })));
    const response = await handleChat(request({ messages }), () => provider);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The model did not finish a usable reply. Please retry.' });
  });
  it('logs only selected metadata when debugging, never content or upstream error text', async () => {
    const logger = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
        message: { ...reply, content: 'PRIVATE_REPLY', thinking: 'PRIVATE_THINKING' },
        done: true, done_reason: 'stop', eval_count: 12, prompt_eval_count: 42
      }));
      await createProvider({ AI_DEBUG: '1' }, fetcher).chat({
        systemPrompt: 'PRIVATE_PROMPT', messages: [{ role: 'user', content: 'PRIVATE_STORY' }]
      });
      const output = JSON.stringify(logger.mock.calls);
      expect(output).toContain('response_received');
      expect(output).toContain('generatedTokens');
      expect(output).not.toContain('PRIVATE_');
      logger.mockClear();
      await createProvider({}, fetcher).chat({ systemPrompt: '', messages });
      expect(logger).not.toHaveBeenCalled();
      await expect(createProvider({ AI_DEBUG: '1' }, vi.fn<typeof fetch>()
        .mockRejectedValue(new Error('PRIVATE_ERROR'))).chat({ systemPrompt: '', messages })).rejects.toThrow();
      expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_ERROR');
      expect(JSON.stringify(logger.mock.calls)).toContain('request_failed');
    } finally {
      logger.mockRestore();
    }
  });
  it('forwards system prompt, context, configured model and server options', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: reply }));
    const provider = createProvider({ OLLAMA_MODEL: 'qwen3:8b' }, fetcher);
    expect(await provider.chat({ systemPrompt: SYSTEM_PROMPT, messages })).toEqual(reply);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: 'qwen3:8b', stream: false, think: false,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]
    });
    expect(init?.redirect).toBe('error');
  });
  it('leaves question-count validation to the parsed user-facing reply', async () => {
    const content = JSON.stringify({ reply: 'When did this happen?', metadata: 'Who? Where?', intake: initialModelIntake });
    const provider = createProvider({}, vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      message: { role: 'assistant', content }, done: true, done_reason: 'stop'
    })));
    expect((await provider.chat({ systemPrompt: '', messages })).content).toBe(content);
  });
  it('accepts metadata question marks but enforces one spoken question', async () => {
    const content = JSON.stringify({ reply: 'Approximately when did this happen?', intake: initialModelIntake });
    const chat = vi.fn().mockResolvedValue({ role: 'assistant', content });
    const response = await handleChat(request({ messages }), () => ({ chat }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: { content: 'Approximately when did this happen?' } });
  });

  it('repairs a spoken reply with multiple questions and preserves the conversation', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ reply: 'When did it happen? Where? What followed?', intake: initialModelIntake }) })
      .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ reply: 'Approximately when did this happen?', intake: initialModelIntake }) });
    const response = await handleChat(request({ messages }), () => ({ chat }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: { content: 'Approximately when did this happen?' } });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].messages).toEqual(messages);
    expect(chat.mock.calls[1][0].systemPrompt).toContain('RESPONSE REPAIR');
  });

  it('corrects a preferred-only name response in the actual chat path', async () => {
    const { stage: _stage, informationAdequate: _adequate, readyForSummary: _ready, ...initialState } = INITIAL_INTAKE;
    const modelOutput = JSON.stringify({
      reply: 'I have recorded Amina as your legal name.',
      intake: {
        ...initialState,
        profile: {
          ...initialState.profile,
          preferredName: { status: 'answered', value: 'Amina' },
          legalName: { status: 'answered', value: 'Amina' }
        }
      }
    });
    const chat = vi.fn().mockResolvedValue({ role: 'assistant', content: modelOutput });
    const response = await handleChat(request({
      messages: [
        { role: 'user', content: 'This is a fictional test.' },
        { role: 'assistant', content: 'Would you like to provide a legal name?' },
        { role: 'user', content: 'Just Amina.' }
      ]
    }), () => ({ chat }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: { content: 'Of course, I’ll use Amina.' },
      intake: { profile: {
        preferredName: { status: 'answered', value: 'Amina' },
        legalName: { status: 'declined', value: null }
      } }
    });
  });

  it('repairs malformed output once and returns only a safe error if repair also fails', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ role: 'assistant', content: '{not json' })
      .mockResolvedValueOnce({ role: 'assistant', content: '{still not json' });
    const response = await handleChat(request({ messages }), () => ({ chat }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'I couldn’t prepare a clear reply just now. Please retry or continue by text.' });
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('logs safe validation and repair failure metadata only when debug is enabled', async () => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const chat = vi.fn()
        .mockResolvedValueOnce({ role: 'assistant', content: '{PRIVATE_STORY' })
        .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify({ reply: 'Who? When?', intake: initialModelIntake }) });
      const response = await handleChat(request({ messages: [{ role: 'user', content: 'PRIVATE_TESTIMONY' }] }), () => ({ chat }), true);
      expect(response.status).toBe(502);
      const logs = JSON.stringify(logger.mock.calls);
      expect(logs).toContain('output_validation_failed');
      expect(logs).toContain('response_repair_failed');
      expect(logs).toContain('multiple_questions');
      expect(logs).not.toContain('PRIVATE_');
    } finally {
      logger.mockRestore();
    }
  });
  it('records validation stage, schema field, and successful repair without response text', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infos = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const bad = JSON.stringify({
        reply: 'I have noted that.',
        intake: { ...initialModelIntake, categories: { ...initialModelIntake.categories, available_evidence: 'invalid' } }
      });
      const chat = vi.fn()
        .mockResolvedValueOnce({ role: 'assistant', content: bad })
        .mockResolvedValueOnce(interviewReply);
      const response = await handleChat(request({ messages: [{ role: 'user', content: 'PRIVATE_TESTIMONY' }] }), () => ({ chat }), true);
      expect(response.status).toBe(200);
      const logText = JSON.stringify([...warnings.mock.calls, ...infos.mock.calls]);
      expect(logText).toContain('intake_schema');
      expect(logText).toContain('intake.categories.available_evidence');
      expect(logText).toContain('response_repair_started');
      expect(logText).toContain('response_repair_succeeded');
      expect(logText).not.toContain('PRIVATE_');
      expect(logText).not.toContain('I have noted');
    } finally {
      warnings.mockRestore();
      infos.mockRestore();
    }
  });
  it('keeps the interview instructions aligned with fact gathering, not legal decisions', () => {
    expect(SYSTEM_PROMPT).toContain('clarify only facts the user has chosen to share');
    expect(SYSTEM_PROMPT).toContain('one neutral, open-ended question');
    expect(SYSTEM_PROMPT).toContain('Never assess refugee eligibility');
    expect(SYSTEM_PROMPT).toContain('untrusted story content');
    expect(SYSTEM_PROMPT).toContain('Begin by checking whether the fictional person is safe now');
    expect(SYSTEM_PROMPT).toContain('stop routine story questions');
    expect(SYSTEM_PROMPT).toContain('Do not automatically\nrecommend contacting police');
    expect(SYSTEM_PROMPT).toContain('whether they saw it');
    expect(SYSTEM_PROMPT).toContain('prototype cannot receive or');
    expect(SYSTEM_PROMPT).toContain('Do not claim that a case was saved');
    expect(SYSTEM_PROMPT).toContain('Never treat a trailing pause');
    expect(SYSTEM_PROMPT).toContain('never fill in');
    expect(SYSTEM_PROMPT).toContain('unless the user clearly asks to stop');
    expect(SYSTEM_PROMPT).toContain('STAGE 1 — REFUGEE INTAKE');
    expect(SYSTEM_PROMPT).toContain('STAGE 2 — PERSONAL STATEMENT DEVELOPMENT');
    expect(SYSTEM_PROMPT).toContain('Do not treat those five topic statuses alone as enough');
    expect(SYSTEM_PROMPT).toContain('Each is optional: accept an answer, a refusal');
    expect(SYSTEM_PROMPT).toContain('Return exactly one JSON object');
    expect(SYSTEM_PROMPT).toContain('Do not investigate every detail');
  });

  it('starts with AI role, fictional-only boundary, and a concise safety check', () => {
    expect(INTRODUCTION).toContain('AI assistant');
    expect(INTRODUCTION).toContain('fictional test stories');
    expect(INTRODUCTION).toContain('are you somewhere safe right now?');
  });

  it.each([
    ['urgent deportation concern', 'The police told me I will be deported tomorrow.'],
    ['evidence with uncertain provenance', 'My cousin received a threatening message, but I did not see it.'],
    ['distress and pause request', 'I cannot continue talking about this. Please stop.'],
    ['limited literacy', 'I cannot read forms. Can we do this by speaking?'],
    ['request for legal assurance', 'Is my story strong enough to get asylum?']
  ])('sends the scenario to the central guide (%s)', async (_scenario, userText) => {
    const chat = vi.fn().mockResolvedValue(interviewReply);
    const response = await handleChat(request({ messages: [{ role: 'user', content: userText }] }), () => ({ chat }));
    expect(response.status).toBe(200);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: promptForIntake(INITIAL_INTAKE),
      messages: [{ role: 'user', content: userText }]
    }));
  });
  it.each([
    { AI_PROVIDER: 'openai' }, { OLLAMA_BASE_URL: 'https://example.com' },
    { OLLAMA_BASE_URL: 'bad-url' }, { OLLAMA_BASE_URL: 'http://localhost@evil.test' },
    { OLLAMA_MODEL: 'qwen3:cloud' }, { AI_TIMEOUT_MS: 'NaN' }
  ])('rejects unsafe configuration: %j', (env) => {
    expect(() => createProvider(env)).toThrow();
  });
  it.each([404, 500])('handles upstream HTTP %i', async (status) => {
    const provider = createProvider({}, vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream details', { status })));
    await expect(provider.chat({ systemPrompt: '', messages })).rejects.toThrow(/model/);
  });
  it.each([{}, { message: { role: 'assistant', content: '' } }, { message: { role: 'user', content: 'oops' } }])('rejects invalid output', async (body) => {
    const provider = createProvider({}, vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    await expect(provider.chat({ systemPrompt: '', messages })).rejects.toThrow('invalid response');
  });
  it('sanitizes network errors', async () => {
    const provider = createProvider({}, vi.fn<typeof fetch>().mockRejectedValue(new Error('SECRET address and story')));
    await expect(provider.chat({ systemPrompt: '', messages })).rejects.toThrow('Cannot reach the local model');
  });
  it('times out an unresponsive fetch', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const provider = new OllamaProvider({ baseUrl: 'http://localhost', model: 'test', timeoutMs: 10 }, fetcher);
    await expect(provider.chat({ systemPrompt: '', messages })).rejects.toThrow('took too long');
  });
});

describe('chat HTTP handler', () => {
  it('accepts the server-returned interview state on the next turn', async () => {
    const chat = vi.fn().mockResolvedValue(interviewReply);
    const first = await handleChat(request({ messages }), () => ({ chat }));
    const firstResult = await first.json();
    const nextMessages = [...messages, firstResult.message, { role: 'user', content: 'I am in Cairo.' }];
    const second = await handleChat(request({ messages: nextMessages, intake: firstResult.intake }), () => ({ chat }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ message: reply, intake: INITIAL_INTAKE });
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('works with an alternate provider, preserves context and adds the central prompt', async () => {
    const chat = vi.fn().mockResolvedValue(interviewReply);
    const history = [...messages, reply, { role: 'user', content: 'I want to correct that.' }];
    const response = await handleChat(request({ messages: history }), () => ({ chat }));
    expect(await response.json()).toMatchObject({ message: reply, intake: INITIAL_INTAKE });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: promptForIntake(INITIAL_INTAKE), messages: history }));
  });
  it('validates before initializing the provider', async () => {
    const factory = vi.fn();
    expect((await handleChat(request({ messages: [] }), factory)).status).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });
  it('requires meaningful narrative depth in addition to all five model-extracted topics', async () => {
    const categories = Object.fromEntries([
      'identity_location', 'reason_for_fleeing', 'current_safety', 'available_evidence', 'assistance_needed'
    ].map(category => [category, 'answered']));
    const profile = { ...INITIAL_INTAKE.profile };
    for (const [field, value] of [['preferredName', 'Sam'], ['countryOfOrigin', 'Sudan'], ['currentCountry', 'Egypt'], ['existingCase', 'no']] as const) {
      profile[field] = { status: 'answered', value };
    }
    const intake = {
      ...initialModelIntake, profile, categories,
      details: { ...initialModelIntake.details, keyEvents: 'answered' }, summaryStatus: 'offered'
    };
    const chat = vi.fn().mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify({ reply: 'Would you like a brief summary?', intake })
    });
    const response = await handleChat(request({ messages }), () => ({ chat }));
    expect(await response.json()).toMatchObject({
      message: { content: 'Would you like a brief summary?' },
      intake: { readyForSummary: false, informationAdequate: false, stage: 'statement' }
    });
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: promptForIntake(INITIAL_INTAKE)
    }));
  });
  it('offers review after the meaningful detail threshold is met', async () => {
    const profile = { ...INITIAL_INTAKE.profile };
    for (const [field, value] of [['preferredName', 'Sam'], ['countryOfOrigin', 'Sudan'], ['currentCountry', 'Egypt'], ['existingCase', 'no']] as const) {
      profile[field] = { status: 'answered', value };
    }
    const intake = {
      ...initialModelIntake,
      profile,
      categories: Object.fromEntries(['identity_location', 'reason_for_fleeing', 'current_safety', 'available_evidence', 'assistance_needed'].map(field => [field, 'answered'])),
      details: { ...initialModelIntake.details, keyEvents: 'answered', approximateDates: 'answered', locations: 'answered' }
    };
    const chat = vi.fn().mockResolvedValue({ role: 'assistant', content: JSON.stringify({ reply: 'Would you like a concise recap?', intake }) });
    const response = await handleChat(request({ messages }), () => ({ chat }));
    expect(await response.json()).toMatchObject({ intake: { stage: 'summary_offer', informationAdequate: true, readyForSummary: true } });
  });
  it('rejects foreign origins', async () => {
    expect((await handleChat(request({ messages }, 'https://foreign.test'), vi.fn())).status).toBe(403);
  });
  it('accepts localhost and 127.0.0.1 as equivalent local app origins', async () => {
    const chat = vi.fn().mockResolvedValue(interviewReply);
    const response = await handleChat(request({ messages }, 'http://localhost:3000', 'http://127.0.0.1:3000/api/chat'), () => ({ chat }));
    expect(response.status).toBe(200);
  });
  it('does not leak unexpected errors', async () => {
    const response = await handleChat(request({ messages }), () => ({ chat: async () => { throw new Error('sensitive data'); } }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive');
  });
});
