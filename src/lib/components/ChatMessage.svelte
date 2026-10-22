<script lang="ts">
  import type { ChatMessage } from '#lib/types/chat.ts';
  let { message, onspeak }: { message: ChatMessage; onspeak?: (text: string) => void } = $props();
</script>

<article class:user={message.role === 'user'}>
  <span class="speaker">{message.role === 'user' ? 'You' : 'AI interview assistant'}
    {#if message.role === 'assistant' && onspeak}<button type="button" onclick={() => onspeak?.(message.content)} aria-label="Speak this reply">▶ Speak</button>{/if}
  </span>
  <p dir="auto">{message.content}</p>
</article>

<style>
  article { max-width: 88%; margin: 0 0 1.4rem; }
  article.user { margin-left: auto; }
  .speaker { display: block; font-size: .75rem; font-weight: 650; margin: 0 .2rem .45rem; color: #536560; }
  .user .speaker { text-align: right; }
  .speaker button { margin-left: .55rem; border: 0; background: transparent; padding: .2rem .4rem; color: #244c3e; font-size: .72rem; }
  p { margin: 0; padding: 1rem 1.15rem; border: 1px solid #dce5df; border-radius: 4px 18px 18px; background: white; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .user p { background: #e4eee8; border-color: #d4e3d9; border-radius: 18px 4px 18px 18px; }
  @media (max-width: 480px) { article { max-width: 95%; } }
</style>
