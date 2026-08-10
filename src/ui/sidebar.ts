/**
 * Transcription history panel.
 *
 * Owns rendering and incremental updates for the history list shown in Inicio.
 */

import type { HistoryEntry } from '../types';
import { createHistoryCard, disposeHistoryCard } from './history-card';

export interface SidebarElements {
  list: HTMLDivElement;
  emptyState: HTMLElement;
  clearAllBtn: HTMLButtonElement;
  countDisplay: HTMLSpanElement;
  _onRestore: (id: string) => void;
  _onDelete: (id: string) => void;
  _onCopy: (id: string) => void;
}

/** Bind the Inicio history list to application callbacks. */
export function createSidebar(
  list: HTMLDivElement,
  emptyState: HTMLElement,
  clearAllBtn: HTMLButtonElement,
  countDisplay: HTMLSpanElement,
  onRestore: (id: string) => void,
  onDelete: (id: string) => void,
  onCopy: (id: string) => void,
  onClear: () => void,
): SidebarElements {
  clearAllBtn.addEventListener('click', () => {
    if (confirm('¿Eliminar todo el historial?')) onClear();
  });

  return {
    list,
    emptyState,
    clearAllBtn,
    countDisplay,
    _onRestore: onRestore,
    _onDelete: onDelete,
    _onCopy: onCopy,
  };
}

/** Replace the visible list with the supplied newest-first entries. */
export function populateEntries(elements: SidebarElements, entries: HistoryEntry[]): void {
  elements.list.querySelectorAll<HTMLElement>('[data-history-card]').forEach((card) => {
    disposeHistoryCard(card);
    card.remove();
  });
  elements.emptyState.hidden = entries.length > 0;
  for (const entry of entries) {
    elements.list.appendChild(createCard(elements, entry));
  }
  elements.countDisplay.textContent = String(entries.length);
}

function createCard(elements: SidebarElements, entry: HistoryEntry): HTMLElement {
  const card = createHistoryCard(entry, elements._onRestore, elements._onDelete, elements._onCopy);
  card.setAttribute('data-history-card', entry.id);
  return card;
}
