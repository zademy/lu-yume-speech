/**
 * History card — renders a single transcription entry in the sidebar.
 *
 * SRP: This module's only job is rendering one history card.
 * Each card is a self-contained DOM element with its own event handlers.
 *
 * Design: Compact card with text preview, language/model badges,
 * relative timestamp, and hover-revealed action buttons.
 */

import type { HistoryEntry } from '../types';
import { timeAgo } from '../utils/time-ago';

/**
 * Create a history card DOM element for a given entry.
 *
 * @param entry - The history entry to render
 * @param onRestore - Callback when user clicks the card to restore text
 * @param onDelete  - Callback when user clicks the delete button
 * @returns The card element ready to be appended to the sidebar list
 */
export function createHistoryCard(
  entry: HistoryEntry,
  onRestore: (id: string) => void,
  onDelete: (id: string) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = [
    'group relative',
    'p-3 pl-3.5 rounded-xl',
    'border border-[var(--color-border)]',
    'bg-[var(--color-surface)]',
    'hover:border-[var(--color-border-strong)]',
    'hover:shadow-[var(--shadow-card-hover)]',
    'hover:-translate-y-px',
    'transition-all duration-[var(--transition-fast)]',
    'cursor-pointer',
    'overflow-hidden',
  ].join(' ');
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Restaurar transcripción: ${entry.text.slice(0, 50)}`);

  // Gradient indicator bar (left edge), only visible on hover/focus
  const indicator = document.createElement('span');
  indicator.className =
    'absolute left-0 top-2 bottom-2 w-[3px] rounded-full opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-[var(--transition-fast)]';
  indicator.style.backgroundImage = 'var(--gradient-brand)';
  indicator.setAttribute('aria-hidden', 'true');
  card.appendChild(indicator);

  // Text preview — 2 lines max
  const textP = document.createElement('p');
  textP.className =
    'text-[13.5px] text-[var(--color-text-primary)] leading-snug line-clamp-2 text-left pr-6';
  textP.textContent = entry.text;

  // Meta row: badges + time
  const meta = document.createElement('div');
  meta.className = 'flex items-center gap-2 mt-2';

  // Language badge
  if (entry.language) {
    meta.appendChild(createBadge(entry.language.toUpperCase(), 'primary'));
  }

  // Model badge
  const modelLabel = entry.model === 'whisper-large-v3-turbo' ? 'turbo' : 'v3';
  meta.appendChild(createBadge(modelLabel, 'muted'));

  // Operation mode badge
  if (entry.operationMode === 'translate') {
    meta.appendChild(createBadge('TR', 'accent'));
  }

  // Spacer
  const spacer = document.createElement('span');
  spacer.className = 'flex-1';
  meta.appendChild(spacer);

  // Timestamp
  const time = document.createElement('span');
  time.className = 'text-[10px] text-[var(--color-text-muted)]';
  time.textContent = timeAgo(entry.createdAt);
  meta.appendChild(time);

  // Delete button (visible on hover/focus-within)
  const deleteBtn = document.createElement('button');
  deleteBtn.className = [
    'absolute top-2 right-2',
    'p-1.5 rounded-md',
    'text-[var(--color-text-muted)]',
    'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
    'hover:text-[var(--color-status-error)]',
    'hover:bg-red-50 dark:hover:bg-red-950/50',
    'active:scale-90',
    'transition-all duration-[var(--transition-fast)]',
    'cursor-pointer',
  ].join(' ');
  deleteBtn.setAttribute('aria-label', 'Eliminar entrada del historial');
  deleteBtn.setAttribute('title', 'Eliminar');
  deleteBtn.appendChild(createTrashIcon());

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete(entry.id);
  });

  // Assemble
  card.appendChild(textP);
  card.appendChild(meta);
  card.appendChild(deleteBtn);

  // Click to restore
  card.addEventListener('click', () => { onRestore(entry.id); });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRestore(entry.id);
    }
  });

  return card;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function createBadge(text: string, variant: 'primary' | 'muted' | 'accent'): HTMLElement {
  const badge = document.createElement('span');

  const base =
    'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none';

  const variants: Record<string, string> = {
    primary:
      'bg-[var(--color-primary-100)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)] dark:text-[var(--color-primary-300)]',
    muted: 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
    accent:
      'bg-[var(--color-accent-100)] text-[var(--color-accent-700)] dark:bg-[var(--color-accent-900)] dark:text-[var(--color-accent-300)]',
  };

  badge.className = `${base} ${variants[variant] ?? variants.muted}`;
  badge.textContent = text;
  return badge;
}

function createTrashIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M3 6h18');
  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6');
  const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path3.setAttribute('d', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2');

  svg.appendChild(path1);
  svg.appendChild(path2);
  svg.appendChild(path3);
  return svg;
}
