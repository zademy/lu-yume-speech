import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: true,
    setupFiles: ['./tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/types.ts',
        'src/**/*.d.ts',
        // Phase 2: UI renderers (DOM construction, integration tests needed)
        'src/ui/renderer.ts',
        'src/ui/sidebar.ts',
        'src/ui/history-card.ts',
        'src/ui/metadata-panel.ts',
        'src/ui/toast.ts',
        // Phase 2: Audio/Canvas (Web Audio API, MediaRecorder, canvas)
        'src/audio/audio-analyzer.ts',
        'src/audio/audio-processor.ts',
        'src/audio/waveform-visualizer.ts',
        // Phase 3: Pluma writer — third-party DOM (Milkdown/ProseMirror) needs a
        // real browser; verified by the production build + runtime, not jsdom.
        'src/escritos/editor.ts',
        // Local-model inference worker — imports Transformers.js / ORT wasm
        // and only runs inside a real Web Worker (T4+ verified at runtime by
        // the production build and browser smoke); the provider contract is
        // covered through its fake-worker tests.
        'src/local-models/inference-worker.ts',
      ],
      // Functions stays just under 90 because of inner callbacks in
      // integration code (IndexedDB transaction handlers, fetch/setTimeout
      // callbacks). Lines/statements/branches are the primary bar.
      thresholds: { lines: 90, functions: 85, statements: 90, branches: 80 },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
