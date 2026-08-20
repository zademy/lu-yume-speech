/**
 * Local model diagnostics — the on-device benchmark runner (spec T8).
 *
 * Single responsibility: run the versioned corpus (served same-origin from
 * /benchmark-corpus) through one downloaded model in a dedicated worker,
 * measure load/inference/RTF/WER per clip, aggregate into a
 * BenchmarkMeasurement, and leave persistence + export to the caller.
 * NO telemetry: results stay in the device (modelPerf table) until the
 * user exports them manually. User audio is never measured — only the
 * committed corpus.
 */

import type { BenchmarkMeasurement } from '../utils/benchmark/manifest';
import type { LocalBackend } from '../types';
import type { LocalCatalogEntry } from '../utils/local-model-catalog';
import { wordErrorRate } from '../utils/benchmark/wer';
import { decodeAudioTo16kMono } from './audio-decode';
import { createInferenceWorker } from './browser-ports';
import type { InferenceWorkerFactory, InferenceWorkerLike } from './local-whisper-provider';
import {
  isWorkerResponse,
  type WorkerModelSpec,
  type WorkerRequest,
  type WorkerResponse,
} from './worker-protocol';

/** One corpus clip with its ground truth (parsed from the manifest). */
export interface CorpusClip {
  id: string;
  file: string;
  language: 'es' | 'en';
  condition: 'clean' | 'noisy';
  durationHint: 'short' | 'long';
  text: string;
}

/** Parsed corpus manifest (public/benchmark-corpus/manifest.json). */
export interface CorpusManifest {
  corpusVersion: number;
  entries: CorpusClip[];
}

/** Raw per-clip outcome used by the aggregation. */
export interface ClipMeasurement {
  language: 'es' | 'en';
  audioSeconds: number;
  inferenceMs: number;
  wer: number;
}

/**
 * Aggregate per-clip measurements into the manifest shape. Pure — the
 * exportable measurement is identical whether it aggregates a live run or
 * a replayed log.
 */
export function aggregateMeasurements(
  modelId: string,
  backend: LocalBackend,
  corpusVersion: number,
  loadMs: number,
  clips: ClipMeasurement[],
  peakMemoryBytes?: number,
): BenchmarkMeasurement {
  const audioSeconds = clips.reduce((sum, c) => sum + c.audioSeconds, 0);
  const inferenceSeconds = clips.reduce((sum, c) => sum + c.inferenceMs, 0) / 1000;
  const byLanguage = new Map<'es' | 'en', number[]>();
  for (const clip of clips) {
    const list = byLanguage.get(clip.language) ?? [];
    list.push(clip.wer);
    byLanguage.set(clip.language, list);
  }
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
  const languageWer: { es?: number; en?: number } = {};
  const es = byLanguage.get('es');
  const en = byLanguage.get('en');
  if (es) languageWer.es = mean(es);
  if (en) languageWer.en = mean(en);

  const measurement: BenchmarkMeasurement = {
    modelId,
    backend,
    corpusVersion,
    clips: clips.length,
    languageWer,
    globalWer: mean(clips.map((c) => c.wer)),
    loadMs,
    audioSeconds,
    inferenceSeconds,
    rtf: audioSeconds > 0 ? inferenceSeconds / audioSeconds : 0,
  };
  if (peakMemoryBytes !== undefined) measurement.peakMemoryBytes = peakMemoryBytes;
  return measurement;
}

/** Fetch + parse the corpus manifest (same-origin only). */
export async function loadCorpusManifest(
  fetchImpl: typeof fetch = fetch,
  corpusUrl = '/benchmark-corpus/manifest.json',
): Promise<CorpusManifest> {
  const response = await fetchImpl(corpusUrl);
  if (!response.ok) throw new Error(`Corpus no disponible (HTTP ${response.status}).`);
  const manifest = (await response.json()) as CorpusManifest;
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('El corpus del benchmark está vacío.');
  }
  return manifest;
}

export interface RunDiagnosticsDeps {
  /** Which backends to try, in order (from planBackends). */
  backends: readonly LocalBackend[];
  /** Same-origin WAV fetcher (injectable for tests). */
  fetchClip: (file: string) => Promise<Blob>;
  /** Worker factory (injectable; null = browser cannot run diagnostics). */
  workerFactory: InferenceWorkerFactory;
  /** Wall clock (injectable). */
  now: () => number;
}

export interface DiagnosticsRun {
  ok: true;
  measurement: BenchmarkMeasurement;
  effectiveBackend: LocalBackend;
}

export interface DiagnosticsFailure {
  ok: false;
  error: Error;
}

/**
 * Run the full corpus through one model in a dedicated worker: cold load
 * (timed), then per-clip decode → transcribe (timed) → WER against the
 * ground truth. The worker is terminated afterwards — the resident model
 * of the dictation provider is never touched.
 */
export async function runModelDiagnostics(
  entry: LocalCatalogEntry,
  corpus: CorpusManifest,
  deps: RunDiagnosticsDeps,
): Promise<DiagnosticsRun | DiagnosticsFailure> {
  const worker = deps.workerFactory();
  if (!worker) {
    return { ok: false, error: new Error('Este navegador no puede ejecutar el diagnóstico.') };
  }

  try {
    const spec: WorkerModelSpec = { repo: entry.repo, revision: entry.revision };

    // --- load handshake (cold) -------------------------------------------
    const loadStart = deps.now();
    const ready = await exchange(worker, {
      type: 'load',
      requestId: 1,
      model: spec,
      backends: [...deps.backends],
    });
    if (ready.type !== 'ready') throw new Error('El modelo no cargó para el diagnóstico.');
    const loadMs = deps.now() - loadStart;
    const backend = ready.backend;

    // --- per-clip measurement --------------------------------------------
    const clips: ClipMeasurement[] = [];
    let requestId = 2;
    for (const clip of corpus.entries) {
      const blob = await deps.fetchClip(clip.file);
      const decoded = await decodeAudioTo16kMono(blob);
      const t0 = deps.now();
      const result = await exchange(worker, {
        type: 'transcribe',
        requestId,
        model: spec,
        audio: decoded.audio,
        language: clip.language,
        task: 'transcribe',
      });
      requestId += 1;
      const inferenceMs = deps.now() - t0;
      if (result.type !== 'result') throw new Error('Resultado inesperado del diagnóstico.');
      clips.push({
        language: clip.language,
        audioSeconds: decoded.duration,
        inferenceMs,
        wer: wordErrorRate(clip.text, result.text),
      });
    }

    return {
      ok: true,
      effectiveBackend: backend,
      measurement: aggregateMeasurements(
        entry.id,
        backend,
        corpus.corpusVersion,
        loadMs,
        clips,
        readPeakMemoryBytes(),
      ),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    worker.terminate();
  }
}

/** Pending reply resolver registry keyed by requestId. */
type ExchangeWaiter = (response: WorkerResponse) => void;

function exchange(worker: InferenceWorkerLike, message: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const waiters = new Map<number, ExchangeWaiter>();
    waiters.set(message.requestId, resolve);
    worker.onMessage((data) => {
      if (!isWorkerResponse(data)) return;
      // `loading` notes are progress, not replies — keep waiting for the
      // terminal response of this requestId.
      if (data.type === 'loading') return;
      const waiter = waiters.get(data.requestId);
      if (!waiter) return;
      waiters.delete(data.requestId);
      if (data.type === 'error') {
        reject(new Error(data.message));
        return;
      }
      waiter(data);
    });
    worker.postMessage(message);
  });
}

/** Peak heap when the browser exposes it (Chromium); undefined elsewhere. */
function readPeakMemoryBytes(): number | undefined {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory?.usedJSHeapSize;
}

/** Default same-origin clip fetcher. */
export function fetchCorpusClip(file: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  return fetchImpl(`/benchmark-corpus/${file}`).then((response) => {
    if (!response.ok) throw new Error(`Clip ${file} no disponible (HTTP ${response.status}).`);
    return response.blob();
  });
}

export { createInferenceWorker };
