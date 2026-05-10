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

  if (!hasMetadata) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  panel.classList.remove('hidden');

  const parts: string[] = [];

  if (result.language) {
    parts.push(`<span><strong>Idioma:</strong> ${result.language}</span>`);
  }

  if (result.duration !== undefined) {
    const formatted = result.duration.toFixed(1);
    parts.push(`<span><strong>Duración:</strong> ${formatted}s</span>`);
  }

  if (result.segments?.length) {
    parts.push(`<span><strong>Segmentos:</strong> ${result.segments.length}</span>`);
    const avgConfidence = computeAverageConfidence(result.segments);
    parts.push(`<span><strong>Confianza:</strong> ${avgConfidence}</span>`);
  }

  if (result.words?.length) {
    parts.push(`<span><strong>Palabras:</strong> ${result.words.length}</span>`);
  }

  // Summary row
  let html = `<div class="flex flex-wrap gap-3">${parts.join('')}</div>`;

  // Segment details (collapsible)
  if (result.segments?.length) {
    html += renderSegmentTable(result.segments);
  }

  panel.innerHTML = html;
}

/**
 * Render a compact segment table with timestamps.
 */
function renderSegmentTable(segments: TranscriptionResult['segments']): string {
  if (!segments) return '';

  const rows = segments
    .map((s, i) => {
      const start = formatTimestamp(s.start);
      const end = formatTimestamp(s.end);
      return `
      <tr class="border-b border-gray-200 last:border-0">
        <td class="py-1 pr-3 text-gray-400 font-mono">${i + 1}</td>
        <td class="py-1 pr-3 font-mono text-orange-600">${start} → ${end}</td>
        <td class="py-1">${escapeHtml(s.text)}</td>
      </tr>
    `;
    })
    .join('');

  return `
    <details class="mt-2">
      <summary class="cursor-pointer font-medium text-gray-600">Ver segmentos</summary>
      <table class="w-full mt-1 text-xs">
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
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

  if (avg > -0.3) return 'Alta ✅';
  if (avg > -0.6) return 'Media ⚠️';
  return 'Baja ❌';
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

/**
 * Escape HTML special characters to prevent injection.
 * Used because segment text comes from the API (external data).
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
