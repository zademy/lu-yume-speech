import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '../../src/core/event-bus';
import { TranscriptionApiError } from '../../src/types';
import type { LocalCatalogEntry } from '../../src/utils/local-model-catalog';
import type { EventMap, StatusUpdate, TranscriptionResult } from '../../src/types';
import type { TranscriptionRequest } from '../../src/api/transcription-provider';
import {
  LocalWhisperProvider,
  type InferenceWorkerLike,
} from '../../src/local-models/local-whisper-provider';
import type { WorkerRequest, WorkerResponse } from '../../src/local-models/worker-protocol';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY: LocalCatalogEntry = {
  id: 'whisper-base',
  name: 'Whisper Base',
  family: 'Whisper',
  repo: 'onnx-community/whisper-base',
  revision: 'rev-base',
  dtype: 'q4',
  artifacts: [{ path: 'onnx/encoder_model_q4.onnx', bytes: 100 }],
  downloadBytes: 100,
  languages: ['es', 'en'],
  autoDetectLanguage: true,
  supportsTranslation: true,
  precision: 'basic',
  speed: 'fast',
  memoryTier: 'light',
  backend: 'wasm-compatible',
  license: 'mit',
  licenseUrl: 'https://huggingface.co/onnx-community/whisper-base',
};

const TURBO: LocalCatalogEntry = {
  ...ENTRY,
  id: 'whisper-large-v3-turbo',
  backend: 'webgpu-required',
};

/**
 * Fake inference worker: queues scripted responses and records requests.
 * `autoLoad` makes the load handshake resolve immediately.
 */
class FakeWorker implements InferenceWorkerLike {
  static instances: FakeWorker[] = [];
  posted: WorkerRequest[] = [];
  terminated = false;
  private handler: ((data: unknown) => void) | null = null;
  private readonly autoLoad: boolean;

  constructor(autoLoad = true) {
    this.autoLoad = autoLoad;
    FakeWorker.instances.push(this);
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
    if (this.autoLoad && message.type === 'load') {
      this.respond({ type: 'ready', requestId: message.requestId });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  onMessage(handler: (data: unknown) => void): void {
    this.handler = handler;
  }

  /** Test-side injection of a worker → main message. */
  respond(response: WorkerResponse): void {
    this.handler?.(response);
  }

  /** The last transcribe request posted (helper for assertions). */
  get lastTranscribe(): Extract<WorkerRequest, { type: 'transcribe' }> {
    const found = [...this.posted].reverse().find((m) => m.type === 'transcribe');
    if (!found || found.type !== 'transcribe') throw new Error('no transcribe posted');
    return found;
  }
}

function createProvider(
  over: {
    entry?: LocalCatalogEntry;
    autoLoad?: boolean;
    workerFactory?: () => InferenceWorkerLike | null;
    activeModelId?: string | null;
    ready?: boolean;
    webgpu?: boolean;
  } = {},
) {
  const bus = new EventBus<EventMap>();
  const events: Array<{ event: string; payload: unknown }> = [];
  bus.on('transcription:start', (p) => events.push({ event: 'start', payload: p }));
  bus.on('transcription:success', (p) => events.push({ event: 'success', payload: p }));
  bus.on('transcription:error', (p) => events.push({ event: 'error', payload: p }));
  bus.on('status:change', (p) => events.push({ event: 'status', payload: p }));

  const entry = over.entry ?? ENTRY;
  // NB: the factory creates a fresh fake per call, mirroring a real Worker
  // spawn (the provider caches the instance for as long as it stays alive).
  const provider = new LocalWhisperProvider({
    bus,
    catalog: [entry, TURBO],
    getActiveModelId: () => ('activeModelId' in over ? (over.activeModelId ?? null) : entry.id),
    isModelReady: () => over.ready ?? true,
    hasWebgpu: () => over.webgpu ?? false,
    workerFactory: over.workerFactory ?? (() => new FakeWorker(over.autoLoad ?? true)),
    decoder: async () => ({ audio: new Float32Array([0, 0.5, 1]), duration: 2.5 }),
  });
  return { provider, bus, events };
}

const REQUEST: TranscriptionRequest = {
  mode: 'transcribe',
  model: 'whisper-large-v3-turbo',
  language: 'auto',
  temperature: 0,
  responseFormat: 'json',
};


/** Wait for the n-th (1-based) spawned fake worker to exist, then return it. */
async function awaitWorker(index = 1): Promise<FakeWorker> {
  await vi.waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThanOrEqual(index));
  return FakeWorker.instances[index - 1]!;
}

const blob = () => new Blob(['audio'], { type: 'audio/webm' });

beforeEach(() => {
  FakeWorker.instances = [];
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('LocalWhisperProvider — contract: result', () => {
  it('loads the model then maps the worker result onto TranscriptionResult', async () => {
    const h = createProvider();
    const pending = h.provider.transcribe(blob(), REQUEST);

    // The load handshake happens first; only then can transcription reply.
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted[0]?.type).toBe('load'));
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({
      type: 'result',
      requestId: worker.lastTranscribe.requestId,
      text: ' hola mundo',
    });

    const result = await pending;
    expect(result).toEqual({
      text: ' hola mundo',
      language: undefined, // auto → detection (not surfaced by the worker)
      duration: 2.5,
    });
    expect(h.events.map((e) => e.event)).toContain('start');
    expect(h.events.at(-1)).toMatchObject({ event: 'success' });
  });

  it('passes the resolved language and task to the worker', async () => {
    const h = createProvider();
    const pending = h.provider.transcribe(blob(), {
      ...REQUEST,
      language: 'es',
      mode: 'translate',
    });
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    expect(worker.lastTranscribe.language).toBe('es');
    expect(worker.lastTranscribe.task).toBe('translate');
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'hello' });
    const result = await pending;
    expect(result.language).toBe('es');
  });

  it('reuses the loaded worker for consecutive transcriptions (model stays resident)', async () => {
    const h = createProvider();
    const first = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'uno' });
    await first;

    const second = h.provider.transcribe(blob(), REQUEST);
    await vi.waitFor(() =>
      expect(worker.posted.filter((m) => m.type === 'transcribe').length).toBe(2),
    );
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'dos' });
    await second;

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
  });
});

// ---------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------

describe('LocalWhisperProvider — contract: typed failures', () => {
  it('fails incompatible when no Modelo activo exists', async () => {
    const h = createProvider({ activeModelId: null });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible' },
    });
    expect(h.events.at(-1)?.event).toBe('error');
  });

  it('fails incompatible when the model is not fully downloaded', async () => {
    const h = createProvider({ ready: false });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible' },
    });
  });

  it('fails incompatible when a WebGPU-required model has no WebGPU', async () => {
    const h = createProvider({ entry: TURBO, webgpu: false });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible' },
    });
  });

  it('allows a WebGPU-required model when the adapter probe succeeded', async () => {
    const h = createProvider({ entry: TURBO, webgpu: true });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'ok' });
    await expect(pending).resolves.toMatchObject({ text: 'ok' });
  });

  it('fails incompatible when auto language meets a non-detecting model', async () => {
    const entry = { ...ENTRY, autoDetectLanguage: false };
    const h = createProvider({ entry });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible', message: expect.stringContaining('idioma') },
    });
  });

  it('fails incompatible when translate meets a non-translating model', async () => {
    const entry = { ...ENTRY, supportsTranslation: false };
    const h = createProvider({ entry });
    await expect(
      h.provider.transcribe(blob(), { ...REQUEST, mode: 'translate' }),
    ).rejects.toMatchObject({ detail: { kind: 'incompatible' } });
  });

  it('fails parse when the recording cannot be decoded', async () => {
    const bus = new EventBus<EventMap>();
    const provider = new LocalWhisperProvider({
      bus,
      catalog: [ENTRY],
      getActiveModelId: () => ENTRY.id,
      isModelReady: () => true,
      hasWebgpu: () => false,
      workerFactory: () => new FakeWorker(),
      decoder: async () => {
        throw new Error('boom');
      },
    });
    await expect(provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'parse' },
    });
  });

  it('fails network when the worker factory is unavailable', async () => {
    const h = createProvider({ workerFactory: () => null });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'network' },
    });
  });

  it('fails network when the worker reports a load error and drops the worker', async () => {
    const h = createProvider({ autoLoad: false });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted[0]?.type).toBe('load'));
    const loadRequest = worker.posted[0] as Extract<WorkerRequest, { type: 'load' }>;
    worker.respond({
      type: 'error',
      requestId: loadRequest.requestId,
      message: 'Artefacto no encontrado',
    });
    await expect(pending).rejects.toMatchObject({
      detail: { kind: 'network', message: expect.stringContaining('Artefacto') },
    });
    expect(worker.terminated).toBe(true);
  });

  it('fails when the worker reports a transcribe error but keeps the model resident', async () => {
    const h = createProvider();
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({
      type: 'error',
      requestId: worker.lastTranscribe.requestId,
      message: 'inference blew up',
    });
    await expect(pending).rejects.toMatchObject({ detail: { kind: 'network' } });
    expect(worker.terminated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Abort (hard cancel)
// ---------------------------------------------------------------------------

describe('LocalWhisperProvider — contract: abort', () => {
  it('terminates the worker and rejects cancelled when the external signal fires mid-inference', async () => {
    const h = createProvider();
    const controller = new AbortController();
    const pending = h.provider.transcribe(blob(), REQUEST, controller.signal);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      detail: { kind: 'network', message: 'Transcripción cancelada.' },
    });
    expect(worker.terminated).toBe(true);
  });

  it('a terminated worker is replaced (and the model reloaded) on the next call', async () => {
    const h = createProvider();
    const controller = new AbortController();
    const first = h.provider.transcribe(blob(), REQUEST, controller.signal);
    const workerOne = await awaitWorker(1);
    await vi.waitFor(() =>
      expect(workerOne.posted.some((m) => m.type === 'transcribe')).toBe(true),
    );
    controller.abort();
    await expect(first).rejects.toBeInstanceOf(TranscriptionApiError);

    const second = h.provider.transcribe(blob(), REQUEST);
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(2));
    const workerTwo = await awaitWorker(2);
    // The replacement reloads the pipeline before transcribing.
    await vi.waitFor(() => expect(workerTwo.posted[0]?.type).toBe('load'));
    await vi.waitFor(() =>
      expect(workerTwo.posted.some((m) => m.type === 'transcribe')).toBe(true),
    );
    workerTwo.respond({
      type: 'result',
      requestId: workerTwo.lastTranscribe.requestId,
      text: 'de nuevo',
    });
    await expect(second).resolves.toMatchObject({ text: 'de nuevo' });
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe('LocalWhisperProvider — bus events', () => {
  it('emits transcription:start with the model name and status updates while loading', async () => {
    const h = createProvider({ autoLoad: false });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted[0]?.type).toBe('load'));
    const loadRequest = worker.posted[0] as Extract<WorkerRequest, { type: 'load' }>;
    worker.respond({
      type: 'loading',
      requestId: loadRequest.requestId,
      note: 'Preparando tokenizer.json…',
    });
    worker.respond({ type: 'ready', requestId: loadRequest.requestId });
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    await pending;

    expect(h.events).toContainEqual({ event: 'start', payload: ENTRY.name });
    const statuses = h.events
      .filter((e) => e.event === 'status')
      .map((e) => (e.payload as StatusUpdate).message);
    expect(statuses).toContain('Cargando modelo local…');
    expect(statuses).toContain('Preparando tokenizer.json…');
  });

  it('emits exactly one success and one error per call (no double emission)', async () => {
    const h = createProvider();
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    const result: TranscriptionResult = await pending;

    expect(h.events.filter((e) => e.event === 'success')).toHaveLength(1);
    expect(h.events.filter((e) => e.event === 'error')).toHaveLength(0);
    expect(result.text).toBe('x');
  });
});
