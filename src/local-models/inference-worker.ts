/**
 * Worker de inferencia del Motor local — the only module that imports
 * Transformers.js / ONNX Runtime Web.
 *
 * Runs in a dedicated Web Worker (never the main thread). A `load` request
 * carries the provider-planned ordered backend attempts: WebGPU is verified
 * by actually creating the session (pipeline construction) and, on failure,
 * the pipeline is recreated with WASM only when the plan allows it. Once
 * loaded, the backend stays fixed for the model's residency — never
 * mid-inference migration. Transcribe / translate requests run over the
 * typed protocol in `worker-protocol.ts`.
 *
 * Model weights are served from the app's own download store: `env.fetch`
 * is redirected to a cache-first wrapper over the Cache API store the
 * download engine filled (spec: nothing downloads automatically — a cache
 * miss is an error telling the user to re-download, never a network fetch).
 * ONNX Runtime's WASM binaries are served from the app's own origin via
 * build-time `?url` imports (no CDN egress): the asyncify pair for the WASM
 * backend, the jsep pair for WebGPU.
 */

/// <reference types="vite/client" />

import type { LocalBackend } from '../types';
import { LOCAL_MODEL_CACHE_NAME } from './artifact-store';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

// Build-time asset URLs — same origin, hashed by Vite (spec: no CDN egress).
// Subpaths follow onnxruntime-web's `exports` map (bare, no dist/).
import ortWasmFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortJsepFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import ortJsepBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';

/**
 * Dedicated-worker scope, typed without pulling the WebWorker lib into a
 * DOM-lib project (mixing both lib sets redeclares globals).
 */
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', handler: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

interface TransformersModule {
  pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<AsrPipeline>;
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    fetch: typeof fetch;
    backends: {
      onnx: {
        wasm: {
          numThreads?: number;
          wasmPaths: { mjs: string; wasm: string };
        };
      };
    };
  };
}

type AsrPipelineOutput = { text?: unknown } | Array<{ text?: unknown }>;
type AsrPipeline = (
  audio: Float32Array,
  options: { language?: string; task?: string },
) => Promise<AsrPipelineOutput>;

/** Coerce a pipeline output shape into plain text. */
function outputText(output: AsrPipelineOutput): string {
  const first = Array.isArray(output) ? output[0] : output;
  const text = first?.text;
  return typeof text === 'string' ? text : '';
}

/**
 * Cache-first fetch: every model file request goes through the download
 * engine's Cache API store. A miss means the browser evicted the artifacts
 * (or the record is stale) — surface a re-download error, never hit the
 * network behind the user's back.
 */
async function cacheFirstFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const cache = await caches.open(LOCAL_MODEL_CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) return cached;
  throw new Error(
    `Artefacto no encontrado en el almacén local (${url}). Vuelve a descargar el modelo.`,
  );
}

/** WASM asset pair per backend (jsep carries the WebGPU JS glue). */
const WASM_PAIRS: Record<LocalBackend, { mjs: string; wasm: string }> = {
  wasm: { mjs: ortWasmFactoryUrl, wasm: ortWasmBinaryUrl },
  webgpu: { mjs: ortJsepFactoryUrl, wasm: ortJsepBinaryUrl },
};

let transformers: TransformersModule | null = null;
let pipelinePromise: Promise<AsrPipeline> | null = null;
let pipelineKey = '';
let pipelineBackend: LocalBackend | null = null;

async function loadTransformers(): Promise<TransformersModule> {
  if (transformers) return transformers;
  const module = (await import('@huggingface/transformers')) as unknown as TransformersModule;
  // Weights come from OUR cache; Transformers.js's own browser cache layer
  // would duplicate them — disable it. Remote-host defaults already build
  // the exact pinned `huggingface.co/{repo}/resolve/{revision}/{file}` URLs
  // the download engine cached.
  module.env.allowLocalModels = false;
  module.env.useBrowserCache = false;
  module.env.fetch = cacheFirstFetch;
  // Single-threaded WASM (spec: no COOP/COEP, no multithreaded WASM).
  module.env.backends.onnx.wasm.numThreads = 1;
  transformers = module;
  return module;
}

/** Drop the cached pipeline so the next load attempt starts clean. */
function resetPipeline(): void {
  pipelinePromise = null;
  pipelineKey = '';
  pipelineBackend = null;
}

async function createPipeline(
  backend: LocalBackend,
  repo: string,
  revision: string,
  onLoading: (note: string) => void,
): Promise<AsrPipeline> {
  const module = await loadTransformers();
  // ORT needs the matching wasm pair per backend (jsep = WebGPU glue).
  module.env.backends.onnx.wasm.wasmPaths = WASM_PAIRS[backend];
  return module.pipeline('automatic-speech-recognition', repo, {
    revision,
    dtype: 'q4',
    device: backend,
    progress_callback: (progress: { status?: string; file?: string }) => {
      if (progress.status && progress.status !== 'progress' && progress.file) {
        onLoading(`Preparando ${progress.file}…`);
      }
    },
  });
}

/**
 * Load the pipeline trying the planned backends in order. WebGPU is
 * "verified" by actually building the session; a failed attempt falls
 * through to the next backend (WASM fallback happens only when the plan
 * includes it). Resolves with the effective backend.
 */
async function loadWithBackends(
  repo: string,
  revision: string,
  backends: readonly LocalBackend[],
  onLoading: (note: string) => void,
): Promise<LocalBackend> {
  const key = `${repo}@${revision}`;
  if (pipelinePromise && key === pipelineKey && pipelineBackend) {
    // Already resident on a planned backend — reuse it (no migration).
    if (backends.includes(pipelineBackend)) return pipelineBackend;
    resetPipeline();
  }

  let lastError: unknown = null;
  for (const backend of backends) {
    pipelineKey = key;
    pipelineBackend = backend;
    onLoading(
      backend === 'webgpu'
        ? 'Cargando pipeline local (WebGPU)…'
        : 'Cargando pipeline local (CPU WASM)…',
    );
    try {
      pipelinePromise = createPipeline(backend, repo, revision, onLoading);
      await pipelinePromise;
      return backend;
    } catch (error) {
      lastError = error;
      resetPipeline();
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo cargar el modelo local con ningún backend disponible.');
}

function reply(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer ?? []);
}

scope.addEventListener('message', async (event) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      const backend = await loadWithBackends(
        request.model.repo,
        request.model.revision,
        request.backends,
        (note) => reply({ type: 'loading', requestId: request.requestId, note }),
      );
      reply({ type: 'ready', requestId: request.requestId, backend });
      return;
    }

    // request.type === 'transcribe' (load returned above; the protocol has
    // exactly these two requests). Transcribe on the resident pipeline only.
    if (!pipelinePromise) {
      throw new Error('El modelo no está cargado; inicia una transcripción nueva.');
    }
    const asr = await pipelinePromise;
    const options: { language?: string; task?: string } = { task: request.task };
    if (request.language) options.language = request.language;
    const output = await asr(request.audio, options);
    reply({ type: 'result', requestId: request.requestId, text: outputText(output) });
  } catch (error) {
    reply({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
