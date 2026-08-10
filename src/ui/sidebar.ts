/**
 * Transcription history panel.
 *
 * Owns rendering and incremental updates for the history list shown in Home.
 * Language-aware: cards are rebuilt with the active `AppLanguage`, so switching
 * the interface language re-renders the list on the next `populateEntries`.
 */

import type { AppLanguage, HistoryEntry } from '../types';
import { translate } from '../i18n/translations';
import { createHistoryCard, disposeHistoryCard } from './history-card';

export interface SidebarElements {
  list: HTMLDivElement;
  emptyState: HTMLElement;
  clearAllBtn: HTMLButtonElement;
  countDisplay: HTMLSpanElement;
  _onRestore: (id: string) => void;
  _onDelete: (id: string) => void;
  _onCopy: (id: string) => void;
  _lang: AppLanguage;
}

/** Bind the Home history list to application callbacks. */
export function createSidebar(
  list: HTMLDivElement,
  emptyState: HTMLElement,
  clearAllBtn: HTMLButtonElement,
  countDisplay: HTMLSpanElement,
  onRestore: (id: string) => void,
  onDelete: (id: string) => void,
  onCopy: (id: string) => void,
  onClear: () => void,
  lang: AppLanguage,
): SidebarElements {
  const elements: SidebarElements = {
    list,
    emptyState,
    clearAllBtn,
    countDisplay,
    _onRestore: onRestore,
    _onDelete: onDelete,
    _onCopy: onCopy,
    _lang: lang,
  };

  clearAllBtn.addEventListener('click', () => {
    if (confirm(translate(elements._lang, 'history.clearConfirm'))) onClear();
  });

  return elements;
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
  const card = createHistoryCard(
    entry,
    elements._onRestore,
    elements._onDelete,
    elements._onCopy,
    elements._lang,
  );
  card.setAttribute('data-history-card', entry.id);
  return card;
}
