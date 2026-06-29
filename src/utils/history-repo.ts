/**
 * History repository — CRUD operations over localStorage.
 *
 * Manages a bounded list of transcription history entries.
 * FIFO eviction when HISTORY_MAX_ENTRIES is exceeded.
 *
 * SRP: This module's only job is persisting history entries.
 * DIP: Consumers depend on these functions, not on localStorage directly.
 */

import type { HistoryEntry } from '../types';
import { HISTORY_MAX_ENTRIES, HISTORY_ENTRIES_KEY } from '../types';
import { load, save } from './storage';

/** Read all history entries sorted by creation date (newest first). */
export function getAll(): HistoryEntry[] {
  const entries = load<HistoryEntry[]>(HISTORY_ENTRIES_KEY, []);
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Add a new entry. Evicts the oldest entries if the cap is exceeded.
 *  Returns the IDs of evicted entries (for cascading audio cleanup). */
export function addEntry(entry: HistoryEntry): string[] {
  const entries = load<HistoryEntry[]>(HISTORY_ENTRIES_KEY, []);
  entries.push(entry);

  const evictedIds: string[] = [];

  // FIFO eviction — remove oldest entries beyond the cap
  while (entries.length > HISTORY_MAX_ENTRIES) {
    let oldestIdx = 0;
    for (let i = 1; i < entries.length; i++) {
      const current = entries[i];
      const oldest = entries[oldestIdx];
      if (current && oldest && current.createdAt < oldest.createdAt) {
        oldestIdx = i;
      }
    }
    const evicted = entries[oldestIdx];
    if (evicted) evictedIds.push(evicted.id);
    entries.splice(oldestIdx, 1);
  }

  save(HISTORY_ENTRIES_KEY, entries);
  return evictedIds;
}

/** Remove a single entry by ID. Returns true if found and removed. */
export function removeEntry(id: string): boolean {
  const entries = load<HistoryEntry[]>(HISTORY_ENTRIES_KEY, []);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  save(HISTORY_ENTRIES_KEY, entries);
  return true;
}

/** Remove all history entries. */
export function clearAll(): void {
  save(HISTORY_ENTRIES_KEY, []);
}

/** Find a single entry by ID. Returns undefined if not found. */
export function getById(id: string): HistoryEntry | undefined {
  const entries = load<HistoryEntry[]>(HISTORY_ENTRIES_KEY, []);
  return entries.find((e) => e.id === id);
}
