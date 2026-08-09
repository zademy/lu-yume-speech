import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSummaryHistory, summaryToText } from '../../src/ui/summary-panel';
import type { SummaryHistory } from '../../src/types';

const history: SummaryHistory = {
  id: 'history-1',
  sourceText: 'Texto transcrito',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  summaries: [
    {
      id: 'summary-1',
      summary: 'Primer resumen.',
      keyPoints: ['Punto A'],
      model: 'openai/gpt-oss-20b',
      createdAt: 1_700_000_000_000,
    },
    {
      id: 'summary-2',
      summary: 'Segundo resumen.',
      keyPoints: ['Punto B', 'Punto C'],
      model: 'openai/gpt-oss-20b',
      createdAt: 1_700_000_001_000,
    },
  ],
};

describe('summary-panel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders newest summary first and expanded, with older generations collapsed', () => {
    const panel = document.createElement('div');

    renderSummaryHistory(panel, history, { onCopy: vi.fn(), onDelete: vi.fn() });

    const cards = panel.querySelectorAll('details');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector('summary')?.textContent).toContain('Resumen 2');
    expect(cards[0]?.hasAttribute('open')).toBe(true);
    expect(cards[1]?.querySelector('summary')?.textContent).toContain('Resumen 1');
    expect(cards[1]?.hasAttribute('open')).toBe(false);
    expect(panel.textContent).toContain('Segundo resumen.');
    expect(panel.textContent).toContain('Punto C');
  });

  it('routes copy and delete controls through supplied handlers', () => {
    const panel = document.createElement('div');
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    renderSummaryHistory(panel, history, { onCopy, onDelete });

    panel.querySelector<HTMLButtonElement>('[data-summary-action="copy"]')?.click();
    panel.querySelector<HTMLButtonElement>('[data-summary-action="delete"]')?.click();

    expect(onCopy).toHaveBeenCalledWith(history.summaries[1]);
    expect(onDelete).toHaveBeenCalledWith(history.id, 'summary-2');
  });

  it('hides the panel when there is no history for current visible text', () => {
    const panel = document.createElement('div');

    renderSummaryHistory(panel, undefined, { onCopy: vi.fn(), onDelete: vi.fn() });

    expect(panel.hidden).toBe(true);
    expect(panel.childElementCount).toBe(0);
  });

  it('formats copied summary as overview followed by key points', () => {
    expect(summaryToText(history.summaries[1]!)).toBe(
      'Segundo resumen.\n\nPuntos clave:\n- Punto B\n- Punto C',
    );
  });

  it('formats a summary without key points as overview only', () => {
    expect(summaryToText({ ...history.summaries[0]!, keyPoints: [] })).toBe('Primer resumen.');
  });
});
