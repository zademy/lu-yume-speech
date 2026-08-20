/**
 * Diagnostics runner contract (spec T8): aggregation is pure, the corpus
 * manifest loads same-origin, and the worker loop measures load + per-clip
 * inference and computes WER against the ground truth — with the worker
 * terminated afterwards and user audio never involved.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  aggregateMeasurements,
  loadCorpusManifest,
  runModelDiagnostics,
  type CorpusManifest,
} from '../../src/local-models/diagnostics';
import type { LocalCatalogEntry } from '../../src/utils/local-model-catalog';
import type { WorkerRequest, WorkerResponse } from '../../src/local-models/worker-protocol';
import type { InferenceWorkerLike } from '../../src/local-models/local-whisper-provider';

const ENTRY: LocalCatalogEntry = {
  id: 'whisper-base',
  name: 'Whisper Base',
  family: 'Whisper',
  repo: 'onnx-community/whisper-base',
  revision: 'rev',
  dtype: 'q4',
  artifacts: [{ path: 'a.onnx', bytes: 1 }],
  downloadBytes: 1,
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

const CORPUS: CorpusManifest = {
  corpusVersion: 1,
  entries: [
    {
      id: 'es-1',
      file: 'es-1.wav',
      language: 'es',
      condition: 'clean',
      durationHint: 'short',
      text: 'hola mundo',
    },
    {
      id: 'en-1',
      file: 'en-1.wav',
      language: 'en',
      condition: 'noisy',
      durationHint: 'long',
      text: 'hello world',
    },
  ],
};

describe('aggregateMeasurements', () => {
  it('aggregates per-language and global WER, load, RTF', () => {
    const measurement = aggregateMeasurements(
      'whisper-base',
      'wasm',
      1,
      1200,
      [
        { language: 'es', audioSeconds: 10, inferenceMs: 4000, wer: 0.1 },
        { language: 'en', audioSeconds: 30, inferenceMs: 6000, wer: 0.2 },
        { language: 'en', audioSeconds: 10, inferenceMs: 2000, wer: 0.4 },
      ],
      12345,
    );
    expect(measurement.clips).toBe(3);
    expect(measurement.languageWer?.es).toBeCloseTo(0.1);
    expect(measurement.languageWer?.en).toBeCloseTo(0.3);
    expect(measurement.globalWer).toBeCloseTo((0.1 + 0.2 + 0.4) / 3);
    expect(measurement.loadMs).toBe(1200);
    expect(measurement.audioSeconds).toBe(50);
    expect(measurement.inferenceSeconds).toBeCloseTo(12);
    expect(measurement.rtf).toBeCloseTo(12 / 50);
    expect(measurement.peakMemoryBytes).toBe(12345);
  });

  it('omits peak memory when unobservable and guards zero audio', () => {
    const measurement = aggregateMeasurements('m', 'wasm', 1, 0, []);
    expect(measurement.peakMemoryBytes).toBeUndefined();
    expect(measurement.rtf).toBe(0);
  });
});

describe('loadCorpusManifest', () => {
  it('rejects non-OK responses and empty corpora', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(loadCorpusManifest(failing as unknown as typeof fetch)).rejects.toThrow(
      /no disponible/,
    );

    const empty = vi.fn(
      async () => new Response(JSON.stringify({ corpusVersion: 1, entries: [] }), { status: 200 }),
    );
    await expect(loadCorpusManifest(empty as unknown as typeof fetch)).rejects.toThrow(/vacío/);
  });
});

/**
 * Scripted worker: ready (after a loading note) on load, fixed text per
 * transcribe. Mirrors the real protocol shape including the loading note.
 */
class FakeDiagWorker implements InferenceWorkerLike {
  terminated = false;
  posted: WorkerRequest[] = [];
  private handler: ((data: unknown) => void) | null = null;
  private readonly hyp: string;
  /** When set, transcribes fail with this message instead. */
  transcribeError: string | null = null;

  constructor(hyp: string) {
    this.hyp = hyp;
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
    if (message.type === 'load') {
      queueMicrotask(() =>
        this.handler?.({ type: 'loading', requestId: message.requestId, note: 'cargando…' }),
      );
      queueMicrotask(() => {
        const response: WorkerResponse = {
          type: 'ready',
          requestId: message.requestId,
          backend: 'wasm',
        };
        this.handler?.(response);
      });
      return;
    }
    if (message.type === 'transcribe') {
      queueMicrotask(() => {
        const response: WorkerResponse = this.transcribeError
          ? { type: 'error', requestId: message.requestId, message: this.transcribeError }
          : { type: 'result', requestId: message.requestId, text: this.hyp };
        this.handler?.(response);
      });
    }
  }

  onMessage(handler: (data: unknown) => void): void {
    this.handler = handler;
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Deterministic 100 ms-per-call wall clock. */
function makeTickClock(): () => number {
  let t = 0;
  return () => {
    t += 100;
    return t;
  };
}

function makeDeps(worker: FakeDiagWorker) {
  return {
    backends: ['wasm'] as const,
    fetchClip: async () => new Blob([new Uint8Array(4)]),
    workerFactory: ((): InferenceWorkerLike => worker) as () => InferenceWorkerLike,
    now: makeTickClock(),
  };
}

// audio-decode runs OfflineAudioContext — stub it for the unit run.
vi.mock('../../src/local-models/audio-decode', () => ({
  decodeAudioTo16kMono: async () => ({ audio: new Float32Array(16), duration: 5 }),
}));

describe('runModelDiagnostics', () => {
  it('waits past loading notes, measures clips, computes WER, terminates', async () => {
    const worker = new FakeDiagWorker('hola mundo');
    const run = await runModelDiagnostics(ENTRY, CORPUS, makeDeps(worker));
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.effectiveBackend).toBe('wasm');
    expect(run.measurement.clips).toBe(2);
    // Both clips transcribe to 'hola mundo': es WER 0, en WER 1.
    expect(run.measurement.languageWer?.es).toBe(0);
    expect(run.measurement.languageWer?.en).toBe(1);
    expect(run.measurement.globalWer).toBeCloseTo(0.5);
    // One load + one transcribe per clip, and the worker died afterwards.
    expect(worker.posted.filter((m) => m.type === 'load')).toHaveLength(1);
    expect(worker.posted.filter((m) => m.type === 'transcribe')).toHaveLength(2);
    expect(worker.terminated).toBe(true);
  });

  it('fails cleanly when the worker cannot be created', async () => {
    const run = await runModelDiagnostics(ENTRY, CORPUS, {
      ...makeDeps(new FakeDiagWorker('x')),
      workerFactory: () => null,
    });
    expect(run.ok).toBe(false);
  });

  it('fails cleanly on worker errors', async () => {
    const worker = new FakeDiagWorker('x');
    worker.transcribeError = 'boom';
    const run = await runModelDiagnostics(ENTRY, CORPUS, makeDeps(worker));
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error.message).toBe('boom');
    expect(worker.terminated).toBe(true);
  });
});
