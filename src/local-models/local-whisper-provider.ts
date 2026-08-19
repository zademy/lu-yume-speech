/**
 * Provider local de Whisper — implements the {@link TranscriptionProvider}
 * seam as the third backend (Motor local).
 *
 * Single responsibility: turn a recorded Blob + provider-agnostic request
 * into a `TranscriptionResult` produced entirely in the browser. The module
 * owns NO inference code — it drives a dedicated inference Worker through
 * the typed protocol (`worker-protocol.ts`), decodes audio on the main
 * thread through an injected decoder port, and maps every failure onto the
 * shared `TranscriptionError` union. The main thread never imports the
 * Transformers.js stack.
 *
 * Cancellation is the spec's hard cancel: the Worker is terminated (weights
 * stay downloaded in the Cache API store; the model simply reloads on the
 * next use).
 */

import type { EventBus } from '../core/event-bus';
import type {
  EventMap,
  LocalBackend,
  LocalInferenceProvenance,
  TranscriptionResult,
  TranscriptionError,
} from '../types';
import type { TranscriptionProvider, TranscriptionRequest } from '../api/transcription-provider';
import { fail as sharedFail } from '../api/transcription-provider';
import type { LocalCatalogEntry } from '../utils/local-model-catalog';
import type { AudioDecoderPort } from './audio-decode';
import { planBackends, type BackendPolicy } from './backend-decision';
import { memoryTierGuard } from './memory-guard';
import { resolveLocalRequest } from './local-request';
import type { WorkerModelSpec, WorkerRequest, WorkerResponse } from './worker-protocol';
import { isWorkerResponse } from './worker-protocol';

/** Narrow worker surface the provider needs (real Worker or a test fake). */
export interface InferenceWorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  /** Replace the single message handler (last one wins). */
  onMessage(handler: (data: unknown) => void): void;
}

/** Creates the inference worker, or null when workers are unavailable. */
export type InferenceWorkerFactory = () => InferenceWorkerLike | null;

/** Constructor dependencies — every side effect is a port. */
export interface LocalWhisperProviderDeps {
  bus: EventBus<EventMap>;
  catalog: readonly LocalCatalogEntry[];
  /** Id of the Modelo activo (null = none selected). */
  getActiveModelId: () => string | null;
  /** Whether the model's artifacts are complete and verified. */
  isModelReady: (modelId: string) => boolean;
  /** Whether the device exposed a WebGPU adapter (capability probe). */
  hasWebgpu: () => boolean;
  /** Configured backend policy: 'auto' (WebGPU→WASM) or force-WASM. */
  getBackendPolicy: () => BackendPolicy;
  /** Device RAM in GB when reported, else null (memory-tier guard). */
  getDeviceMemoryGb: () => number | null;
  workerFactory: InferenceWorkerFactory;
  decoder: AudioDecoderPort;
}

/** Pending worker exchange (one load or one transcribe at a time). */
interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onLoading?: (note: string) => void;
}

export class LocalWhisperProvider implements TranscriptionProvider {
  readonly id = 'local' as const;

  private readonly deps: LocalWhisperProviderDeps;
  private worker: InferenceWorkerLike | null = null;
  /** Model spec currently loaded in the worker (null = nothing loaded). */
  private loadedSpec: WorkerModelSpec | null = null;
  /** Catalog id of the loaded model (null = nothing loaded). */
  private loadedModelId: string | null = null;
  /** Backend the resident model actually runs on (null = nothing loaded). */
  private effectiveBackend: LocalBackend | null = null;
  /** Ordered backend attempts planned for the current model. */
  private backends: LocalBackend[] = ['wasm'];
  private readonly pending = new Map<number, Pending>();
  private nextRequestId = 1;

  constructor(deps: LocalWhisperProviderDeps) {
    this.deps = deps;
  }

  async transcribe(
    blob: Blob,
    request: TranscriptionRequest,
    externalSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const modelId = this.deps.getActiveModelId();
    if (!modelId) {
      throw this.fail({
        kind: 'incompatible',
        message: 'No hay un Modelo activo. Descarga y activa uno en Ajustes › Modelos locales.',
      });
    }
    const entry = this.deps.catalog.find((candidate) => candidate.id === modelId);
    if (!entry) {
      throw this.fail({
        kind: 'incompatible',
        message: 'El Modelo activo ya no está en el catálogo. Elige otro en Ajustes.',
      });
    }
    if (!this.deps.isModelReady(modelId)) {
      throw this.fail({
        kind: 'incompatible',
        message: 'El Modelo activo no está descargado por completo. Vuelve a descargarlo.',
      });
    }

    // Memory-tier guard before load: warn on a tight device, block only the
    // extreme mismatch (unreliable reports never act).
    const memoryVerdict = memoryTierGuard(entry.memoryTier, this.deps.getDeviceMemoryGb());
    if (memoryVerdict.level === 'block') {
      throw this.fail({
        kind: 'incompatible',
        message: `${entry.name} necesita mucha memoria (tier ${entry.memoryTier}); este dispositivo reporta ${this.deps.getDeviceMemoryGb()} GB.`,
      });
    }
    if (memoryVerdict.level === 'warn') {
      this.deps.bus.emit('status:change', {
        message: `Advertencia: ${entry.name} en un dispositivo con poca memoria reportada (${this.deps.getDeviceMemoryGb()} GB).`,
        level: 'warning',
      });
    }

    // Backend plan (auto WebGPU→WASM or forced WASM) with clear refusals.
    const plan = planBackends({
      policy: this.deps.getBackendPolicy(),
      requirement: entry.backend,
      hasWebgpu: this.deps.hasWebgpu(),
    });
    if (!plan.ok) {
      throw this.fail({
        kind: 'incompatible',
        message:
          plan.reason === 'webgpu-required'
            ? `${entry.name} requiere WebGPU y este navegador no lo ofrece. Usa Whisper Base o Small para CPU.`
            : `${entry.name} no admite CPU (WASM); el modo forzado solo aplica a modelos compatibles con CPU.`,
      });
    }
    this.backends = plan.backends;

    const resolution = resolveLocalRequest(request.language, request.mode, entry);
    if (!resolution.ok) {
      throw this.fail({
        kind: 'incompatible',
        message:
          resolution.incompatibility === 'explicit-language-required'
            ? 'Este modelo no detecta el idioma: elige un idioma explícito.'
            : 'Este modelo no admite traducción; usa el modo Transcribir.',
      });
    }

    this.deps.bus.emit('transcription:start', entry.name);

    const decoded = await this.deps.decoder(blob).catch(() => {
      throw this.fail({
        kind: 'parse',
        message: 'No se pudo decodificar la grabación para el Motor local.',
      });
    });

    const spec: WorkerModelSpec = { repo: entry.repo, revision: entry.revision };
    const loaded = await this.ensureLoaded(spec, entry.id, externalSignal);
    if (!loaded.ok) throw loaded.error;

    const result = await this.exchange(
      {
        type: 'transcribe',
        requestId: this.takeRequestId(),
        model: spec,
        audio: decoded.audio,
        language: resolution.request.language,
        task: resolution.request.task,
      },
      [decoded.audio.buffer],
      externalSignal,
    );
    if (!result.ok) throw result.error;
    if (result.response.type !== 'result') {
      throw this.fail({
        kind: 'parse',
        message: 'Respuesta inesperada del Motor local.',
      });
    }

    const transcription: TranscriptionResult = {
      text: result.response.text,
      language: resolution.request.language ?? result.response.language,
      duration: decoded.duration,
      provenance: this.buildProvenance(entry),
    };
    this.deps.bus.emit('transcription:success', transcription);
    return transcription;
  }

  // -------------------------------------------------------------------------
  // Public memory-management surface (T5)
  // -------------------------------------------------------------------------

  /** Resident model info for the UI; null when nothing is loaded. */
  getResident(): { modelId: string; backend: LocalBackend } | null {
    return this.loadedSpec && this.effectiveBackend
      ? { modelId: this.loadedModelId as string, backend: this.effectiveBackend }
      : null;
  }

  /**
   * Free the resident model from memory (manual release, idle release,
   * model switch). Terminates the worker — the download is never touched
   * and the model simply reloads on the next use.
   */
  release(): void {
    if (!this.worker) return;
    this.cancelAll();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Hard cancel per spec: terminate the worker, reject everything pending.
   * Downloaded weights are untouched; the next call reloads the model.
   * Announces the residency change on the bus (memory released).
   */
  private cancelAll(): void {
    const wasResident = this.worker !== null;
    this.worker?.terminate();
    this.worker = null;
    this.loadedSpec = null;
    this.loadedModelId = null;
    this.effectiveBackend = null;
    for (const pending of this.pending.values()) {
      pending.reject(new DOMException('aborted', 'AbortError'));
    }
    this.pending.clear();
    if (wasResident) {
      this.deps.bus.emit('localModel:memory', { modelId: null, backend: null });
    }
  }

  /** Provenance snapshot of the resident model (called on success). */
  private buildProvenance(entry: LocalCatalogEntry): LocalInferenceProvenance {
    return {
      modelId: entry.id,
      revision: entry.revision,
      backend: this.effectiveBackend ?? 'wasm',
    };
  }

  private takeRequestId(): number {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }

  /** Worker-exchange outcome: a validated response or a thrown-ready error. */
  private async exchange(
    message: WorkerRequest,
    transfer?: Transferable[],
    externalSignal?: AbortSignal,
  ): Promise<{ ok: true; response: WorkerResponse } | { ok: false; error: Error }> {
    const worker = this.ensureWorker();
    if (!worker) {
      return {
        ok: false,
        error: this.fail({
          kind: 'network',
          message: 'El Motor local no está disponible en este navegador.',
        }),
      };
    }

    let onAbort: (() => void) | null = null;
    if (externalSignal) {
      if (externalSignal.aborted) this.cancelAll();
      else {
        onAbort = () => this.cancelAll();
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const reply = new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(message.requestId, {
        resolve,
        reject,
        onLoading:
          message.type === 'load'
            ? (note) => this.deps.bus.emit('status:change', { message: note, level: 'processing' })
            : undefined,
      });
      worker.postMessage(message, transfer);
    });

    try {
      return { ok: true, response: await reply };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          ok: false,
          error: this.fail({
            kind: 'network',
            message:
              'Transcripción cancelada por completo. Los pesos descargados se conservan; el modelo se recargará en el próximo uso.',
            cause: error,
          }),
        };
      }
      // A memory-looking inference failure frees the resident model (spec:
      // released on memory error; the download is never touched).
      const messageText = error instanceof Error ? error.message : '';
      if (messageText && MEMORY_ERROR_PATTERN.test(messageText)) {
        this.cancelAll();
      }
      return {
        ok: false,
        error: this.fail({
          kind: 'network',
          message: messageText || 'Fallo de inferencia del Motor local.',
        }),
      };
    } finally {
      if (onAbort && externalSignal) externalSignal.removeEventListener('abort', onAbort);
      this.pending.delete(message.requestId);
    }
  }

  /** Load the model spec if the current worker doesn't have it yet. */
  private async ensureLoaded(
    spec: WorkerModelSpec,
    modelId: string,
    externalSignal?: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; error: Error }> {
    if (this.worker && this.loadedSpec && sameSpec(this.loadedSpec, spec)) {
      return { ok: true };
    }
    // Model switch (or first load): a fresh worker guarantees a clean
    // Transformers.js state — the old model's memory dies with the old worker.
    this.cancelAll();
    this.deps.bus.emit('status:change', {
      message: 'Cargando modelo local…',
      level: 'processing',
    });
    const reply = await this.exchange(
      { type: 'load', requestId: this.takeRequestId(), model: spec, backends: this.backends },
      undefined,
      externalSignal,
    );
    if (!reply.ok) {
      // Load failed (or was cancelled) on an unknown-state worker — drop it
      // so the next attempt starts from a clean Transformers.js state.
      this.cancelAll();
      return reply;
    }
    if (reply.response.type !== 'ready') {
      this.cancelAll();
      return {
        ok: false,
        error: this.fail({ kind: 'parse', message: 'Respuesta inesperada del Motor local.' }),
      };
    }
    this.loadedSpec = spec;
    this.loadedModelId = modelId;
    this.effectiveBackend = reply.response.backend;
    this.deps.bus.emit('localModel:memory', {
      modelId,
      backend: this.effectiveBackend,
    });
    return { ok: true };
  }

  /** Lazily spawn the worker and wire its single message handler. */
  private ensureWorker(): InferenceWorkerLike | null {
    if (this.worker) return this.worker;
    const worker = this.deps.workerFactory();
    if (!worker) return null;
    worker.onMessage((data) => {
      if (!isWorkerResponse(data)) return;
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      if (data.type === 'loading') {
        pending.onLoading?.(data.note);
        return;
      }
      if (data.type === 'error') {
        pending.reject(new Error(data.message));
        return;
      }
      pending.resolve(data);
    });
    this.worker = worker;
    return worker;
  }

  private fail(detail: TranscriptionError): Error {
    return sharedFail(this.deps.bus, detail);
  }
}

function sameSpec(a: WorkerModelSpec, b: WorkerModelSpec): boolean {
  return a.repo === b.repo && a.revision === b.revision;
}

/**
 * Heuristic for inference failures that smell like memory exhaustion (ORT /
 * WebGPU alloc errors) — those free the resident model per spec.
 */
const MEMORY_ERROR_PATTERN = /\b(out of memory|oom|alloc(?:ation)? failed|memory access)\b/i;
