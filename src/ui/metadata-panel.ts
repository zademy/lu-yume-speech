/**
 * Metadata panel renderer.
 *
 * Displays enriched transcription details from verbose_json responses:
 * detected language, audio duration, segment timestamps, word timestamps,
 * and average confidence.
 *
 * SRP: This module's only job is rendering metadata into a panel.
 * DIP: It receives data (TranscriptionResult), not DOM elements from other modules.
 *
 * The panel is hidden when there is no metadata to show (plain JSON responses)
 * and revealed automatically when verbose_json returns segment/word data.
 */

import type { TranscriptionResult } from '../types';

/**
 * Update the metadata panel with transcription details.
 * Hides the panel when no metadata is available.
 */
export function renderMetadata(panel: HTMLDivElement, result: TranscriptionResult): void {
  const hasMetadata = result.language || result.duration || result.segments?.length;

  // Clear via DOM API (no innerHTML).
  panel.replaceChildren();

  if (!hasMetadata) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  // Summary row — premium chips
  const summary = document.createElement('div');
  summary.className = 'flex flex-wrap gap-1.5';

  if (result.language) {
    summary.appendChild(createChip('Idioma', result.language.toUpperCase(), 'primary'));
  }

  if (result.duration !== undefined) {
    summary.appendChild(createChip('Duración', `${result.duration.toFixed(1)}s`, 'muted'));
  }

  if (result.segments?.length) {
    summary.appendChild(createChip('Segmentos', String(result.segments.length), 'muted'));
    summary.appendChild(
      createChip('Confianza', computeAverageConfidence(result.segments), 'accent'),
    );
  }

  if (result.words?.length) {
    summary.appendChild(createChip('Palabras', String(result.words.length), 'muted'));
  }

  panel.appendChild(summary);

  // Segment details (collapsible)
  if (result.segments?.length) {
    panel.appendChild(buildSegmentDetails(result.segments));
  }
}

/**
 * Build a labeled chip element (label + value).
 */
function createChip(
  label: string,
  value: string,
  variant: 'primary' | 'muted' | 'accent',
): HTMLElement {
  const variants: Record<string, string> = {
    primary:
      'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-300)]',
    muted:
      'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]',
    accent:
      'bg-[var(--color-accent-100)] text-[var(--color-accent-700)] dark:bg-[var(--color-accent-900)] dark:text-[var(--color-accent-300)]',
  };

  const chip = document.createElement('span');
  chip.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium ${variants[variant]}`;

  const labelEl = document.createElement('span');
  labelEl.className = 'opacity-70';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'font-semibold';
  valueEl.textContent = value;

  chip.appendChild(labelEl);
  chip.appendChild(valueEl);
  return chip;
}

/**
 * Build the collapsible segment table via DOM APIs.
 */
function buildSegmentDetails(
  segments: NonNullable<TranscriptionResult['segments']>,
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'mt-3';

  const summary = document.createElement('summary');
  summary.className =
    'cursor-pointer text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--transition-fast)] select-none';
  summary.textContent = `Ver segmentos (${segments.length})`;

  const table = document.createElement('table');
  table.className = 'w-full mt-2 text-[11px] font-mono';

  const tbody = document.createElement('tbody');

  segments.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-[var(--color-border-subtle)] last:border-0';

    const idxTd = document.createElement('td');
    idxTd.className = 'py-1 pr-3 text-[var(--color-text-muted)] tabular-nums';
    idxTd.textContent = String(i + 1);

    const timeTd = document.createElement('td');
    timeTd.className =
      'py-1 pr-3 text-[var(--color-accent-600)] dark:text-[var(--color-accent-400)] whitespace-nowrap';
    timeTd.textContent = `${formatTimestamp(s.start)} → ${formatTimestamp(s.end)}`;

    const textTd = document.createElement('td');
    textTd.className = 'py-1 text-[var(--color-text-primary)] font-sans';
    // textContent is XSS-safe — no escaping needed.
    textTd.textContent = s.text;

    tr.appendChild(idxTd);
    tr.appendChild(timeTd);
    tr.appendChild(textTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  details.appendChild(summary);
  details.appendChild(table);
  return details;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Compute a human-readable confidence label from segment log probabilities.
 * Higher avg_logprob (closer to 0) = higher confidence.
 */
function computeAverageConfidence(segments: NonNullable<TranscriptionResult['segments']>): string {
  const avg = segments.reduce((sum, s) => sum + s.avg_logprob, 0) / segments.length;

  if (avg > -0.3) return 'Alta';
  if (avg > -0.6) return 'Media';
  return 'Baja';
}

/**
 * Format seconds into MM:SS or SS.s format.
 */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);

  if (mins > 0) {
    return `${mins}:${secs.padStart(4, '0')}`;
  }
  return `${secs}s`;
}
