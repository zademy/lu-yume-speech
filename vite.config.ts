/**
 * Vite build configuration.
 *
 * Tauri-aware SPA setup for the Speech-to-Text desktop client.
 * Uses Tailwind CSS v4 via the official Vite plugin.
 *
 * @see https://vitejs.dev/config/
 * @see https://tailwindcss.com/docs/installation/vite
 * @see https://tauri.app/start/frontend/vite/
 */

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss()],
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
