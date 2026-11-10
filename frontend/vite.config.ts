import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // API_PROXY_TARGET lets a second checkout (e.g. a git worktree) run against its own backend port.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: true } },
  },
});
