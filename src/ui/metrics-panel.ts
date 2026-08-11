/**
 * Métricas panel — a dedicated view that renders derived indicators.
 *
 * Wispr-Flow-inspired layout, adapted to the data this app actually captures:
 *   Row 1 — Words-per-minute gauge · Total words dictated · Grabaciones (by mode)
 *   Row 2 — Category breakdown (mode + idioma) · Activity streak heatmap
 *
 * "Top %" population percentile, auto-fix counts and per-app usage from the
 * reference design are intentionally NOT reproduced: this app has no backend,
 * no population, and does not instrument corrections or host-app usage. Only
 * real, locally-derived data is shown.
 *
 * Pure DOM: receives a `MetricsResult` snapshot via `update()` and renders. Owns
 * the Export and Purge affordances; data work is delegated to composition-root
 * callbacks. Language-aware via `setLanguage()`.
 *
 * SRP: this module only renders the Métricas UI and forwards user actions.
 */

import { formatBytes } from '../metrics/metrics';
import type { MetricsResult } from '../metrics/metrics';
import type { AppLanguage } from '../types';
import { translate } from '../i18n/translations';

export interface MetricsPanelHandlers {
  onExport: () => void;
  onPurge: () => Promise<void> | void;
}

export interface MetricsPanel {
  readonly root: HTMLElement;
  update: (result: MetricsResult) => void;
  setLanguage: (lang: AppLanguage) => void;
}

const CARD =
  'rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 flex flex-col gap-2';
const ACCENT = '#0d9488'; // teal-600 — reads well on light and dark surfaces
const ACCENT_SOFT = '#5eead4'; // teal-300
const CELL = 11;
const WEEKS = 18;

/** Build the Métricas panel. `update(result)` refreshes values + heatmap. */
export function createMetricsPanel(
  handlers: MetricsPanelHandlers,
  lang: AppLanguage,
): MetricsPanel {
  let currentLang: AppLanguage = lang;
  let lastResult: MetricsResult | null = null;
  let windowEnd = new Date();

  const root = document.createElement('section');
  root.className = 'metrics-panel flex flex-col gap-4';
  root.setAttribute('aria-label', translate(currentLang, 'metrics.title'));

  // --- Header (tab style with underline) ------------------------------------
  const header = document.createElement('div');
  header.className = 'flex flex-col gap-2';
  const headRow = document.createElement('div');
  headRow.className = 'flex items-end justify-between gap-3 flex-wrap';
  const tab = document.createElement('div');
  tab.className =
    'metrics-tab relative pb-2 text-base font-semibold text-[var(--color-text-primary)] border-b-2 border-[var(--color-text-primary)]';
  tab.textContent = translate(currentLang, 'metrics.tab.usage');
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2 pb-2';
  const exportBtn = mkButton(translate(currentLang, 'metrics.action.export'), 'secondary');
  const purgeBtn = mkButton(translate(currentLang, 'metrics.action.purge'), 'danger');
  actions.appendChild(exportBtn);
  actions.appendChild(purgeBtn);
  headRow.appendChild(tab);
  headRow.appendChild(actions);
  const divider = document.createElement('hr');
  divider.className = 'border-0 border-t border-[var(--color-border-subtle)] mt-2';
  header.appendChild(headRow);
  header.appendChild(divider);
  root.appendChild(header);

  // --- Row 1: WPM gauge · Total words · Grabaciones -------------------------
  const row1 = document.createElement('div');
  row1.className = 'grid grid-cols-1 gap-3 md:grid-cols-4';

  // (1) WPM gauge
  const gaugeCard = document.createElement('div');
  gaugeCard.className = CARD;
  const gaugeHead = mkCardHead(currentLang, 'metrics.card.wpm');
  const gaugeValue = document.createElement('span');
  gaugeValue.className = 'text-4xl font-bold text-[var(--color-text-primary)]';
  gaugeValue.textContent = '—';
  const gaugeSvg = semicircleGauge(0);
  const gaugeSub = document.createElement('span');
  gaugeSub.className = 'text-[11px] text-[var(--color-text-muted)]';
  gaugeSub.textContent = translate(currentLang, 'metrics.card.wpm.sub', {
    min: 150,
    max: 200,
  });
  gaugeCard.appendChild(gaugeHead.el);
  gaugeCard.appendChild(gaugeValue);
  gaugeCard.appendChild(gaugeSvg);
  gaugeCard.appendChild(gaugeSub);
  row1.appendChild(gaugeCard);

  // (2) Total words dictated
  const wordsCard = document.createElement('div');
  wordsCard.className = CARD;
  const wordsHead = mkCardHead(currentLang, 'metrics.card.words');
  const wordsValue = document.createElement('span');
  wordsValue.className = 'text-4xl font-bold text-[var(--color-text-primary)]';
  wordsValue.textContent = '0';
  const wordsHint = document.createElement('span');
  wordsHint.className = 'text-[11px] text-[var(--color-text-muted)]';
  wordsHint.textContent = translate(currentLang, 'metrics.card.words.hint');
  wordsCard.appendChild(wordsHead.el);
  wordsCard.appendChild(wordsValue);
  wordsCard.appendChild(wordsHint);
  row1.appendChild(wordsCard);

  // (3) Grabaciones (wide) — total + mode breakdown + minutes
  const recCard = document.createElement('div');
  recCard.className = `${CARD} md:col-span-2`;
  const recHead = document.createElement('div');
  recHead.className = 'flex items-center justify-between';
  const recHeadRight = document.createElement('span');
  recHeadRight.className =
    'text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]';
  const recLabel = document.createElement('span');
  recLabel.className =
    'text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]';
  recLabel.textContent = translate(currentLang, 'metrics.card.recordings');
  recHead.appendChild(recLabel);
  recHead.appendChild(recHeadRight);
  const recValueRow = document.createElement('div');
  recValueRow.className = 'flex items-end gap-2';
  const recValue = document.createElement('span');
  recValue.className = 'text-4xl font-bold text-[var(--color-text-primary)]';
  recValue.textContent = '0';
  const recMinutes = document.createElement('span');
  recMinutes.className = 'text-xs text-[var(--color-text-muted)] pb-1';
  recValueRow.appendChild(recValue);
  recValueRow.appendChild(recMinutes);
  const recBreakdown = document.createElement('div');
  recBreakdown.className = 'flex flex-col gap-1.5';
  recCard.appendChild(recHead);
  recCard.appendChild(recValueRow);
  recCard.appendChild(recBreakdown);
  row1.appendChild(recCard);

  root.appendChild(row1);

  // --- Row 2: Category breakdown · Streak heatmap ---------------------------
  const row2 = document.createElement('div');
  row2.className = 'grid grid-cols-1 gap-3 md:grid-cols-2';

  // (4) Category breakdown
  const catCard = document.createElement('div');
  catCard.className = `${CARD} gap-3`;
  const catHead = document.createElement('div');
  catHead.className = 'flex items-center justify-between';
  const catTitle = document.createElement('span');
  catTitle.className = 'text-sm font-semibold text-[var(--color-text-primary)]';
  catTitle.textContent = translate(currentLang, 'metrics.category.title');
  const catTotal = document.createElement('span');
  catTotal.className =
    'text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]';
  catHead.appendChild(catTitle);
  catHead.appendChild(catTotal);
  const catList = document.createElement('div');
  catList.className = 'flex flex-col gap-2';
  catCard.appendChild(catHead);
  catCard.appendChild(catList);
  row2.appendChild(catCard);

  // (5) Streak heatmap
  const streakCard = document.createElement('div');
  streakCard.className = `${CARD} gap-3`;
  const streakHead = document.createElement('div');
  streakHead.className = 'flex items-center justify-between';
  const streakLeft = document.createElement('span');
  streakLeft.className = 'text-sm font-semibold text-[var(--color-text-primary)]';
  const streakRight = document.createElement('span');
  streakRight.className =
    'text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]';
  streakHead.appendChild(streakLeft);
  streakHead.appendChild(streakRight);
  const heatWrap = document.createElement('div');
  heatWrap.className = 'flex flex-col gap-2';
  const heatNav = document.createElement('div');
  heatNav.className = 'flex items-center gap-1';
  const navPrev = document.createElement('button');
  navPrev.type = 'button';
  navPrev.className =
    'icon-button compact text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]';
  navPrev.setAttribute('aria-label', translate(currentLang, 'metrics.heatmap.prev'));
  navPrev.textContent = '‹';
  const navNext = document.createElement('button');
  navNext.type = 'button';
  navNext.className =
    'icon-button compact text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]';
  navNext.setAttribute('aria-label', translate(currentLang, 'metrics.heatmap.next'));
  navNext.textContent = '›';
  const monthLabels = document.createElement('div');
  monthLabels.className = 'flex-1 flex gap-[3px] overflow-hidden';
  heatNav.appendChild(navPrev);
  heatNav.appendChild(monthLabels);
  heatNav.appendChild(navNext);
  const heatBody = document.createElement('div');
  heatBody.className = 'flex gap-[3px]';
  const weekdays = document.createElement('div');
  weekdays.className = 'flex flex-col gap-[3px]';
  const cellsGrid = document.createElement('div');
  cellsGrid.className = 'flex gap-[3px]';
  heatBody.appendChild(weekdays);
  heatBody.appendChild(cellsGrid);
  const heatLegend = document.createElement('div');
  heatLegend.className =
    'flex items-center justify-between text-[10px] text-[var(--color-text-muted)]';
  const legendLeft = document.createElement('div');
  legendLeft.className = 'flex items-center gap-1';
  const legendRight = document.createElement('div');
  legendRight.className = 'flex items-center gap-1';
  heatLegend.appendChild(legendLeft);
  heatLegend.appendChild(legendRight);
  heatWrap.appendChild(heatNav);
  heatWrap.appendChild(heatBody);
  heatWrap.appendChild(heatLegend);
  streakCard.appendChild(streakHead);
  streakCard.appendChild(heatWrap);
  row2.appendChild(streakCard);

  root.appendChild(row2);

  // --- Purge dialog ---------------------------------------------------------
  const dialog = document.createElement('dialog');
  dialog.className =
    'rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 text-[var(--color-text-primary)] max-w-sm';
  const dialogText = document.createElement('p');
  dialogText.className = 'text-sm mb-4';
  const dialogActions = document.createElement('div');
  dialogActions.className = 'flex justify-end gap-2';
  const cancelBtn = mkButton(translate(currentLang, 'metrics.dialog.cancel'), 'secondary');
  const confirmBtn = mkButton(translate(currentLang, 'metrics.dialog.confirmBtn'), 'danger');
  dialogActions.appendChild(cancelBtn);
  dialogActions.appendChild(confirmBtn);
  dialog.appendChild(dialogText);
  dialog.appendChild(dialogActions);
  root.appendChild(dialog);

  // --- Events ---------------------------------------------------------------
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
  navPrev.addEventListener('click', () => {
    windowEnd = addDays(windowEnd, -WEEKS * 7);
    if (lastResult) renderHeatmap(lastResult);
  });
  navNext.addEventListener('click', () => {
    const candidate = addDays(windowEnd, WEEKS * 7);
    if (candidate.getTime() <= Date.now()) {
      windowEnd = candidate;
      if (lastResult) renderHeatmap(lastResult);
    }
  });

  // --- Heatmap renderer -----------------------------------------------------
  function renderHeatmap(result: MetricsResult): void {
    const lang = currentLang;
    monthLabels.replaceChildren();
    weekdays.replaceChildren();
    cellsGrid.replaceChildren();

    // Weekday labels: Sun(empty), Mon, Tue(empty), Wed, Thu(empty), Fri, Sat(empty)
    const wdKeys = [
      '',
      'metrics.heatmap.mon',
      '',
      'metrics.heatmap.wed',
      '',
      'metrics.heatmap.fri',
      '',
    ];
    for (const k of wdKeys) {
      const s = document.createElement('span');
      s.style.width = `${CELL}px`;
      s.style.height = `${CELL}px`;
      s.style.fontSize = '9px';
      s.style.lineHeight = `${CELL}px`;
      s.style.color = 'var(--color-text-muted)';
      s.textContent = k ? translate(lang, k) : '';
      weekdays.appendChild(s);
    }

    // Anchor: Sunday of the week containing windowEnd.
    const endSunday = addDays(windowEnd, -weekDayUtc(windowEnd));
    const entries = Object.values(result.porDia);
    const maxCount = entries.reduce((a, b) => Math.max(a, b), 0);
    const porDia = result.porDia;
    let lastMonth = -1;

    for (let col = 0; col < WEEKS; col++) {
      const colSunday = addDays(endSunday, -(WEEKS - 1 - col) * 7);
      const colMonth = colSunday.getUTCMonth();
      const mLabel = document.createElement('span');
      mLabel.style.width = `${CELL}px`;
      mLabel.style.fontSize = '9px';
      mLabel.style.color = 'var(--color-text-muted)';
      mLabel.textContent =
        colMonth !== lastMonth ? translate(lang, `metrics.heatmap.m${colMonth}`) : '';
      monthLabels.appendChild(mLabel);
      lastMonth = colMonth;

      const colEl = document.createElement('div');
      colEl.className = 'flex flex-col gap-[3px]';
      for (let row = 0; row < 7; row++) {
        const d = addDays(colSunday, row);
        const key = dayKey(d.getTime());
        const count = porDia[key] ?? 0;
        const cell = document.createElement('span');
        cell.className = 'hm-cell';
        cell.style.width = `${CELL}px`;
        cell.style.height = `${CELL}px`;
        cell.style.borderRadius = '2px';
        cell.style.background = heatColor(count, maxCount);
        cell.title = `${key}: ${count}`;
        colEl.appendChild(cell);
      }
      cellsGrid.appendChild(colEl);
    }

    // Legend
    legendLeft.replaceChildren();
    const lessLabel = document.createElement('span');
    lessLabel.textContent = translate(lang, 'metrics.heatmap.less');
    legendLeft.appendChild(lessLabel);
    for (const c of ['var(--color-surface-muted)', ACCENT_SOFT, '#2dd4bf', ACCENT]) {
      const sw = document.createElement('span');
      sw.style.width = `${CELL}px`;
      sw.style.height = `${CELL}px`;
      sw.style.borderRadius = '2px';
      sw.style.background = c;
      legendLeft.appendChild(sw);
    }
    const moreLabel = document.createElement('span');
    moreLabel.textContent = translate(lang, 'metrics.heatmap.more');
    legendLeft.appendChild(moreLabel);

    legendRight.replaceChildren();
    const curSwatch = document.createElement('span');
    curSwatch.style.width = `${CELL}px`;
    curSwatch.style.height = `${CELL}px`;
    curSwatch.style.borderRadius = '2px';
    curSwatch.style.border = `1px solid ${ACCENT}`;
    curSwatch.style.background = 'transparent';
    legendRight.appendChild(curSwatch);
    const curLabel = document.createElement('span');
    curLabel.textContent = translate(lang, 'metrics.heatmap.current');
    legendRight.appendChild(curLabel);

    // Streak header text
    streakLeft.textContent = translate(lang, 'metrics.streak.current', { n: result.racha.actual });
    streakRight.textContent = translate(lang, 'metrics.streak.longest', {
      n: result.racha.masLarga,
    });
  }

  // --- update ---------------------------------------------------------------
  const update = (result: MetricsResult): void => {
    lastResult = result;

    // WPM gauge
    const wpm = result.wpm.promedio > 0 ? Math.round(result.wpm.promedio) : 0;
    gaugeValue.textContent = wpm > 0 ? String(wpm) : '—';
    setGauge(gaugeSvg, clamp(wpm / 250, 0, 1));

    // Total words
    wordsValue.textContent = result.palabras.total.toLocaleString(
      currentLang === 'es' ? 'es-MX' : 'en-US',
    );

    // Grabaciones card
    recValue.textContent = String(result.grabaciones.total);
    recMinutes.textContent = translate(currentLang, 'metrics.recordings.audioMin', {
      n: formatMinutes(result.grabaciones.minutosAudio, currentLang),
    });
    recHeadRight.textContent = translate(currentLang, 'metrics.category.total', {
      n: result.grabaciones.total,
    });
    recBreakdown.replaceChildren();
    recBreakdown.appendChild(
      modeRow(
        currentLang,
        'metrics.recordings.transcribe',
        result.modo.transcribe,
        result.grabaciones.total,
        true,
      ),
    );
    recBreakdown.appendChild(
      modeRow(
        currentLang,
        'metrics.recordings.translate',
        result.modo.translate,
        result.grabaciones.total,
        true,
      ),
    );

    // Category card — mode bars + top idiomas
    catTotal.textContent = translate(currentLang, 'metrics.category.total', {
      n: result.grabaciones.total,
    });
    catList.replaceChildren();
    catList.appendChild(
      catRow(
        currentLang,
        'metrics.cat.transcribe',
        result.modo.transcribe,
        result.grabaciones.total,
      ),
    );
    catList.appendChild(
      catRow(currentLang, 'metrics.cat.translate', result.modo.translate, result.grabaciones.total),
    );
    for (const idi of result.idioma.origenes.slice(0, 3)) {
      catList.appendChild(catRowLang(idi.lang, idi.count, result.grabaciones.total));
    }

    renderHeatmap(result);

    dialogText.textContent =
      result.grabaciones.total === 0
        ? translate(currentLang, 'metrics.dialog.empty')
        : translate(currentLang, 'metrics.dialog.confirm', {
            recordings: result.grabaciones.total,
            summaries: result.resumenes,
            bytes: formatBytes(result.tamaño.audioBytes),
          });
    confirmBtn.disabled = result.grabaciones.total === 0;
  };

  const setLanguage = (next: AppLanguage): void => {
    currentLang = next;
    root.setAttribute('aria-label', translate(currentLang, 'metrics.title'));
    tab.textContent = translate(currentLang, 'metrics.tab.usage');
    exportBtn.textContent = translate(currentLang, 'metrics.action.export');
    purgeBtn.textContent = translate(currentLang, 'metrics.action.purge');
    cancelBtn.textContent = translate(currentLang, 'metrics.dialog.cancel');
    confirmBtn.textContent = translate(currentLang, 'metrics.dialog.confirmBtn');
    gaugeHead.label.textContent = translate(currentLang, 'metrics.card.wpm');
    gaugeSub.textContent = translate(currentLang, 'metrics.card.wpm.sub', { min: 150, max: 200 });
    wordsHead.label.textContent = translate(currentLang, 'metrics.card.words');
    wordsHint.textContent = translate(currentLang, 'metrics.card.words.hint');
    recLabel.textContent = translate(currentLang, 'metrics.card.recordings');
    catTitle.textContent = translate(currentLang, 'metrics.category.title');
    navPrev.setAttribute('aria-label', translate(currentLang, 'metrics.heatmap.prev'));
    navNext.setAttribute('aria-label', translate(currentLang, 'metrics.heatmap.next'));
    if (lastResult) update(lastResult);
  };

  return { root, update, setLanguage };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface CardHead {
  readonly el: HTMLElement;
  readonly label: HTMLSpanElement;
}

/** Builds a small labeled card header; `label` is exposed for re-translation. */
function mkCardHead(lang: AppLanguage, labelKey: string): CardHead {
  const el = document.createElement('div');
  el.className = 'flex items-center justify-between';
  const label = document.createElement('span');
  label.className =
    'text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]';
  label.textContent = translate(lang, labelKey);
  el.appendChild(label);
  return { el, label };
}

/** Semicircle gauge SVG; value arc fraction updated via `setGauge`. */
function semicircleGauge(_fraction: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 52');
  svg.setAttribute('class', 'w-full');
  svg.style.maxHeight = '56px';
  const d = 'M6,50 A44,44 0 0,1 94,50';
  const track = document.createElementNS(ns, 'path');
  track.setAttribute('d', d);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--color-border-subtle)');
  track.setAttribute('stroke-width', '7');
  track.setAttribute('stroke-linecap', 'round');
  svg.appendChild(track);
  const value = document.createElementNS(ns, 'path');
  value.setAttribute('d', d);
  value.setAttribute('fill', 'none');
  value.setAttribute('stroke', ACCENT);
  value.setAttribute('stroke-width', '7');
  value.setAttribute('stroke-linecap', 'round');
  value.setAttribute('stroke-dasharray', '0 138.2');
  svg.appendChild(value);
  return svg;
}

/** Updates the gauge's value arc as a fraction in `[0, 1]`. */
function setGauge(svg: SVGSVGElement, fraction: number): void {
  const value = svg.querySelectorAll('path')[1];
  if (!value) return;
  const len = 138.2; // π * 44
  value.setAttribute('stroke-dasharray', `${(fraction * len).toFixed(2)} ${len}`);
}

/** Horizontal bar row used in the Grabaciones card (mode breakdown). */
function modeRow(
  lang: AppLanguage,
  nameKey: string,
  count: number,
  total: number,
  compact: boolean,
): HTMLElement {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const name = document.createElement('span');
  name.className = 'text-xs text-[var(--color-text-secondary)] w-28 shrink-0';
  name.textContent = translate(lang, nameKey);
  const barWrap = document.createElement('div');
  barWrap.className = 'flex-1 h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden';
  const bar = document.createElement('div');
  bar.className = 'h-full rounded-full';
  bar.style.width = `${pct}%`;
  bar.style.background = compact ? ACCENT : ACCENT_SOFT;
  barWrap.appendChild(bar);
  const num = document.createElement('span');
  num.className = 'text-xs font-medium text-[var(--color-text-secondary)] w-16 text-right';
  num.textContent = `${pct}% · ${count}`;
  row.appendChild(name);
  row.appendChild(barWrap);
  row.appendChild(num);
  return row;
}

/** Category-card bar (soft color) for mode rows. */
function catRow(lang: AppLanguage, nameKey: string, count: number, total: number): HTMLElement {
  return modeRow(lang, nameKey, count, total, false);
}

/** Category-card bar (soft color) for top source languages. */
function catRowLang(lang: string, count: number, total: number): HTMLElement {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const name = document.createElement('span');
  name.className = 'text-xs text-[var(--color-text-secondary)] w-28 shrink-0 uppercase';
  name.textContent = lang;
  const barWrap = document.createElement('div');
  barWrap.className = 'flex-1 h-2 rounded-full bg-[var(--color-surface-muted)] overflow-hidden';
  const bar = document.createElement('div');
  bar.className = 'h-full rounded-full';
  bar.style.width = `${pct}%`;
  bar.style.background = ACCENT_SOFT;
  barWrap.appendChild(bar);
  const num = document.createElement('span');
  num.className = 'text-xs font-medium text-[var(--color-text-secondary)] w-16 text-right';
  num.textContent = `${pct}% · ${count}`;
  row.appendChild(name);
  row.appendChild(barWrap);
  row.appendChild(num);
  return row;
}

/** Small button used for Export / Purge / dialog actions. */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the heatmap color for a given day count relative to the window max. */
function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'var(--color-surface-muted)';
  const ratio = count / max;
  if (ratio < 0.34) return ACCENT_SOFT;
  if (ratio < 0.67) return '#2dd4bf';
  return ACCENT;
}

/** Returns `v` clamped to `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Adds (or subtracts) a number of days using UTC ops to avoid DST drift. */
function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + days);
  return n;
}

/** Returns the day-of-week (0=Sun) of a UTC-normalized date. */
function weekDayUtc(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getUTCDay();
}

/** Returns the `YYYY-MM-DD` key used to look up a day in `MetricsResult.porDia`. */
function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Formats an audio-minutes count for display; 1-decimal precision under 10. */
function formatMinutes(minutos: number, lang: AppLanguage): string {
  if (minutos <= 0) return '0';
  const locale = lang === 'es' ? 'es-MX' : 'en-US';
  if (minutos < 10) return minutos.toFixed(1);
  return Math.round(minutos).toLocaleString(locale);
}
