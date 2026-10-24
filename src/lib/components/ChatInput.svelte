<script lang="ts">
  import { MAX_MESSAGE_LENGTH } from '#lib/types/chat.ts';
  import VoiceInput from './VoiceInput.svelte';
  import type { Transcription } from '#lib/types/speech.ts';
  let voiceBusy = $state(false);
  let { value = $bindable(''), disabled, onsend, vocabulary = [], onrawtranscript }: {
    value: string; disabled: boolean; onsend: () => void;
    vocabulary?: string[]; onrawtranscript?: (value: Transcription) => void;
  } = $props();
</script>

<form onsubmit={(event) => { event.preventDefault(); if (!voiceBusy) onsend(); }}>
  <VoiceInput {disabled} {vocabulary} {onrawtranscript} onbusy={(busy) => voiceBusy = busy} ontranscript={(text) => {
    const combined = value.trim() ? `${value.trim()}\n${text}` : text;
    if (combined.length > MAX_MESSAGE_LENGTH) throw new Error('This transcript plus your draft is too long. Shorten the draft and record again.');
    value = combined;
  }} />
  <label for="message">Your message</label>
  <div class="composer">
    <textarea id="message" bind:value rows="3" maxlength={MAX_MESSAGE_LENGTH}
      disabled={disabled || voiceBusy} placeholder="Share a fictional experience, in your own words…"
      autocomplete="off" spellcheck="false" dir="auto"
      aria-describedby="input-hint"></textarea>
    <button type="submit" disabled={disabled || voiceBusy || !value.trim()}>Send <span aria-hidden="true">↑</span></button>
  </div>
  <div class="hints"><span id="input-hint">Take your time. You can skip any question.</span><span>{value.length} / {MAX_MESSAGE_LENGTH}</span></div>
</form>

<style>
  form { padding: 1.2rem; border-top: 1px solid #dce5df; background: white; }
  label { display: block; font-size: .8rem; font-weight: 650; margin-bottom: .6rem; }
  .composer { display: flex; gap: .7rem; align-items: flex-end; }
  textarea { width: 100%; min-width: 0; resize: vertical; max-height: 240px; border: 1px solid #c1cec5; border-radius: 10px; padding: .8rem; background: #fbfcfa; color: inherit; font: inherit; line-height: 1.5; }
  button { white-space: nowrap; background: #244c3e; color: white; }
  button span { margin-left: .4rem; }
  .hints { display: flex; gap: .7rem; justify-content: space-between; margin-top: .65rem; font-size: .7rem; color: #596b61; }
  @media (max-width: 480px) { form { padding: .9rem; } .hints { flex-wrap: wrap; } }
</style>
