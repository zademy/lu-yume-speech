/**
 * Monochrome palette contract for production source.
 * Prevents reintroducing chromatic literals or Tailwind color utilities.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_FILES = [
  '../../src/style.css',
  '../../src/main.ts',
  '../../src/ui/renderer.ts',
  '../../src/ui/sidebar.ts',
  '../../src/ui/history-card.ts',
  '../../src/ui/metadata-panel.ts',
  '../../src/ui/summary-panel.ts',
  '../../src/ui/toast.ts',
  '../../src/audio/waveform-visualizer.ts',
] as const;

const CHROMATIC_LITERALS = [
  '#f0fdfa',
  '#14b8a6',
  '#22c1c3',
  '#f97316',
  '#06b6d4',
  '#e11d48',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#f38ba8',
  '#dc2626',
] as const;

const CHROMATIC_UTILITY =
  /(?:bg|text|border|from|to|accent)-(?:red|emerald|amber|blue|teal|orange|purple)-\d+/;

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('monochrome source palette', () => {
  it.each(SOURCE_FILES)('%s has no forbidden chromatic colors', (relativePath) => {
    const source = readSource(relativePath).toLowerCase();

    for (const color of CHROMATIC_LITERALS) {
      expect(source, `${relativePath} contains ${color}`).not.toContain(color);
    }
    expect(source, `${relativePath} contains a chromatic Tailwind utility`).not.toMatch(
      CHROMATIC_UTILITY,
    );
  });

  it('defines the approved light and dark anchor values', () => {
    const css = readSource('../../src/style.css');

    expect(css).toContain('--color-canvas: #f6f8fa');
    expect(css).toContain('--color-surface: #ffffff');
    expect(css).toContain('--color-border: #d0d7de');
    expect(css).toContain('--color-text-muted: #59636e');
    expect(css).toContain('--color-text-primary: #1f2328');
    expect(css).toContain('--color-canvas: #0d1117');
    expect(css).toContain('--color-surface: #151b23');
    expect(css).toContain('--color-border: #3d444d');
    expect(css).toContain('--color-text-muted: #9198a1');
    expect(css).toContain('--color-text-primary: #f0f6fc');
  });
});
