import { describe, expect, it } from 'vitest';

import { calculateHistoryStats } from '../../src/utils/history-stats';
import type { HistoryEntry } from '../../src/types';

const entries: HistoryEntry[] = [
  {
    id: 'one',
    text: 'Una transcripción con cinco palabras',
    language: 'es',
    model: 'whisper-large-v3-turbo',
    duration: 75,
    createdAt: 2,
    operationMode: 'transcribe',
  },
  {
    id: 'two',
    text: 'Dos palabras',
    model: 'whisper-large-v3',
    duration: 30,
    createdAt: 1,
    operationMode: 'translate',
  },
  {
    id: 'three',
    text: '   ',
    model: 'whisper-large-v3-turbo',
    createdAt: 0,
    operationMode: 'transcribe',
  },
];

describe('calculateHistoryStats', () => {
  it('summarizes the bounded transcription history', () => {
    expect(calculateHistoryStats(entries)).toEqual({
      transcriptions: 3,
      words: 7,
      audioSeconds: 105,
    });
  });

  it('returns zeroes for an empty history', () => {
    expect(calculateHistoryStats([])).toEqual({
      transcriptions: 0,
      words: 0,
      audioSeconds: 0,
    });
  });
});
