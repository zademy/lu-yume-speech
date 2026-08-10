/**
 * History statistics calculator.
 *
 * Derives local activity totals from the bounded transcription history.
 */

import type { HistoryEntry } from '../types';

export interface HistoryStats {
  transcriptions: number;
  words: number;
  audioSeconds: number;
}

/** Count entries, words, and known audio duration in the local history. */
export function calculateHistoryStats(entries: HistoryEntry[]): HistoryStats {
  return entries.reduce<HistoryStats>(
    (stats, entry) => {
      const text = entry.text.trim();
      stats.transcriptions += 1;
      stats.words += text ? text.split(/\s+/).length : 0;
      stats.audioSeconds += entry.duration ?? 0;
      return stats;
    },
    { transcriptions: 0, words: 0, audioSeconds: 0 },
  );
}
