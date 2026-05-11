/**
 * Sidebar component — floating panel with transcription history.
 *
 * Renders a collapsible floating panel to the left of the main app.
 * Not full-height — sits alongside the content with rounded corners,
 * shadow, and a max-height with scroll.
 *
 * SRP: This module's only job is the sidebar layout and card list rendering.
 * DIP: Communicates with the rest of the app via callbacks.
 */

import type { HistoryEntry } from '../types';
import { createHistoryCard } from './history-card';
import { load, save } from '../utils/storage';
import { HISTORY_SIDEBAR_KEY } from '../types';

export interface SidebarElements {
  root: HTMLElement;
  list: HTMLElement;
  emptyState: HTMLElement;
  clearAllBtn: HTMLButtonElement;
  toggleBtn: HTMLButtonElement;
  countDisplay: HTMLElement;
  _onRestore: (id: string) => void;
  _onDelete: (id: string) => void;
}

/**
 * Create the sidebar DOM structure with header, card list, and empty state.
 *
 * @param onRestore - Callback invoked when a user clicks a card to restore text
 * @param onDelete  - Callback invoked when a user clicks delete on a card
 * @param onClear   - Callback invoked when a user clicks "clear all history"
 * @returns Object containing sidebar root element and interactive sub-elements
 */
export function createSidebar(
  onRestore: (id: string) => void,
  onDelete: (id: string) => void,
  onClear: () => void,
): SidebarElements {
  const isOpen = load<boolean>(HISTORY_SIDEBAR_KEY, false);

  const root = document.createElement('aside');
  root.id = 'sidebar';
  root.className = [
    'hidden md:flex flex-col',
    'w-72 shrink-0',
    'rounded-2xl',
    'border border-[var(--color-border)]',
    'bg-[var(--color-surface)]',
    'shadow-[var(--shadow-elevated)]',
    'transition-all duration-300 ease-out',
    'overflow-hidden',
    'self-start',
    'sticky top-4',
    'max-h-[calc(100vh-2rem)]',
  ].join(' ');

  if (!isOpen) {
    root.classList.remove('md:flex');
    root.classList.add('md:hidden');
  }

  // Header
  const header = document.createElement('div');
  header.className =
    'flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0';

  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-[var(--color-text-primary)]';
  title.textContent = 'Historial';

  const headerActions = document.createElement('div');
  headerActions.className = 'flex items-center gap-1';

  const countDisplay = document.createElement('span');
  countDisplay.className = 'text-[10px] text-[var(--color-text-muted)] mr-1';
  countDisplay.textContent = '';

  const clearAllBtn = document.createElement('button');
  clearAllBtn.className =
    'p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-status-error)] hover:bg-red-50 dark:hover:bg-red-950 transition-all duration-[var(--transition-fast)] cursor-pointer';
  clearAllBtn.setAttribute('aria-label', 'Limpiar historial');
  clearAllBtn.appendChild(createTrashAllIcon());
  clearAllBtn.addEventListener('click', () => {
    if (confirm('¿Eliminar todo el historial?')) {
      onClear();
    }
  });

  headerActions.appendChild(countDisplay);
  headerActions.appendChild(clearAllBtn);
  header.appendChild(title);
  header.appendChild(headerActions);

  // Card list (scrollable)
  const list = document.createElement('div');
  list.className = 'flex-1 overflow-y-auto p-3 space-y-2 min-h-0';

  // Empty state
  const emptyState = document.createElement('div');
  emptyState.className = 'flex flex-col items-center justify-center py-12 px-4 text-center';
  emptyState.appendChild(createEmptyIcon());
  const emptyText = document.createElement('p');
  emptyText.className = 'text-sm text-[var(--color-text-muted)] mt-3';
  emptyText.textContent = 'Sin transcripciones';
  emptyState.appendChild(emptyText);
  const emptyHint = document.createElement('p');
  emptyHint.className = 'text-xs text-[var(--color-text-muted)] opacity-60 mt-1';
  emptyHint.textContent = 'Las grabaciones aparecerán aquí';
  emptyState.appendChild(emptyHint);

  list.appendChild(emptyState);

  root.appendChild(header);
  root.appendChild(list);

  // Toggle button (inserted into app header by main.ts)
  const toggleBtn = document.createElement('button');
  toggleBtn.className =
    'p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors duration-[var(--transition-fast)] cursor-pointer';
  toggleBtn.setAttribute('aria-label', 'Toggle historial');
  toggleBtn.appendChild(createPanelIcon());
  toggleBtn.addEventListener('click', () => {
    toggleSidebar(root);
  });

  return {
    root,
    list,
    emptyState,
    clearAllBtn,
    toggleBtn,
    countDisplay,
    _onRestore: onRestore,
    _onDelete: onDelete,
  };
}

/**
 * Populate the sidebar with a full list of history entries.
 * Clears any existing cards before inserting.
 *
 * @param elements - Sidebar elements returned by createSidebar
 * @param entries  - Array of history entries to render
 */
export function populateEntries(elements: SidebarElements, entries: HistoryEntry[]): void {
  const cards = elements.list.querySelectorAll('[data-history-card]');
  cards.forEach((c) => c.remove());
  elements.emptyState.classList.toggle('hidden', entries.length > 0);

  for (const entry of entries) {
    const card = createHistoryCard(entry, elements._onRestore, elements._onDelete);
    card.setAttribute('data-history-card', entry.id);
    elements.list.appendChild(card);
  }

  elements.countDisplay.textContent = entries.length > 0 ? String(entries.length) : '';
}

/**
 * Prepend a new history entry card to the top of the sidebar list.
 * Hides the empty state indicator.
 *
 * @param elements - Sidebar elements returned by createSidebar
 * @param entry    - The new history entry to render
 */
export function prependEntry(elements: SidebarElements, entry: HistoryEntry): void {
  elements.emptyState.classList.add('hidden');
  const card = createHistoryCard(entry, elements._onRestore, elements._onDelete);
  card.setAttribute('data-history-card', entry.id);

  const firstCard = elements.list.querySelector('[data-history-card]');
  if (firstCard) {
    elements.list.insertBefore(card, firstCard);
  } else {
    elements.list.appendChild(card);
  }

  const total = elements.list.querySelectorAll('[data-history-card]').length;
  elements.countDisplay.textContent = String(total);
}

/**
 * Remove a single card from the sidebar by its entry ID.
 * Shows the empty state if no cards remain.
 *
 * @param elements - Sidebar elements returned by createSidebar
 * @param id       - History entry ID to remove
 */
export function removeCard(elements: SidebarElements, id: string): void {
  const card = elements.list.querySelector(`[data-history-card="${id}"]`);
  if (card) card.remove();

  const remaining = elements.list.querySelectorAll('[data-history-card]').length;
  elements.countDisplay.textContent = remaining > 0 ? String(remaining) : '';
  elements.emptyState.classList.toggle('hidden', remaining > 0);
}

/**
 * Remove all history cards from the sidebar.
 * Restores the empty state indicator.
 *
 * @param elements - Sidebar elements returned by createSidebar
 */
export function clearCards(elements: SidebarElements): void {
  const cards = elements.list.querySelectorAll('[data-history-card]');
  cards.forEach((c) => c.remove());
  elements.emptyState.classList.remove('hidden');
  elements.countDisplay.textContent = '';
}

// -----------------------------------------------------------------------
// Sidebar toggle
// -----------------------------------------------------------------------

/**
 * Toggle the sidebar visibility and persist the state to localStorage.
 * Handles responsive show/hide by toggling 'md:flex' / 'md:hidden' classes.
 */
function toggleSidebar(root: HTMLElement): void {
  const isHidden = root.classList.contains('md:hidden');
  if (isHidden) {
    root.classList.remove('md:hidden');
    root.classList.add('md:flex');
    save(HISTORY_SIDEBAR_KEY, true);
  } else {
    root.classList.remove('md:flex');
    root.classList.add('md:hidden');
    save(HISTORY_SIDEBAR_KEY, false);
  }
}

// -----------------------------------------------------------------------
// SVG Icons (createElementNS)
// -----------------------------------------------------------------------

/**
 * Create the panel toggle icon (sidebar layout icon).
 */
function createPanelIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '18');
  rect.setAttribute('height', '18');
  rect.setAttribute('x', '3');
  rect.setAttribute('y', '3');
  rect.setAttribute('rx', '2');
  rect.setAttribute('ry', '2');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M9 3v18');
  svg.appendChild(rect);
  svg.appendChild(path);
  return svg;
}

/**
 * Create the trash icon used for the "clear all history" button.
 */
function createTrashAllIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p1.setAttribute('d', 'M3 6h18');
  const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p2.setAttribute('d', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6');
  const p3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p3.setAttribute('d', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2');
  svg.appendChild(p1);
  svg.appendChild(p2);
  svg.appendChild(p3);
  return svg;
}

/**
 * Create the empty state icon (document placeholder).
 */
function createEmptyIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('text-[var(--color-text-muted)]', 'opacity-30');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', '14 2 14 8 20 8');
  svg.appendChild(path);
  svg.appendChild(poly);
  return svg;
}
