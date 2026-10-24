<script lang="ts">
  import { onDestroy } from 'svelte';
  import { recordingToWav } from '#lib/audio/wav.ts';
  import { MAX_AUDIO_SECONDS } from '#lib/types/speech.ts';
  import type { Transcription } from '#lib/types/speech.ts';
  import { vocabularyHeaders } from '#lib/speech-output/vocabulary.ts';
  let { disabled, ontranscript, onbusy, vocabulary = [], onrawtranscript }: {
    disabled: boolean; ontranscript: (text: string) => void; onbusy: (busy: boolean) => void;
    vocabulary?: string[]; onrawtranscript?: (value: Transcription) => void;
  } = $props();
  let phase = $state<'idle' | 'permission' | 'recording' | 'transcribing'>('idle');
  let seconds = $state(0);
  let error = $state('');
  let note = $state('');
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  function release() {
    clearInterval(timer); clearTimeout(deadline);
    stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  }
  function cancel() {
    generation++; controller?.abort();
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      if (recorder.state === 'recording') recorder.stop();
      recorder = undefined;
    }
    release(); phase = 'idle'; onbusy(false);
  }
  onDestroy(cancel);
  $effect(() => { if (disabled) cancel(); });
  function stop() {
    if (recorder?.state === 'recording') { phase = 'transcribing'; recorder.stop(); release(); }
  }
  async function start() {
    if (phase !== 'idle' || disabled) return;
    error = ''; note = ''; seconds = 0;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      error = 'Recording is unavailable. Use a supported browser on localhost or HTTPS, or type your message.'; return;
    }
    const current = ++generation;
    phase = 'permission'; onbusy(true);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder = capture;
      const chunks: Blob[] = [];
      let size = 0;
      capture.ondataavailable = event => {
        if (current !== generation) return;
        size += event.data.size;
        if (size > 8 * 1024 * 1024) { cancel(); error = 'Recording is too large. Please try a shorter message.'; return; }
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => { if (current === generation) { cancel(); error = 'Recording failed. Please try again or type your message.'; } };
      capture.onstop = async () => {
        if (current !== generation) return;
        release(); phase = 'transcribing';
        const requestController = new AbortController(); controller = requestController;
        deadline = setTimeout(() => requestController.abort(), 130000);
        try {
          const wav = await recordingToWav(new Blob(chunks, { type: capture.mimeType }));
          chunks.length = 0;
          if (current !== generation) return;
          const response = await fetch('/api/transcribe', {
            method: 'POST', headers: { 'Content-Type': 'audio/wav', ...vocabularyHeaders(vocabulary) }, body: wav,
            signal: requestController.signal, cache: 'no-store'
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Transcription failed. Please try again.');
          if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('No words were recognized. Please record again.');
          if (current === generation) { onrawtranscript?.(result); ontranscript(result.text); note = 'Review and correct the transcript below, then press Send.'; }
        } catch (cause) {
          if (current === generation) error = cause instanceof Error && cause.name !== 'AbortError'
            ? cause.message : 'Transcription timed out. Please record a shorter message.';
        } finally {
          chunks.length = 0;
          if (current === generation) { clearTimeout(deadline); phase = 'idle'; onbusy(false); }
        }
      };
      capture.start(250); phase = 'recording';
      const started = Date.now();
      timer = setInterval(() => { seconds = Math.floor((Date.now() - started) / 1000); if (seconds >= MAX_AUDIO_SECONDS) stop(); }, 250);
    } catch (cause) {
      if (current === generation) {
        cancel();
        error = cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in your browser or type your message.'
          : 'Could not start the microphone. Check that a microphone is connected, or type your message.';
      }
    }
  }
</script>

<div class="voice">
  {#if phase === 'idle'}
    <button type="button" {disabled} onclick={start}>Record message</button>
    <span>Fictional recordings only · up to 60 seconds · local transcription</span>
  {:else}
    {#if phase === 'recording'}<button type="button" onclick={stop}>Stop &amp; transcribe</button>{/if}
    <button type="button" onclick={cancel}>Cancel recording</button>
    <span role="status">{phase === 'recording' ? `Recording: ${seconds}s / 60s` : phase === 'permission' ? 'Waiting for microphone permission…' : 'Transcribing…'}</span>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if note}<p role="status">{note}</p>{/if}
</div>

<style>
  .voice { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
  span, p { font-size: .75rem; color: #536457; line-height: 1.5; }
  p { width: 100%; margin: 0; }
  .error { color: #873718; }
</style>
