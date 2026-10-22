import { CLAUDE_TOKEN } from '$app/env/private';

export function load() {
  // Only disclose the selected mode, never the token or other server configuration.
  return { usesClaude: Boolean(CLAUDE_TOKEN.trim()) };
}
