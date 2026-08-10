import { describe, it, expect, vi } from 'vitest';
import { createMetricsPanel } from '../../src/ui/metrics-panel';
import type { MetricsResult } from '../../src/metrics/metrics';

function dayKeyOffset(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function fixture(over: Partial<MetricsResult> = {}): MetricsResult {
  return {
    grabaciones: { total: 5, minutosAudio: 12.5 },
    tamaño: { usageBytes: 2048, quotaBytes: 1_048_576, pct: 0.19, audioBytes: 1024 },
    resumenes: 3,
    idioma: { origenTop: 'es', destinoTop: 'en', origenes: [{ lang: 'es', count: 5 }] },
    diasDeUso: 2,
    porDia: { [dayKeyOffset(0)]: 4, [dayKeyOffset(1)]: 1 },
    wpm: { promedio: 160, refHumanaMin: 150, refHumanaMax: 200 },
    palabras: { total: 1151 },
    modo: { transcribe: 3, translate: 2 },
    racha: { actual: 2, masLarga: 2 },
    ...over,
  };
}

describe('metrics-panel', () => {
  it('renders the headline numbers (WPM, total words, grabaciones) from a snapshot', () => {
    const panel = createMetricsPanel({ onExport: () => {}, onPurge: () => {} }, 'es');
    panel.update(fixture());

    const values = panel.root.querySelectorAll('.text-4xl.font-bold');
    // gaugeValue, wordsValue, recValue.
    expect(values.length).toBe(3);
    const texts = Array.from(values).map((v) => v.textContent ?? '');
    expect(texts).toContain('5'); // grabaciones total
    expect(texts).toContain('160'); // WPM rounded
  });

  it('sets the purge dialog warning from the snapshot and disables confirm when empty', () => {
    const panel = createMetricsPanel({ onExport: () => {}, onPurge: () => {} }, 'es');

    panel.update(fixture());
    const dialog = panel.root.querySelector('dialog')!;
    const text = dialog.querySelector('p')!.textContent ?? '';
    expect(text).toContain('5 grabaciones');
    expect(text).toContain('3 resúmenes');
    expect(text).toContain('Esta acción no se puede deshacer');
    const confirm = Array.from(panel.root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Borrar todo',
    )!;
    expect(confirm.disabled).toBe(false);

    panel.update(fixture({ grabaciones: { total: 0, minutosAudio: 0 }, resumenes: 0 }));
    expect(confirm.disabled).toBe(true);
  });

  it('tints the heatmap cell for an active day and leaves empty days muted', () => {
    const panel = createMetricsPanel({ onExport: () => {}, onPurge: () => {} }, 'es');
    panel.update(fixture());

    const cells = panel.root.querySelectorAll<HTMLElement>('.hm-cell');
    // 18 weeks × 7 weekdays.
    expect(cells.length).toBe(126);
    const todayKey = dayKeyOffset(0);
    const active = Array.from(cells).find((c) => c.title.startsWith(`${todayKey}:`))!;
    expect(active).toBeDefined();
    expect(active.style.background).toBe('rgb(13, 148, 136)'); // accent — high intensity
    // An empty day is muted.
    const empty = Array.from(cells).find((c) => c.title.endsWith(': 0'))!;
    expect(empty.style.background).toBe('var(--color-surface-muted)');
  });

  it('invokes onExport and onPurge from the action buttons', () => {
    const onExport = vi.fn();
    const onPurge = vi.fn().mockResolvedValue(undefined);
    const panel = createMetricsPanel({ onExport, onPurge }, 'es');
    panel.update(fixture());

    const buttons = panel.root.querySelectorAll<HTMLButtonElement>('button');
    const exportBtn = Array.from(buttons).find((b) => b.textContent === 'Exportar')!;
    const purgeBtn = Array.from(buttons).find((b) => b.textContent === 'Depurar')!;

    exportBtn.click();
    expect(onExport).toHaveBeenCalledTimes(1);

    // showDialog may be unavailable in jsdom → the else branch fires onPurge directly.
    purgeBtn.click();
    expect(onPurge).toHaveBeenCalledTimes(1);
  });
});
