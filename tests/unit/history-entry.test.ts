import { describe, expect, it } from 'vitest';

import { buildHistoryEntry } from '../../src/utils/history-entry';
import { DEFAULT_SETTINGS, CLOUDFLARE_WHISPER_MODEL } from '../../src/types';
import type { TranscriptionResult } from '../../src/types';

const baseOptions = {
  model: 'whisper-large-v3-turbo' as const,
  temperature: 0,
  responseFormat: 'json' as const,
};

const result: TranscriptionResult = { text: 'hola', language: 'es', duration: 2 };

describe('buildHistoryEntry — local provenance', () => {
  it('stamps method, model id, revision and effective backend from the result provenance', () => {
    const entry = buildHistoryEntry({
      config: { ...DEFAULT_SETTINGS, transcriptionMethod: 'local', localModelId: 'whisper-base' },
      options: baseOptions,
      result: {
        ...result,
        provenance: {
          modelId: 'whisper-base',
          revision: 'rev-abc',
          backend: 'webgpu',
        },
      },
      text: 'hola',
      mode: 'transcribe',
      now: 1_000,
    });

    expect(entry.method).toBe('local');
    expect(entry.localModelId).toBe('whisper-base');
    expect(entry.localModelRevision).toBe('rev-abc');
    expect(entry.backend).toBe('webgpu');
    expect(entry.provider).toBeUndefined();
    expect(entry.language).toBe('es');
    expect(entry.operationMode).toBe('transcribe');
    expect(entry.createdAt).toBe(1_000);
  });

  it('falls back to the configured active model when provenance is absent', () => {
    const entry = buildHistoryEntry({
      config: { ...DEFAULT_SETTINGS, transcriptionMethod: 'local', localModelId: 'whisper-small' },
      options: baseOptions,
      result,
      text: 'hola',
      mode: 'transcribe',
      now: 1_000,
    });

    expect(entry.localModelId).toBe('whisper-small');
    expect(entry.localModelRevision).toBeUndefined();
    expect(entry.backend).toBeUndefined();
  });
});

describe('buildHistoryEntry — remote provenance', () => {
  it('Groq stays implicit (no provider field)', () => {
    const entry = buildHistoryEntry({
      config: DEFAULT_SETTINGS,
      options: baseOptions,
      result,
      text: 'hello',
      mode: 'transcribe',
      now: 1_000,
    });

    expect(entry.method).toBe('remote');
    expect(entry.provider).toBeUndefined();
    expect(entry.model).toBe('whisper-large-v3-turbo');
    expect(entry.localModelId).toBeUndefined();
  });

  it('the worker entry carries its fixed model and provider', () => {
    const entry = buildHistoryEntry({
      config: {
        ...DEFAULT_SETTINGS,
        transcriptionProvider: 'cloudflare-whisper',
      },
      options: baseOptions,
      result,
      text: 'hello',
      mode: 'translate',
      now: 1_000,
    });

    expect(entry.provider).toBe('cloudflare-whisper');
    expect(entry.model).toBe(CLOUDFLARE_WHISPER_MODEL);
    expect(entry.operationMode).toBe('translate');
  });
});
