<script lang="ts">
  import ChatWindow from '#lib/components/ChatWindow.svelte';
  import '../app.css';
  let { data } = $props();
</script>

<svelte:head>
  <title>Practice interview · Refugee AI Interview Assistant</title>
  <meta name="description" content="A local, fictional-story-only AI interview prototype." />
</svelte:head>

<main>
  <header>
    <div class="brand"><span class="brand-icon" aria-hidden="true">◌</span> REFUGEE AI INTERVIEW ASSISTANT</div>
    <span class="phase">VOICE CONVERSATION POC</span>
  </header>
  <section class="intro" aria-labelledby="title">
    <p class="eyebrow">A space to practice</p>
    <h1 id="title">Your words.<br />At your own pace.</h1>
    <p class="description">Explore how a conversation can help organize personal experiences. One question at a time, with room to pause or make corrections.</p>
  </section>
  <aside class="disclaimer" aria-label="Prototype disclaimer">
    <strong>Prototype only — use fictional stories.</strong>
    <p>Do not enter real refugee testimony or identifying information. This AI can make mistakes. It is not a lawyer or UNHCR representative, and its responses are not legal advice.</p>
    {#if data.usesClaude}
      <p>Claude is active. Your messages and recent conversation history are sent to Anthropic for processing.</p>
    {/if}
  </aside>
  <ChatWindow usesClaude={data.usesClaude} />
  <footer>Built for careful conversation <span aria-hidden="true">·</span> Text and voice input prototype</footer>
</main>
