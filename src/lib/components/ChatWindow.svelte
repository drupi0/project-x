<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import ChatMessageView from './ChatMessage.svelte';
  import ChatInput from './ChatInput.svelte';
  import VoiceCall from './VoiceCall.svelte';
  import { INTRODUCTION } from '#lib/interview/system-prompt.ts';
  import { INTAKE_CATEGORIES, INITIAL_INTAKE, PROFILE_FIELDS, STATEMENT_DETAILS, summarizeIntake, type IntakeState } from '#lib/interview/intake.ts';
  import { recentHistory, type ChatMessage } from '#lib/types/chat.ts';
  import { BrowserSpeechOutputProvider } from '#lib/speech-output/provider.ts';
  import { EMPTY_MEMORY, validateMemory, type InterviewMemory } from '#lib/interview/memory-types.ts';
  import { vocabularyForSession } from '#lib/interview/memory.ts';
  import type { Transcription } from '#lib/types/speech.ts';
  let { usesClaude = false }: { usesClaude?: boolean } = $props();

  let messages = $state<ChatMessage[]>([]);
  let intake = $state<IntakeState>(INITIAL_INTAKE);
  let memory = $state<InterviewMemory>(structuredClone(EMPTY_MEMORY));
  // Original recognizer output is retained separately from edited messages and
  // interpreted facts, for this page session only. Never log or persist it.
  let transcripts: Transcription[] = [];
  const vocabulary = $derived(vocabularyForSession(memory));
  let draft = $state('');
  let pending = $state(false);
  let error = $state('');
  let ended = $state(false);
  let forgotten = $state(false);
  let controller: AbortController | undefined;
  let generation = 0;
  let inputEpoch = $state(0);
  let bottom = $state<HTMLDivElement>();
  let voices = $state<SpeechSynthesisVoice[]>([]);
  let selectedVoiceURI = $state('');
  let audioBusy = $state(false);
  let audioError = $state('');
  let autoSpeak = $state(true);
  let callActive = $state(false);
  let wasCallActive = false;
  let speechGeneration = 0;
  const speechOutput = new BrowserSpeechOutputProvider();
  const interviewEnded = $derived(ended || intake.stage === 'ended');
  const reviewSummary = $derived(summarizeIntake(intake));
  const assistantReplies = $derived(messages.filter(message => message.role === 'assistant'));
  const confirmedReadback = $derived(intake.summaryStatus === 'confirmed' && assistantReplies.length > 1
    ? assistantReplies.at(-2)?.content : undefined);
  const intakeLabels: Record<(typeof PROFILE_FIELDS)[number], string> = {
    preferredName: 'Preferred name', legalName: 'Legal name (volunteered)',
    countryOfOrigin: 'Country of origin', currentCountry: 'Current country',
    existingCase: 'Existing or pending case', organizationOrRepresentative: 'Organization or representative',
    caseReference: 'Case reference', caseStatus: 'Case status', safeContactMethod: 'Safe contact method'
  };
  const detailLabels: Record<(typeof STATEMENT_DETAILS)[number], string> = {
    keyEvents: 'Key events', approximateDates: 'Approximate dates', locations: 'Locations',
    peopleInvolved: 'People or groups involved', harmOrThreats: 'Harm or threats',
    whyTargeted: 'Why the person believes they were targeted', fearOfReturn: 'Fear of return',
    evidenceOrWitnessDetails: 'Evidence or witnesses', currentProtectionConcerns: 'Current protection concerns'
  };
  const topicLabels: Record<(typeof INTAKE_CATEGORIES)[number], string> = {
    identity_location: 'Identity and location', reason_for_fleeing: 'Reason for leaving',
    current_safety: 'Current safety', available_evidence: 'Evidence', assistance_needed: 'Assistance needed'
  };

  function requestFinish() {
    if (pending || error || interviewEnded) return;
    draft = 'I would like to finish the interview now.';
    void send();
  }

  onMount(() => {
    const refresh = () => { voices = speechOutput.voices(); };
    refresh();
    window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', refresh);
  });

  function stopSpeech() {
    speechGeneration++;
    speechOutput.stop();
    audioBusy = false;
  }
  onDestroy(stopSpeech);

  $effect(() => {
    if (wasCallActive && !callActive) {
      stopSpeech();
      if (pending) { generation++; controller?.abort(); pending = false; }
    }
    wasCallActive = callActive;
  });

  async function speak(text: string): Promise<boolean> {
    stopSpeech(); audioError = ''; audioBusy = true;
    const current = ++speechGeneration;
    try {
      await speechOutput.speak(text, selectedVoiceURI);
      return true;
    } catch (cause) {
      if (current === speechGeneration) audioError = cause instanceof Error ? cause.message : 'Speech playback could not start.';
      return false;
    } finally {
      if (current === speechGeneration) audioBusy = false;
    }
  }

  $effect(() => {
    messages.length; pending; error;
    void tick().then(() => bottom?.scrollIntoView({ block: 'nearest' }));
  });

  function reset(end = false) {
    stopSpeech(); audioError = '';
    callActive = false;
    inputEpoch++;
    generation++;
    controller?.abort();
    messages = [];
    intake = INITIAL_INTAKE;
    memory = structuredClone(EMPTY_MEMORY);
    transcripts = [];
    draft = '';
    pending = false;
    error = '';
    forgotten = false;
    ended = end;
  }

  async function send(retry = false, voiceText?: string, voiceTurn = false, onSpeaking?: () => void): Promise<boolean> {
    if (pending || interviewEnded || (!retry && (!(voiceText ?? draft).trim() || error))) return false;
    if (!retry) {
      messages = [...messages, { role: 'user', content: (voiceText ?? draft).trim() }];
      if (!voiceText) draft = '';
    }
    const current = ++generation;
    const history = recentHistory(messages);
    forgotten ||= history.length < messages.length;
    pending = true;
    error = '';
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 310000);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, intake, memory }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The request failed. Please retry.');
      if (result.message?.role !== 'assistant' || typeof result.message.content !== 'string' ||
          !result.message.content.trim() || !result.intake?.categories ||
          typeof result.intake.readyForSummary !== 'boolean' || typeof result.intake.stage !== 'string') {
        throw new Error('The response could not be read. Please retry.');
      }
      if (current === generation) {
        const nextMemory = validateMemory(result.memory);
        messages = [...messages, result.message];
        intake = result.intake as IntakeState;
        memory = nextMemory;
        if (voiceTurn) {
          onSpeaking?.();
          // A local TTS failure must not hang up the voice conversation. The
          // call controller resumes listening after speech playback settles.
          await speak(result.message.content);
        } else if (autoSpeak) void speak(result.message.content);
        return true;
      }
      return false;
    } catch (cause) {
      if (current === generation) {
        error = cause instanceof Error && cause.name !== 'AbortError'
          ? cause.message : 'The request timed out. Please retry.';
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (current === generation) pending = false;
    }
  }

  async function respondToVoice(text: string, onSpeaking: () => void, transcription?: Transcription) {
    // The call controller's turn-taking stays paused until AI speech ends.
    // send() starts speech after the model reply arrives.
    if (transcription) transcripts.push(transcription);
    return send(false, text, true, onSpeaking);
  }

  async function retryVoice(onSpeaking: () => void) {
    return send(true, undefined, true, onSpeaking);
  }

  function editFailedMessage() {
    draft = messages.at(-1)?.content || '';
    messages = messages.slice(0, -1);
    error = '';
  }
</script>

<section class="chat" aria-label="Practice interview">
  <div class="toolbar">
    <div><span class="dot"></span><strong>Practice conversation</strong><span class="local">{usesClaude ? 'Claude · remote inference' : 'Ollama · local inference'}</span></div>
    <div class="actions">
      <button onclick={() => reset()}>Restart</button>
      <button onclick={requestFinish} disabled={pending || !!error || interviewEnded || callActive}>Finish interview</button>
      <button onclick={() => reset(true)} disabled={interviewEnded}>End &amp; clear</button>
    </div>
  </div>
  {#if interviewEnded}
    <div class="ended">
      <h2>Conversation ended</h2>
      <p>{ended ? 'Your conversation has been cleared from this page.' : 'This fictional practice conversation remains only in this page’s memory until you refresh, restart, or clear it.'}</p>
      {#if !ended}
      <section class="review-summary" aria-label="Structured interview summary">
        <h3>Structured practice summary</h3>
        <p class="summary-status">{reviewSummary.completeness === 'sufficient_for_initial_review' ? 'Enough detail for an initial human review' : 'Incomplete — some information is missing or was not discussed'}</p>
        {#if confirmedReadback}
          <h4>Factual read-back</h4>
          <p class="readback">{confirmedReadback}</p>
        {/if}
        <h4>Intake information</h4>
        <dl>
          {#each PROFILE_FIELDS as field}
            <div><dt>{intakeLabels[field]}</dt><dd>{intake.profile[field].status === 'answered' ? intake.profile[field].value : intake.profile[field].status.replace('_', ' ')}</dd></div>
          {/each}
        </dl>
        <h4>Personal statement topics</h4>
        <dl>
          {#each INTAKE_CATEGORIES as category}
            <div><dt>{topicLabels[category]}</dt><dd>{intake.categories[category].replace('_', ' ')}</dd></div>
          {/each}
        </dl>
        <h4>Details explored</h4>
        <dl>
          {#each STATEMENT_DETAILS as detail}
            <div><dt>{detailLabels[detail]}</dt><dd>{intake.details[detail].replace('_', ' ')}</dd></div>
          {/each}
        </dl>
        <p><strong>Unresolved:</strong> {reviewSummary.unresolved.length ? reviewSummary.unresolved.join(', ') : 'None recorded.'}</p>
        <p><strong>Declined:</strong> {reviewSummary.declined.length ? reviewSummary.declined.join(', ') : 'None recorded.'}</p>
        <p><strong>Unknown:</strong> {reviewSummary.unknown.length ? reviewSummary.unknown.join(', ') : 'None recorded.'}</p>
        <p>This is not a legal assessment, saved case, or submission.</p>
      </section>
      {/if}
      <button class="primary" onclick={() => reset()}>Start a new practice</button>
    </div>
  {:else}
    <div class="transcript" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
      <ChatMessageView message={{ role: 'assistant', content: INTRODUCTION }} />
      {#each messages as message}
        <ChatMessageView {message} onspeak={speak} />
      {/each}
      {#if pending}<p class="status" role="status"><span class="pulse">●</span> Thinking… The first reply may take a little longer.</p>{/if}
      <div bind:this={bottom}></div>
    </div>
    {#if messages.length}
      {#if intake.stage === 'intake'}
        {@const core = ['preferredName', 'countryOfOrigin', 'currentCountry', 'existingCase'] as const}
        {@const covered = core.filter(field => intake.profile[field].status !== 'not_asked').length}
        <p class="intake-progress" aria-live="polite">Optional intake: {covered} of 4 core details addressed. You may skip any of them.</p>
      {:else}
        {@const covered = INTAKE_CATEGORIES.filter(category => intake.categories[category] !== 'not_asked').length}
        <p class="intake-progress" aria-live="polite">Personal statement: {covered} of 5 topics explored. The summary also requires some meaningful event detail.</p>
      {/if}
    {/if}
    <div class="speech-controls">
      <label><input type="checkbox" bind:checked={autoSpeak} /> Speak AI replies automatically</label>
      {#if voices.length > 1}
        <label for="speech-voice">Local voice</label>
        <select id="speech-voice" bind:value={selectedVoiceURI}>
          <option value="">Automatic (match browser language)</option>
          {#each voices as voice (voice.voiceURI)}<option value={voice.voiceURI}>{voice.name} · {voice.lang}</option>{/each}
        </select>
      {/if}
      {#if audioBusy}<span role="status">Speaking… <button type="button" onclick={stopSpeech}>Stop</button></span>{/if}
      {#if audioError}<p role="status">{audioError}</p>{/if}
    </div>
    <VoiceCall bind:active={callActive} {vocabulary} disabled={pending || !!error || interviewEnded} ontranscript={respondToVoice} onwelcome={() => speak(messages.at(-1)?.role === 'assistant' ? messages.at(-1)!.content : INTRODUCTION)} oninterrupt={stopSpeech} onretry={retryVoice} />
    {#if forgotten}<p class="context-note">Recent messages and collected interview details are sent to the AI. Older wording may be outside its context.</p>{/if}
    {#if error}
      <div class="error" role="alert">
        <p>{error}</p>
        <button onclick={() => send(true)}>Retry message</button>
        <button onclick={editFailedMessage}>Edit message</button>
      </div>
    {/if}
    {#key inputEpoch}
      <ChatInput bind:value={draft} {vocabulary} onrawtranscript={value => transcripts.push(value)} disabled={pending || !!error || callActive || interviewEnded} onsend={() => send()} />
    {/key}
  {/if}
</section>
<p class="privacy-note">No account. No saved conversation. Refreshing, restarting, or ending clears this page’s history.</p>

<style>
  .chat { border: 1px solid #d6e1d9; background: #f8faf7; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px #244c3e08; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem 1.2rem; border-bottom: 1px solid #dce5df; background: white; }
  .toolbar strong { font-size: .85rem; }
  .dot { display: inline-block; width: 7px; height: 7px; background: #48755b; border-radius: 50%; margin-right: .55rem; }
  .local { display: block; margin: .25rem 0 0 1rem; font-size: .7rem; color: #64766b; }
  .actions { display: flex; gap: .3rem; }
  .actions button { font-size: .75rem; padding: .55rem .7rem; }
  .transcript { min-height: 240px; max-height: 52dvh; overflow-y: auto; padding: 1.5rem; }
  .status, .context-note { font-size: .8rem; color: #53675b; }
  .pulse { margin-right: .5rem; }
  .context-note { padding: 0 1.2rem; }
  .intake-progress { padding: 0 1.2rem; font-size: .76rem; color: #53675b; }
  .error { background: #fff1e8; padding: .8rem 1.2rem; color: #753817; border-top: 1px solid #eac8b2; }
  .error p { margin: 0 0 .6rem; }
  .error button { margin-right: .5rem; background: white; }
  .ended { text-align: center; padding: 4rem 1rem; }
  .review-summary { max-width: 42rem; margin: 1.5rem auto; padding: 1rem; text-align: left; border: 1px solid #d6e1d9; border-radius: 12px; background: white; }
  .review-summary h3, .review-summary h4 { margin: 1rem 0 .4rem; }
  .review-summary h3 { margin-top: 0; }
  .review-summary dl { margin: 0; }
  .review-summary dl div { display: grid; grid-template-columns: minmax(10rem, 1fr) 1fr; gap: .5rem; padding: .3rem 0; border-bottom: 1px solid #edf1ed; }
  .review-summary dt { font-weight: 600; }
  .review-summary dd { margin: 0; overflow-wrap: anywhere; }
  .review-summary p { font-size: .85rem; }
  .readback { white-space: pre-wrap; line-height: 1.55; }
  .summary-status { color: #53675b; }
  .speech-controls { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; padding: .75rem 1.2rem; border-top: 1px solid #dce5df; background: white; }
  .speech-controls label, .speech-controls span, .speech-controls p { font-size: .78rem; color: #53675b; }
  .speech-controls input { accent-color: #244c3e; }
  .speech-controls select { border: 1px solid #d6e1d9; border-radius: 6px; padding: .4rem; color: #244c3e; background: white; }
  .speech-controls p { flex-basis: 100%; margin: 0; }
  .primary { background: #244c3e; color: white; }
  .privacy-note { font-size: .75rem; color: #596b61; text-align: center; line-height: 1.6; }
  @media (max-width: 480px) { .toolbar { padding: .8rem; gap: .5rem; flex-wrap: wrap; } .transcript { padding: 1rem; } }
</style>
