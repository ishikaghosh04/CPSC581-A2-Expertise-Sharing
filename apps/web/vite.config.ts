
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: [
      'suburban-fact-lucky-marie.trycloudflare.com',
    ],
    proxy: {
      // Development only: the dev-server proxies Socket.IO to the backend.
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  optimizeDeps: {
    // Shared workspace package ships TypeScript source; keep it out of pre-bundling.
    exclude: ['@expertise-sharing/shared'],
  },
  build: {
    target: 'es2022',
  },
});
