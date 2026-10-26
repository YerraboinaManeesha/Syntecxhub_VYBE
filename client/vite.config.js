import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks only to the Vite server. It forwards /api and /socket.io to the
// backend, so cookies are first-party and no CORS or SameSite configuration is needed locally.
const backend = process.env.VITE_DEV_BACKEND || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/socket.io': { target: backend, ws: true, changeOrigin: false },
    },
  },
});
