import { describe, it, expect, beforeEach } from 'vitest';
import { addEntry, getAll, getById, removeEntry, clearAll } from '../../src/utils/history-repo';
import type { HistoryEntry } from '../../src/types';

const entry = (i: number): HistoryEntry => ({
  id: `id-${i}`,
  text: `text-${i}`,
  language: 'es',
  model: 'whisper-large-v3-turbo',
  createdAt: 1_700_000_000_000 + i,
  operationMode: 'transcribe',
});

describe('history-repo', () => {
  beforeEach(() => localStorage.clear());

  it('addEntry stores and getAll returns sorted (newest first)', () => {
    addEntry(entry(1));
    addEntry(entry(2));
    const all = getAll();
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe('id-2');
  });

  it('FIFO evicts oldest beyond HISTORY_MAX_ENTRIES (100)', () => {
    for (let i = 0; i < 105; i++) addEntry(entry(i));
    const all = getAll();
    expect(all).toHaveLength(100);
    expect(all.some((e) => e.id === 'id-0')).toBe(false);
    expect(all.some((e) => e.id === 'id-104')).toBe(true);
  });

  it('removeEntry deletes by id and returns true', () => {
    addEntry(entry(1));
    expect(removeEntry('id-1')).toBe(true);
    expect(getAll()).toHaveLength(0);
  });

  it('removeEntry returns false for unknown id', () => {
    expect(removeEntry('nonexistent')).toBe(false);
  });

  it('clearAll empties the list', () => {
    addEntry(entry(1));
    addEntry(entry(2));
    clearAll();
    expect(getAll()).toHaveLength(0);
  });

  it('survives corrupt stored data (returns empty)', () => {
    localStorage.setItem('stt_history', 'corrupt{');
    expect(getAll()).toEqual([]);
  });

  it('getById finds existing entry', () => {
    addEntry(entry(1));
    addEntry(entry(2));
    const found = getById('id-2');
    expect(found).toBeDefined();
    expect(found?.text).toBe('text-2');
  });

  it('getById returns undefined for unknown id', () => {
    addEntry(entry(1));
    expect(getById('nonexistent')).toBeUndefined();
  });

  it('eviction finds oldest when it is not at index 0', () => {
    // Add entries with reverse timestamps so oldest is last, not first.
    // This exercises the inner-loop comparison that updates oldestIdx.
    for (let i = 100; i >= 0; i--) {
      addEntry({
        id: `rev-${i}`,
        text: `rev-text-${i}`,
        language: 'es',
        model: 'whisper-large-v3-turbo',
        createdAt: 1_700_000_000_000 + i,
        operationMode: 'transcribe',
      });
    }
    const all = getAll();
    expect(all).toHaveLength(100);
    // The entry with the smallest timestamp (rev-0, createdAt=1_700_000_000_000) should be evicted
    expect(all.some((e) => e.id === 'rev-0')).toBe(false);
    // The entry with the largest timestamp (rev-100) should remain
    expect(all.some((e) => e.id === 'rev-100')).toBe(true);
  });
});
