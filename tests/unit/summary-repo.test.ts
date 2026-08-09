import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addSummary, getSummaryHistoryBySource, removeSummary } from '../../src/utils/summary-repo';
import type { GeneratedSummary } from '../../src/types';

const generatedSummary = (i: number): GeneratedSummary => ({
  id: `summary-${i}`,
  summary: `Resumen ${i}`,
  keyPoints: [`Punto ${i}`],
  model: 'openai/gpt-oss-20b',
  createdAt: 1_700_000_000_000 + i,
});

describe('summary-repo', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'history-id') });
  });

  it('creates one history for an exact transcription snapshot', () => {
    const history = addSummary('Texto transcrito', generatedSummary(1));

    expect(history).toMatchObject({
      id: 'history-id',
      sourceText: 'Texto transcrito',
      summaries: [generatedSummary(1)],
    });
    expect(getSummaryHistoryBySource('Texto transcrito')).toEqual(history);
  });

  it('appends repeated generations to the same transcription history', () => {
    addSummary('Texto transcrito', generatedSummary(1));
    const history = addSummary('Texto transcrito', generatedSummary(2));

    expect(history.summaries.map((summary) => summary.id)).toEqual(['summary-1', 'summary-2']);
  });

  it('starts another history after any source text edit', () => {
    addSummary('Texto transcrito', generatedSummary(1));
    addSummary('Texto transcrito editado', generatedSummary(2));

    expect(getSummaryHistoryBySource('Texto transcrito')?.summaries).toHaveLength(1);
    expect(getSummaryHistoryBySource('Texto transcrito editado')?.summaries).toHaveLength(1);
  });

  it('keeps only the ten newest summaries for one transcription', () => {
    for (let i = 1; i <= 11; i += 1) {
      addSummary('Texto transcrito', generatedSummary(i));
    }

    const summaries = getSummaryHistoryBySource('Texto transcrito')?.summaries ?? [];
    expect(summaries).toHaveLength(10);
    expect(summaries[0]?.id).toBe('summary-2');
    expect(summaries[9]?.id).toBe('summary-11');
  });

  it('removes one summary without affecting the others', () => {
    const history = addSummary('Texto transcrito', generatedSummary(1));
    addSummary('Texto transcrito', generatedSummary(2));

    const updated = removeSummary(history.id, 'summary-1');

    expect(updated?.summaries.map((summary) => summary.id)).toEqual(['summary-2']);
  });

  it('removes an empty history after deleting its final summary', () => {
    const history = addSummary('Texto transcrito', generatedSummary(1));

    expect(removeSummary(history.id, 'summary-1')).toBeUndefined();
    expect(getSummaryHistoryBySource('Texto transcrito')).toBeUndefined();
  });

  it('leaves storage unchanged when the history or summary does not exist', () => {
    expect(removeSummary('missing-history', 'summary-1')).toBeUndefined();

    const history = addSummary('Texto transcrito', generatedSummary(1));
    expect(removeSummary(history.id, 'missing-summary')).toEqual(history);
    expect(getSummaryHistoryBySource('Texto transcrito')).toEqual(history);
  });
});
