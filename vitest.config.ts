import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
        'src/audio/waveform-visualizer.ts',
      ],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
