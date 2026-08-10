/**
 * Métricas panel — a dedicated Inicio section that renders derived indicators.
 *
 * Pure DOM: receives a `MetricsResult` snapshot via `update()` and renders metric
 * cards plus a 30-day activity heatmap. Owns the Exportar and Depurar affordances;
 * the actual data work is delegated to callbacks from the composition root.
 *
 * SRP: this module only renders the Métricas UI and forwards user actions.
 */

import { formatBytes } from '../metrics/metrics';
import type { MetricsResult } from '../metrics/metrics';

export interface MetricsPanelHandlers {
  onExport: () => void;
  onPurge: () => Promise<void> | void;
}

export interface MetricsPanel {
  readonly root: HTMLElement;
  update: (result: MetricsResult) => void;
}

const CARD_BASE =
  'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 flex flex-col gap-1';

/**
 * Build the Métricas panel. The returned `update(result)` refreshes every value
 * and the heatmap intensities from a freshly computed snapshot.
 */
export function createMetricsPanel(handlers: MetricsPanelHandlers): MetricsPanel {
  const root = document.createElement('section');
  root.className = 'metrics-panel flex flex-col gap-3';
  root.setAttribute('aria-label', 'Métricas');

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between gap-2';

  const title = document.createElement('h3');
  title.className = 'text-sm font-semibold text-[var(--color-text-primary)]';
  title.textContent = 'Métricas';

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-1';

  const exportBtn = mkButton('Exportar', 'secondary');
  const purgeBtn = mkButton('Depurar', 'danger');
  actions.appendChild(exportBtn);
  actions.appendChild(purgeBtn);
  header.appendChild(title);
  header.appendChild(actions);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2';

  const cardGrabaciones = mkCard('Grabaciones');
  const cardAudio = mkCard('Minutos de audio');
  const cardTamaño = mkCard('Almacenamiento');
  const cardResumenes = mkCard('Resúmenes');
  const cardIdioma = mkCard('Idioma (origen → destino)');
  const cardDias = mkCard('Días de uso');
  const cardWpm = mkCard('Palabras por minuto');
  grid.appendChild(cardGrabaciones.el);
  grid.appendChild(cardAudio.el);
  grid.appendChild(cardTamaño.el);
  grid.appendChild(cardResumenes.el);
  grid.appendChild(cardIdioma.el);
  grid.appendChild(cardDias.el);
  grid.appendChild(cardWpm.el);

  const heatWrap = document.createElement('div');
  heatWrap.className =
    'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 flex flex-col gap-2';
  const heatLabel = document.createElement('span');
  heatLabel.className = 'text-[11px] text-[var(--color-text-muted)]';
  heatLabel.textContent = 'Últimos 30 días';
  const heatStrip = document.createElement('div');
  heatStrip.className = 'flex flex-wrap gap-[3px]';
  const heatCells: HTMLElement[] = [];
  for (let i = 0; i < 30; i++) {
    const cell = document.createElement('span');
    cell.className =
      'w-3 h-3 rounded-[3px] bg-[var(--color-surface-muted)] border border-[var(--color-border-subtle)]';
    cell.style.opacity = '0.4';
    heatCells.push(cell);
    heatStrip.appendChild(cell);
  }
  heatWrap.appendChild(heatLabel);
  heatWrap.appendChild(heatStrip);

  // Purge confirmation dialog.
  const dialog = document.createElement('dialog');
  dialog.className =
    'rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 text-[var(--color-text-primary)] max-w-sm';
  const dialogText = document.createElement('p');
  dialogText.className = 'text-sm mb-4';
  const dialogActions = document.createElement('div');
  dialogActions.className = 'flex justify-end gap-2';
  const cancelBtn = mkButton('Cancelar', 'secondary');
  const confirmBtn = mkButton('Borrar todo', 'danger');
  dialogActions.appendChild(cancelBtn);
  dialogActions.appendChild(confirmBtn);
  dialog.appendChild(dialogText);
  dialog.appendChild(dialogActions);

  purgeBtn.addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else void handlers.onPurge();
  });
  cancelBtn.addEventListener('click', () => dialog.close());
  confirmBtn.addEventListener('click', () => {
    dialog.close();
    void handlers.onPurge();
  });
  exportBtn.addEventListener('click', () => handlers.onExport());

  root.appendChild(header);
  root.appendChild(grid);
  root.appendChild(heatWrap);
  root.appendChild(dialog);

  const update = (result: MetricsResult): void => {
    cardGrabaciones.setValue(String(result.grabaciones.total));
    cardGrabaciones.setHint(
      result.grabaciones.total === 1 ? '1 grabación' : `${result.grabaciones.total} grabaciones`,
    );
    cardAudio.setValue(formatMinutes(result.grabaciones.minutosAudio));
    cardAudio.setHint('minutos transcritos');
    cardTamaño.setValue(`${result.tamaño.pct.toFixed(1)}%`);
    cardTamaño.setHint(
      `${formatBytes(result.tamaño.usageBytes)} de ${formatBytes(result.tamaño.quotaBytes)}`,
    );
    cardResumenes.setValue(String(result.resumenes));
    cardResumenes.setHint(formatBytes(result.tamaño.audioBytes) + ' de audio');
    const origen = result.idioma.origenTop ?? '—';
    const destino = result.idioma.destinoTop ?? '—';
    cardIdioma.setValue(`${origen} → ${destino}`);
    cardIdioma.setHint('idioma más usado');
    cardDias.setValue(String(result.diasDeUso));
    cardDias.setHint('días con grabaciones');
    cardWpm.setValue(result.wpm.promedio > 0 ? String(Math.round(result.wpm.promedio)) : '—');
    cardWpm.setHint(`humano: ${result.wpm.refHumanaMin}–${result.wpm.refHumanaMax}`);

    // Heatmap: last 30 days (UTC), intensity by count relative to the day's max.
    const today = new Date();
    let maxCount = 0;
    for (const day of Object.keys(result.porDia)) {
      const c = result.porDia[day] ?? 0;
      if (c > maxCount) maxCount = c;
    }
    for (let i = 0; i < heatCells.length; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (heatCells.length - 1 - i));
      const key = d.toISOString().slice(0, 10);
      const count = result.porDia[key] ?? 0;
      const cell = heatCells[i];
      if (!cell) continue;
      const intensity = maxCount > 0 ? count / maxCount : 0;
      cell.style.opacity = count > 0 ? String(0.35 + 0.65 * intensity) : '0.4';
      cell.style.background =
        count > 0 ? 'var(--color-text-primary)' : 'var(--color-surface-muted)';
      cell.title = `${key}: ${count}`;
    }

    dialogText.textContent =
      result.grabaciones.total === 0
        ? 'No hay grabaciones para depurar.'
        : `Se borrarán ${result.grabaciones.total} grabaciones y ${result.resumenes} resúmenes (${formatBytes(result.tamaño.audioBytes)} de audio). Esta acción no se puede deshacer.`;
    confirmBtn.disabled = result.grabaciones.total === 0;
  };

  return { root, update };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Card {
  el: HTMLElement;
  setValue: (v: string) => void;
  setHint: (v: string) => void;
}

function mkCard(label: string): Card {
  const el = document.createElement('div');
  el.className = CARD_BASE;
  const labelEl = document.createElement('span');
  labelEl.className = 'text-[11px] text-[var(--color-text-muted)]';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'text-xl font-semibold text-[var(--color-text-primary)]';
  valueEl.textContent = '—';
  const hintEl = document.createElement('span');
  hintEl.className = 'text-[11px] text-[var(--color-text-muted)]';
  el.appendChild(labelEl);
  el.appendChild(valueEl);
  el.appendChild(hintEl);
  return {
    el,
    setValue: (v) => {
      valueEl.textContent = v;
    },
    setHint: (v) => {
      hintEl.textContent = v;
    },
  };
}

function mkButton(label: string, variant: 'secondary' | 'danger'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const base =
    'px-2.5 py-1 rounded-md text-xs font-medium border transition-[color,background-color] duration-[var(--transition-fast)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const variants =
    variant === 'danger'
      ? 'text-[var(--color-text-primary)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]'
      : 'text-[var(--color-text-secondary)] border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-muted)]';
  btn.className = `${base} ${variants}`;
  return btn;
}

function formatMinutes(minutos: number): string {
  if (minutos <= 0) return '0';
  if (minutos < 10) return minutos.toFixed(1);
  return Math.round(minutos).toLocaleString('es-MX');
}
