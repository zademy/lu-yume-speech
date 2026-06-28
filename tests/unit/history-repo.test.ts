import { describe, it, expect, beforeEach } from 'vitest';
import { addEntry, getAll, removeEntry, clearAll } from '../../src/utils/history-repo';
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
});
