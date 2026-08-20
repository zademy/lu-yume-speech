/**
 * Privacy guarantees for Método Local (spec T7):
 *
 *  1. A local transcription never causes network egress — audio decode is
 *     OfflineAudioContext (no fetch), inference runs in the worker over
 *     postMessage, and the weights env.fetch only ever targets the approved
 *     host (huggingface.co) or the same origin.
 *  2. The LLM post-processor stays off for local transcriptions until the
 *     user explicitly authorizes sending the TEXT.
 *  3. Existing users migrate friction-free: Remote stays the initial
 *     method, no local downloads start on boot, credentials untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '../../src/core/event-bus';
import { artifactUrl } from '../../src/local-models/artifact-store';
import {
  LocalDownloadEngine,
  type ArtifactStorePort,
  type LocalModelRecord,
  type LogicalStateStorePort,
  type StorageAdvisorPort,
} from '../../src/local-models/download-engine';
import {
  LocalWhisperProvider,
  type InferenceWorkerLike,
} from '../../src/local-models/local-whisper-provider';
import type { WorkerRequest } from '../../src/local-models/worker-protocol';
import { DEFAULT_SETTINGS, type EventMap } from '../../src/types';
import type { LocalCatalogEntry } from '../../src/utils/local-model-catalog';
import { shouldRunLlmPostProcess } from '../../src/utils/transcription-config';
import { LOCAL_MODEL_CATALOG } from '../../src/utils/local-model-catalog';

// ---------------------------------------------------------------------------
// Fixtures (slim local equivalents of the provider-test fakes)
// ---------------------------------------------------------------------------

const ENTRY: LocalCatalogEntry = {
  id: 'whisper-base',
  name: 'Whisper Base',
  family: 'Whisper',
  repo: 'onnx-community/whisper-base',
  revision: 'rev-base',
  dtype: 'q4',
  artifacts: [{ path: 'onnx/encoder.onnx', bytes: 10 }],
  downloadBytes: 10,
  languages: ['es', 'en'],
  autoDetectLanguage: true,
  supportsTranslation: true,
  precision: 'basic',
  speed: 'fast',
  memoryTier: 'light',
  backend: 'wasm-compatible',
  license: 'mit',
  licenseUrl: 'https://huggingface.co/x',
};

class MinimalWorker implements InferenceWorkerLike {
  private handler: ((data: unknown) => void) | null = null;
  onMessage(handler: (data: unknown) => void): void {
    this.handler = handler;
  }
  postMessage(message: WorkerRequest): void {
    if (message.type === 'load') {
      queueMicrotask(() =>
        this.handler?.({ type: 'ready', requestId: message.requestId, backend: 'wasm' }),
      );
      return;
    }
    if (message.type === 'transcribe') {
      queueMicrotask(() =>
        this.handler?.({ type: 'result', requestId: message.requestId, text: 'hola' }),
      );
    }
  }
  terminate(): void {
    /* no-op */
  }
}

describe('local transcription causes zero network egress', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a full local run (decode → load → transcribe) never calls fetch', async () => {
    const bus = new EventBus<EventMap>();
    const provider = new LocalWhisperProvider({
      bus,
      catalog: [ENTRY],
      getActiveModelId: () => ENTRY.id,
      isModelReady: () => true,
      hasWebgpu: () => false,
      getBackendPolicy: () => 'auto',
      getDeviceMemoryGb: () => null,
      workerFactory: () => new MinimalWorker(),
      decoder: async () => ({ audio: new Float32Array([0, 0.5]), duration: 1 }),
    });

    const result = await provider.transcribe(new Blob([new Uint8Array([1, 2, 3])]), {
      mode: 'transcribe',
      model: 'whisper-large-v3-turbo',
      language: 'auto',
      temperature: 0,
    });

    expect(result.text).toBe('hola');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('artifact URLs only ever target the approved huggingface.co host', () => {
    for (const entry of LOCAL_MODEL_CATALOG) {
      for (const artifact of entry.artifacts) {
        const url = artifactUrl(entry.repo, entry.revision, artifact.path);
        expect(url.startsWith('https://huggingface.co/')).toBe(true);
      }
    }
  });
});

describe('LLM post-process privacy gate', () => {
  it('never runs for local transcriptions without explicit authorization', () => {
    expect(
      shouldRunLlmPostProcess({ enableLlmPostProcess: true, localLlmAuthorized: false }, 'local'),
    ).toBe(false);
  });

  it('runs for local only after the explicit text-egress authorization', () => {
    expect(
      shouldRunLlmPostProcess({ enableLlmPostProcess: true, localLlmAuthorized: true }, 'local'),
    ).toBe(true);
  });

  it('keeps the plain toggle behaviour for remote methods', () => {
    expect(
      shouldRunLlmPostProcess({ enableLlmPostProcess: true, localLlmAuthorized: false }, 'remote'),
    ).toBe(true);
    expect(
      shouldRunLlmPostProcess({ enableLlmPostProcess: false, localLlmAuthorized: true }, 'remote'),
    ).toBe(false);
  });
});

describe('existing-user migration (friction-free)', () => {
  it('legacy stored settings merge to Remote defaults with local fields inert', () => {
    // A pre-local snapshot: no transcriptionMethod, no local keys at all.
    const legacyStored = {
      appLanguage: 'es',
      model: 'whisper-large-v3-turbo',
      prompt: '',
      temperature: 0,
    } as unknown as Record<string, unknown>;

    const merged = { ...DEFAULT_SETTINGS, ...legacyStored };

    // Remote is the initial method; nothing local is pre-selected.
    expect(merged.transcriptionMethod).toBe('remote');
    expect(merged.localModelId).toBeNull();
    expect(merged.localBackend).toBe('auto');
    // The remote provider and credentials live outside settings and are
    // never touched by the merge.
    expect(merged.transcriptionProvider).toBe('groq');
  });

  it('startup (engine init) never starts a download', async () => {
    const bus = new EventBus<EventMap>();
    const artifacts: ArtifactStorePort = {
      hasArtifact: async () => false,
      storeArtifact: async () => {
        throw new Error('no download may start on boot');
      },
      deleteArtifacts: async () => undefined,
    };
    const states: LogicalStateStorePort = {
      get: async () => null,
      put: async () => undefined,
    };
    const storage: StorageAdvisorPort = {
      estimate: async () => null,
      persisted: async () => null,
      requestPersistence: async () => null,
    };
    const engine = new LocalDownloadEngine({
      catalog: [ENTRY],
      artifacts,
      states,
      storage,
      bus,
    });
    await engine.init();
    const record: LocalModelRecord | null = engine.getRecord(ENTRY.id);
    expect(record).toMatchObject({ state: 'not-downloaded' });
    expect(engine.activeModelId).toBeNull();
  });
});
