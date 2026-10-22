import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({
    adapter: adapter(),
    // SvelteKit 3 uses a build-time public origin instead of runtime ORIGIN.
    paths: { origin: process.env.APP_ORIGIN || undefined }
  })]
});
