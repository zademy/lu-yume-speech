/**
 * Vite build configuration.
 *
 * SPA setup for the Speech-to-Text web client.
 * Uses Tailwind CSS v4 via the official Vite plugin.
 *
 * @see https://vitejs.dev/config/
 * @see https://tailwindcss.com/docs/installation/vite
 */

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  clearScreen: false,
  // Vue feature flags required by Milkdown Crepe (which bundles Vue for some
  // internal components). Without these, Vue emits dev warnings and runs with
  // the esm-bundler build in an undefined state.
  define: {
    __VUE_OPTIONS_API__: JSON.stringify(true),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
