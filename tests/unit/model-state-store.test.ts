import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import type { LocalModelRecord } from '../../src/local-models/download-engine';
import {
  __resetLocalModelStatesForTests,
  logicalStateStore,
} from '../../src/local-models/model-state-store';

function sampleRecord(modelId: string, state: LocalModelRecord['state']): LocalModelRecord {
  return {
    modelId,
    state,
    revision: 'abc123',
    receivedBytes: 10,
    totalBytes: 100,
    verified: state === 'downloaded',
    updatedAt: 12345,
  };
}

afterEach(() => {
  __resetLocalModelStatesForTests();
});

describe('logicalStateStore', () => {
  it('round-trips a record by model id', async () => {
    const record = sampleRecord('whisper-base', 'partial');
    await logicalStateStore.put(record);

    expect(await logicalStateStore.get('whisper-base')).toEqual(record);
  });

  it('overwrites the previous record on put (latest wins)', async () => {
    await logicalStateStore.put(sampleRecord('whisper-small', 'downloading'));
    await logicalStateStore.put(sampleRecord('whisper-small', 'downloaded'));

    const stored = await logicalStateStore.get('whisper-small');
    expect(stored?.state).toBe('downloaded');
    expect(stored?.verified).toBe(true);
  });

  it('returns null for a model without a record', async () => {
    expect(await logicalStateStore.get('never-seen')).toBeNull();
  });

  it('keeps models independent (no cross-contamination)', async () => {
    await logicalStateStore.put(sampleRecord('whisper-base', 'partial'));
    await logicalStateStore.put(sampleRecord('whisper-large-v3-turbo', 'downloaded'));

    expect((await logicalStateStore.get('whisper-base'))?.state).toBe('partial');
    expect((await logicalStateStore.get('whisper-large-v3-turbo'))?.state).toBe('downloaded');
  });
});
