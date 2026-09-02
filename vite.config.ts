import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const portalHost = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).hostname : undefined;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // The OAuth client registers http://127.0.0.1:5173/oauth/callback, so the
    // dev server must listen on IPv4 loopback (default "localhost" can bind
    // ::1 only, and the callback then dead-ends with connection refused).
    host: '127.0.0.1',
    allowedHosts: portalHost ? [portalHost] : [],
  },
});
