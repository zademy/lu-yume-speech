/**
 * Vite build configuration.
 *
 * Single-page application setup for the Speech-to-Text client.
 * Uses Tailwind CSS v4 via the official Vite plugin.
 *
 * @see https://vitejs.dev/config/
 * @see https://tailwindcss.com/docs/installation/vite
 */

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
});
