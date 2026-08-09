/**
 * Summary history panel — renders schema-bound summaries for the exact visible
 * transcription snapshot and exposes copy/delete actions through callbacks.
 *
 * SRP: this module only renders summary history DOM and formats copied text.
 */

import type { GeneratedSummary, SummaryHistory } from '../types';

const COPY_ICON =
  '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const DELETE_ICON =
  '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

export interface SummaryPanelActions {
  onCopy(summary: GeneratedSummary): void;
  onDelete(historyId: string, summaryId: string): void;
}

/** Format one generated summary for the clipboard. */
export function summaryToText(summary: GeneratedSummary): string {
  if (summary.keyPoints.length === 0) return summary.summary;
  return `${summary.summary}\n\nPuntos clave:\n${summary.keyPoints.map((point) => `- ${point}`).join('\n')}`;
}

function renderIcon(button: HTMLButtonElement, svg: string): void {
  const fragment = document.createRange().createContextualFragment(svg);
  button.appendChild(fragment);
}

function createActionButton(
  action: 'copy' | 'delete',
  label: string,
  icon: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.summaryAction = action;
  button.className =
    'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] hover:border-[var(--color-border-subtle)] active:scale-[0.97] transition-all duration-[var(--transition-fast)] cursor-pointer';
  button.setAttribute('aria-label', label);
  button.title = label;
  renderIcon(button, icon);
  return button;
}

function createSummaryCard(
  history: SummaryHistory,
  generated: GeneratedSummary,
  number: number,
  isLatest: boolean,
  actions: SummaryPanelActions,
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className =
    'group rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-glass-strong)] overflow-hidden';
  details.open = isLatest;

  const heading = document.createElement('summary');
  heading.className =
    'summary-card-heading flex items-center gap-3 px-3.5 py-3 cursor-pointer select-none text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors duration-[var(--transition-fast)]';

  const marker = document.createElement('span');
  marker.className =
    'summary-number inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)] text-xs font-bold';
  marker.textContent = String(number);

  const label = document.createElement('span');
  label.className = 'flex-1 min-w-0 font-semibold';
  label.textContent = `Resumen ${number}`;

  const time = document.createElement('time');
  time.className = 'shrink-0 text-[11px] font-normal text-[var(--color-text-muted)]';
  time.dateTime = new Date(generated.createdAt).toISOString();
  time.textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(generated.createdAt);

  heading.append(marker, label, time);

  const body = document.createElement('div');
  body.className = 'border-t border-[var(--color-border-subtle)] px-4 py-4';

  const summary = document.createElement('p');
  summary.className = 'text-sm leading-6 text-[var(--color-text-secondary)] whitespace-pre-wrap';
  summary.textContent = generated.summary;
  body.appendChild(summary);

  if (generated.keyPoints.length > 0) {
    const keyPointLabel = document.createElement('h4');
    keyPointLabel.className =
      'mt-4 mb-2 text-[10px] font-bold tracking-[0.12em] uppercase text-[var(--color-text-secondary)]';
    keyPointLabel.textContent = 'Puntos clave';

    const keyPoints = document.createElement('ul');
    keyPoints.className = 'space-y-2 text-sm leading-5 text-[var(--color-text-secondary)]';
    for (const point of generated.keyPoints) {
      const item = document.createElement('li');
      item.className = 'flex gap-2.5';
      const bullet = document.createElement('span');
      bullet.className =
        'mt-[0.42rem] w-1.5 h-1.5 shrink-0 rounded-full bg-[var(--color-text-primary)]';
      bullet.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = point;
      item.append(bullet, text);
      keyPoints.appendChild(item);
    }
    body.append(keyPointLabel, keyPoints);
  }

  const footer = document.createElement('div');
  footer.className =
    'mt-4 pt-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between gap-3';
  const model = document.createElement('span');
  model.className = 'text-[10px] font-mono text-[var(--color-text-muted)] truncate';
  model.textContent = generated.model;
  const controls = document.createElement('div');
  controls.className = 'flex items-center gap-1 shrink-0';
  const copyButton = createActionButton('copy', `Copiar resumen ${number}`, COPY_ICON);
  copyButton.addEventListener('click', () => actions.onCopy(generated));
  const deleteButton = createActionButton('delete', `Eliminar resumen ${number}`, DELETE_ICON);
  deleteButton.addEventListener('click', () => actions.onDelete(history.id, generated.id));
  controls.append(copyButton, deleteButton);
  footer.append(model, controls);
  body.appendChild(footer);

  details.append(heading, body);
  return details;
}

/** Render newest-first generations, expanding only the latest one. */
export function renderSummaryHistory(
  panel: HTMLDivElement,
  history: SummaryHistory | undefined,
  actions: SummaryPanelActions,
): void {
  panel.replaceChildren();
  if (!history || history.summaries.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const generations = [...history.summaries].reverse();
  generations.forEach((generated, index) => {
    panel.appendChild(
      createSummaryCard(history, generated, history.summaries.length - index, index === 0, actions),
    );
  });
}
