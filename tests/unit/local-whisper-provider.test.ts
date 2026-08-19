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
  private readonly readyBackend: 'webgpu' | 'wasm';

  constructor(autoLoad = true, readyBackend: 'webgpu' | 'wasm' = 'wasm') {
    this.autoLoad = autoLoad;
    this.readyBackend = readyBackend;
    FakeWorker.instances.push(this);
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
    if (this.autoLoad && message.type === 'load') {
      this.respond({ type: 'ready', requestId: message.requestId, backend: this.readyBackend });
    }
  }

  /** The last load request posted (helper for backend-plan assertions). */
  get lastLoad(): Extract<WorkerRequest, { type: 'load' }> {
    const found = [...this.posted].reverse().find((m) => m.type === 'load');
    if (!found || found.type !== 'load') throw new Error('no load posted');
    return found;
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
    policy?: 'auto' | 'wasm';
    deviceMemoryGb?: number | null;
    effectiveBackend?: 'webgpu' | 'wasm';
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
    getBackendPolicy: () => over.policy ?? 'auto',
    getDeviceMemoryGb: () => ('deviceMemoryGb' in over ? (over.deviceMemoryGb ?? null) : null),
    workerFactory:
      over.workerFactory ??
      (() => new FakeWorker(over.autoLoad ?? true, over.effectiveBackend ?? 'wasm')),
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
      provenance: { modelId: ENTRY.id, revision: ENTRY.revision, backend: 'wasm' },
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
      getBackendPolicy: () => 'auto',
      getDeviceMemoryGb: () => null,
      workerFactory: () => new FakeWorker(true, 'wasm'),
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
      detail: { kind: 'network', message: expect.stringContaining('cancelada por completo') },
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

describe('LocalWhisperProvider — backend selection (T5)', () => {
  it('plans webgpu→wasm attempts for a wasm-compatible model under auto with WebGPU', async () => {
    const h = createProvider({ webgpu: true });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'load')).toBe(true));
    expect(worker.lastLoad.backends).toEqual(['webgpu', 'wasm']);
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    await pending;
  });

  it('plans wasm only without a WebGPU adapter', async () => {
    const h = createProvider({ webgpu: false });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'load')).toBe(true));
    expect(worker.lastLoad.backends).toEqual(['wasm']);
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    await pending;
  });

  it('force-WASM plans a single wasm attempt', async () => {
    const h = createProvider({ webgpu: true, policy: 'wasm' });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'load')).toBe(true));
    expect(worker.lastLoad.backends).toEqual(['wasm']);
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    await pending;
  });

  it('refuses a webgpu-required model without WebGPU with the clear message', async () => {
    const h = createProvider({ entry: TURBO, webgpu: false });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible', message: expect.stringContaining('requiere WebGPU') },
    });
  });

  it('refuses force-WASM on a model that does not permit WASM', async () => {
    const h = createProvider({ entry: TURBO, webgpu: true, policy: 'wasm' });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible', message: expect.stringContaining('no admite CPU') },
    });
  });

  it('captures the effective backend and stamps it in the result provenance', async () => {
    const h = createProvider({ webgpu: true, effectiveBackend: 'webgpu' });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'hola' });
    const result = await pending;

    expect(result.provenance).toEqual({
      modelId: ENTRY.id,
      revision: ENTRY.revision,
      backend: 'webgpu',
    });
    expect(h.provider.getResident()).toEqual({ modelId: ENTRY.id, backend: 'webgpu' });
  });
});

describe('LocalWhisperProvider — memory management (T5)', () => {
  it('emits localModel:memory on load and on release; release keeps nothing resident', async () => {
    const h = createProvider();
    const memoryEvents: unknown[] = [];
    h.bus.on('localModel:memory', (event) => memoryEvents.push(event));

    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    await pending;
    expect(memoryEvents).toContainEqual({ modelId: ENTRY.id, backend: 'wasm' });

    h.provider.release();
    expect(h.provider.getResident()).toBeNull();
    expect(worker.terminated).toBe(true);
    expect(memoryEvents.at(-1)).toEqual({ modelId: null, backend: null });
  });

  it('release is a no-op when nothing is resident (no spurious event)', () => {
    const h = createProvider();
    const memoryEvents: unknown[] = [];
    h.bus.on('localModel:memory', (event) => memoryEvents.push(event));

    h.provider.release();

    expect(memoryEvents).toEqual([]);
  });

  it('a memory-looking inference failure frees the resident model', async () => {
    const h = createProvider();
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({
      type: 'error',
      requestId: worker.lastTranscribe.requestId,
      message: 'WebGPU: out of memory during allocation',
    });
    await expect(pending).rejects.toMatchObject({ detail: { kind: 'network' } });

    expect(worker.terminated).toBe(true);
    expect(h.provider.getResident()).toBeNull();
  });

  it('an ordinary inference failure keeps the model resident', async () => {
    const h = createProvider();
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({
      type: 'error',
      requestId: worker.lastTranscribe.requestId,
      message: 'tokenizer glitch',
    });
    await expect(pending).rejects.toMatchObject({ detail: { kind: 'network' } });

    expect(worker.terminated).toBe(false);
    expect(h.provider.getResident()).toEqual({ modelId: ENTRY.id, backend: 'wasm' });
  });

  it('memory-tier block refuses the load with an incompatible error', async () => {
    const heavy = { ...ENTRY, memoryTier: 'very-high' as const };
    const h = createProvider({ entry: heavy, deviceMemoryGb: 2 });
    await expect(h.provider.transcribe(blob(), REQUEST)).rejects.toMatchObject({
      detail: { kind: 'incompatible', message: expect.stringContaining('memoria') },
    });
  });

  it('memory-tier warn emits a warning status but proceeds', async () => {
    const heavy = { ...ENTRY, memoryTier: 'high' as const };
    const h = createProvider({ entry: heavy, deviceMemoryGb: 2 });
    const pending = h.provider.transcribe(blob(), REQUEST);
    const worker = await awaitWorker();
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'transcribe')).toBe(true));
    worker.respond({ type: 'result', requestId: worker.lastTranscribe.requestId, text: 'x' });
    await expect(pending).resolves.toMatchObject({ text: 'x' });

    const statuses = h.events
      .filter((e) => e.event === 'status')
      .map((e) => (e.payload as StatusUpdate).message);
    expect(statuses.some((message) => message.includes('poca memoria'))).toBe(true);
  });
});

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
    worker.respond({ type: 'ready', requestId: loadRequest.requestId, backend: 'wasm' });
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
