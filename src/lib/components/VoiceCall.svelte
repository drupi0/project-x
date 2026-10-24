<script lang="ts">
  import { onDestroy } from 'svelte';
  import { recordingToWav } from '#lib/audio/wav.ts';
  import { MAX_AUDIO_SECONDS } from '#lib/types/speech.ts';
  import type { Transcription } from '#lib/types/speech.ts';
  import { vocabularyHeaders } from '#lib/speech-output/vocabulary.ts';

  let { active = $bindable(false), disabled = false, vocabulary = [], ontranscript, onwelcome, oninterrupt, onretry }: {
    active: boolean; disabled?: boolean; vocabulary?: string[]; ontranscript: (text: string, onSpeaking: () => void, transcription?: Transcription) => Promise<boolean>;
    onwelcome: () => Promise<boolean>; oninterrupt: () => void; onretry: (onSpeaking: () => void) => Promise<boolean>;
  } = $props();

  let phase = $state<'off' | 'permission' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'paused'>('off');
  let error = $state('');
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let recorder: MediaRecorder | undefined;
  let analyser: AnalyserNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let controller: AbortController | undefined;
  let meter: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let chunks: Blob[] = [];
  let speechStarted = 0;
  let silenceStarted = 0;
  // Whisper receives a completed audio segment, so use a forgiving pause fallback.
  // There is no semantic end-of-turn signal in the current batch transcription API.
  const END_OF_TURN_SILENCE_MS = 2200;

  function cleanup() {
    clearInterval(meter); meter = undefined;
    controller?.abort(); controller = undefined;
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder = undefined;
    }
    stream?.getTracks().forEach(track => track.stop()); stream = undefined;
    source?.disconnect(); source = undefined; analyser = undefined;
    if (context && context.state !== 'closed') void context.close();
    context = undefined;
    chunks = []; speechStarted = 0; silenceStarted = 0;
    phase = 'off';
  }

  function end() { generation++; active = false; cleanup(); }
  function finishTurn() {
    if (phase !== 'hearing' || recorder?.state !== 'recording') return;
    clearInterval(meter); meter = undefined;
    recorder.stop();
  }
  onDestroy(() => { generation++; cleanup(); });

  async function transcribeTurn(current: number, capture: MediaRecorder, turn: Blob[]) {
    if (current !== generation) return;
    phase = 'transcribing';
    const request = new AbortController(); controller = request;
    const deadline = setTimeout(() => request.abort(), 130000);
    try {
      const wav = await recordingToWav(new Blob(turn, { type: capture.mimeType }));
      if (current !== generation) return;
      const response = await fetch('/api/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', ...vocabularyHeaders(vocabulary) }, body: wav,
        signal: request.signal, cache: 'no-store'
      });
      const result = await response.json();
      if (current !== generation || !active) return;
      if (!response.ok) throw new Error(result.error || 'Transcription failed.');
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('I didn’t catch that. Please say it again.');
      phase = 'thinking';
      const replied = await ontranscript(result.text.trim(), () => { phase = 'speaking'; }, result);
      if (!replied) { if (current === generation && active) phase = 'paused'; return; }
      if (current === generation && active) beginListening(current);
    } catch (cause) {
      if (current === generation) {
        error = cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Voice turn timed out. Please try again.';
        end();
      }
    } finally {
      clearTimeout(deadline);
      if (controller === request) controller = undefined;
    }
  }

  function beginListening(current: number) {
    if (current !== generation || !stream || !context) return;
    error = ''; phase = 'listening'; chunks = []; speechStarted = 0; silenceStarted = 0;
    if (!analyser) return;
    const meterNode = analyser;
    const samples = new Uint8Array(analyser.fftSize);
    meter = setInterval(() => {
      if (current !== generation || !stream) return;
      meterNode.getByteTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) { const centered = (value - 128) / 128; energy += centered * centered; }
      const loudness = Math.sqrt(energy / samples.length);
      const now = Date.now();
      if (speechStarted && now - speechStarted >= MAX_AUDIO_SECONDS * 1000) {
        clearInterval(meter); meter = undefined;
        if (recorder?.state === 'recording') recorder.stop();
        return;
      }
      if (loudness >= 0.025) {
        if (!speechStarted) {
          speechStarted = now; chunks = []; phase = 'hearing';
          const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported(value));
          const capture = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
          recorder = capture;
          capture.ondataavailable = event => { if (current === generation && event.data.size) chunks.push(event.data); };
          capture.onerror = () => { if (current === generation) { error = 'Microphone recording failed.'; end(); } };
          capture.onstop = () => {
            if (current !== generation) return;
            recorder = undefined;
            const turn = chunks; chunks = [];
            if (turn.length) void transcribeTurn(current, capture, turn);
            else beginListening(current);
          };
          capture.start();
        }
        silenceStarted = 0;
      } else if (speechStarted) {
        if (!silenceStarted) silenceStarted = now;
        if (now - silenceStarted >= END_OF_TURN_SILENCE_MS && now - speechStarted >= 500) {
          clearInterval(meter); meter = undefined;
          if (recorder?.state === 'recording') recorder.stop();
        }
      }
    }, 100);
  }

  async function retryLastTurn() {
    if (!active || phase !== 'paused') return;
    phase = 'thinking';
    const replied = await onretry(() => { phase = 'speaking'; });
    if (replied && active) beginListening(generation);
    else if (active) phase = 'paused';
  }

  async function start() {
    if (active || disabled) return;
    error = ''; phase = 'permission'; active = true;
    const current = ++generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Voice calls require a supported browser on localhost or HTTPS.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true
      } });
      if (current !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      context = new AudioContext(); await context.resume();
      analyser = context.createAnalyser(); analyser.fftSize = 2048;
      source = context.createMediaStreamSource(stream); source.connect(analyser);
      if (current === generation && active) {
        phase = 'speaking';
        await onwelcome();
        if (current === generation && active) beginListening(current);
      }
    } catch (cause) {
      if (current === generation) { error = cause instanceof Error ? cause.message : 'Could not start the microphone.'; end(); }
    }
  }

  $effect(() => { if (!active && phase !== 'off') { generation++; cleanup(); } });
</script>

<section class="call" aria-label="Voice call controls">
  {#if !active}
    <button type="button" class="primary" {disabled} onclick={start}>Start voice call</button>
    <span>Speak naturally. After a pause of about two seconds, the AI may reply; you can also end your turn with the button.</span>
  {:else}
    <button type="button" class="hangup" onclick={end}>End call</button>
    {#if phase === 'speaking'}<button type="button" onclick={oninterrupt}>Interrupt AI and speak</button>{/if}
    {#if phase === 'hearing'}<button type="button" onclick={finishTurn}>I’m done speaking</button>{/if}
    {#if phase === 'paused'}<button type="button" onclick={retryLastTurn}>Retry last response</button>{/if}
    <span role="status">{phase === 'permission' ? 'Allow microphone access…' : phase === 'listening' ? 'Listening…' : phase === 'hearing' ? 'Hearing you…' : phase === 'transcribing' ? 'Transcribing…' : phase === 'thinking' ? 'Preparing a reply…' : phase === 'speaking' ? 'AI is speaking…' : phase === 'paused' ? 'The reply failed; your message is still here. Retry or end the call.' : 'Call ended'}</span>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .call { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; padding: .85rem 1.2rem; border-top: 1px solid #dce5df; background: #f3f7f3; }
  .call span, .call p { font-size: .78rem; color: #53675b; }
  .call p { flex-basis: 100%; margin: 0; }
  button { background: #244c3e; color: white; }
  .hangup { background: #873718; }
  .error { color: #873718 !important; }
  @media (max-width: 480px) { .call { padding: .85rem; } }
</style>
