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
    idioma: { origenTop: 'es', destinoTop: 'en' },
    diasDeUso: 2,
    porDia: { [dayKeyOffset(0)]: 4, [dayKeyOffset(1)]: 1 },
    wpm: { promedio: 160, refHumanaMin: 150, refHumanaMax: 200 },
    ...over,
  };
}

describe('metrics-panel', () => {
  it('renders the action buttons and refreshes card values from a snapshot', () => {
    const panel = createMetricsPanel({ onExport: () => {}, onPurge: () => {} }, 'es');
    panel.update(fixture());

    const values = panel.root.querySelectorAll('.text-xl.font-semibold');
    expect(values.length).toBe(7);
    // First card = Grabaciones total.
    expect(values[0]!.textContent).toBe('5');
    // Idioma card shows origen → destino.
    const idioma = Array.from(values).find((v) => v.textContent === 'es → en');
    expect(idioma).toBeDefined();
    // WPM rounded.
    const wpm = Array.from(values).find((v) => v.textContent === '160');
    expect(wpm).toBeDefined();
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

  it('tints the heatmap cells that have activity', () => {
    const panel = createMetricsPanel({ onExport: () => {}, onPurge: () => {} }, 'es');
    panel.update(fixture());

    const cells = panel.root.querySelectorAll<HTMLElement>('.w-3.h-3');
    expect(cells.length).toBe(30);
    // Last cell = today (count 4, the max) → fully opaque.
    const todayCell = cells[29]!;
    expect(Number(todayCell.style.opacity)).toBeGreaterThan(0.9);
    // A cell far in the past (count 0) → low opacity.
    const emptyCell = cells[0]!;
    expect(Number(emptyCell.style.opacity)).toBeLessThan(0.5);
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
