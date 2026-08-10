// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

import * as db from '../../src/db/recordings-db';
import type { HistoryEntry, GeneratedSummary } from '../../src/types';

function entry(id: string, createdAt: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    text: `text-${id}`,
    language: 'es',
    model: 'whisper-large-v3-turbo',
    duration: 60,
    createdAt,
    operationMode: 'transcribe',
    ...extra,
  };
}

function summary(id: string): GeneratedSummary {
  return {
    id,
    summary: `resumen-${id}`,
    keyPoints: ['p'],
    model: 'llama',
    createdAt: Date.now(),
  };
}

describe('recordings-db — grabaciones', () => {
  beforeEach(async () => {
    db.__resetForTests();
    await db.purgeAll();
  });

  it('saves a grabación and lists it newest-first without the blob', async () => {
    const blob = new Blob(['audio-a'], { type: 'audio/webm' });
    await db.saveGrabacion(entry('a', 1000), blob, 'audio/webm');
    await db.saveGrabacion(entry('b', 2000), blob, 'audio/webm');

    const all = await db.getAllGrabaciones();
    expect(all.map((e) => e.id)).toEqual(['b', 'a']);
    expect(all[0]).not.toHaveProperty('audioBytes');
    expect(all[0]).not.toHaveProperty('audioMimeType');
  });

  it('retrieves the stored audio for playback', async () => {
    const blob = new Blob(['audio-a'], { type: 'audio/ogg' });
    await db.saveGrabacion(entry('a', 1000), blob, 'audio/ogg');

    const audio = await db.getAudio('a');
    expect(audio).not.toBeNull();
    expect(audio!.mimeType).toBe('audio/ogg');
    expect(await audio!.blob.text()).toBe('audio-a');
  });

  it('returns null for a missing audio', async () => {
    expect(await db.getAudio('ghost')).toBeNull();
  });

  it('removes a grabación together with its audio', async () => {
    await db.saveGrabacion(entry('a', 1000), new Blob(['x']), 'audio/webm');
    await db.removeGrabacion('a');

    expect(await db.getAllGrabaciones()).toEqual([]);
    expect(await db.getAudio('a')).toBeNull();
  });

  it('clears all grabaciones and audios', async () => {
    await db.saveGrabacion(entry('a', 1), new Blob(['x']), 'audio/webm');
    await db.saveGrabacion(entry('b', 2), new Blob(['y']), 'audio/webm');

    await db.clearGrabaciones();

    expect(await db.getAllGrabaciones()).toEqual([]);
    expect(await db.getAudio('a')).toBeNull();
  });
});

describe('recordings-db — resúmenes', () => {
  beforeEach(async () => {
    db.__resetForTests();
    await db.purgeAll();
  });

  it('creates a history on first summary and appends on the second', async () => {
    const h1 = await db.addSummary('texto', summary('s1'));
    expect(h1.summaries.map((s) => s.id)).toEqual(['s1']);

    const h2 = await db.addSummary('texto', summary('s2'));
    expect(h2.id).toBe(h1.id);
    expect(h2.summaries.map((s) => s.id)).toEqual(['s1', 's2']);

    expect(await db.countResumenes()).toBe(1);
  });

  it('looks up a history by its exact source text', async () => {
    await db.addSummary('texto', summary('s1'));

    expect((await db.getSummaryHistoryBySource('texto'))?.id).toBeDefined();
    expect(await db.getSummaryHistoryBySource('otro')).toBeUndefined();
  });

  it('removes a single summary and drops the history when empty', async () => {
    const h = await db.addSummary('texto', summary('s1'));
    await db.addSummary('texto', summary('s2'));

    const afterFirst = await db.removeSummary(h.id, 's1');
    expect(afterFirst?.summaries.map((s) => s.id)).toEqual(['s2']);

    const afterLast = await db.removeSummary(h.id, 's2');
    expect(afterLast).toBeUndefined();
    expect(await db.countResumenes()).toBe(0);
  });

  it('clears all resúmenes', async () => {
    await db.addSummary('a', summary('s1'));
    await db.addSummary('b', summary('s2'));

    await db.clearResumenes();

    expect(await db.countResumenes()).toBe(0);
  });
});

describe('recordings-db — purge + storage', () => {
  beforeEach(async () => {
    db.__resetForTests();
    await db.purgeAll();
  });

  it('purge wipes grabaciones, audios and resúmenes together', async () => {
    await db.saveGrabacion(entry('a', 1), new Blob(['x']), 'audio/webm');
    await db.addSummary('texto', summary('s1'));

    await db.purgeAll();

    expect(await db.getAllGrabaciones()).toEqual([]);
    expect(await db.getAudio('a')).toBeNull();
    expect(await db.countResumenes()).toBe(0);
  });

  it('storage estimate degrades to zeros without the Storage API', async () => {
    const est = await db.getStorageEstimate();
    expect(est).toEqual({ usage: 0, quota: 0 });
  });

  it('storage estimate reads navigator.storage.estimate when present', async () => {
    const original = (globalThis as { navigator?: Navigator }).navigator;
    const fakeNavigator = {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 1234, quota: 5678 }),
        persist: vi.fn().mockResolvedValue(true),
      },
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: fakeNavigator,
      configurable: true,
      writable: true,
    });

    try {
      const est = await db.getStorageEstimate();
      expect(est).toEqual({ usage: 1234, quota: 5678 });
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it('persist returns false when the API is unavailable', async () => {
    expect(await db.requestPersistentStorage()).toBe(false);
  });
});
