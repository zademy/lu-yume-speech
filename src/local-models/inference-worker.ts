/**
 * Worker de inferencia del Motor local — the only module that imports
 * Transformers.js / ONNX Runtime Web.
 *
 * Runs in a dedicated Web Worker (never the main thread). Loads the ASR
 * pipeline for the requested pinned revision on the WASM backend (T4;
 * automatic WebGPU→WASM selection lands with T5), then executes transcribe /
 * translate requests over the typed protocol in `worker-protocol.ts`.
 *
 * Model weights are served from the app's own download store: `env.fetch`
 * is redirected to a cache-first wrapper over the Cache API store the
 * download engine filled (spec: nothing downloads automatically — a cache
 * miss is an error telling the user to re-download, never a network fetch).
 * ONNX Runtime's WASM binaries are served from the app's own origin via
 * build-time `?url` imports (no CDN egress).
 */

/// <reference types="vite/client" />

import { LOCAL_MODEL_CACHE_NAME } from './artifact-store';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

// Build-time asset URLs — same origin, hashed by Vite (spec: no CDN egress).
// Subpaths follow onnxruntime-web's `exports` map (bare, no dist/).
import ortWasmFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

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

let transformers: TransformersModule | null = null;
let pipelinePromise: Promise<AsrPipeline> | null = null;
let pipelineKey = '';

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
  module.env.backends.onnx.wasm.wasmPaths = {
    mjs: ortWasmFactoryUrl,
    wasm: ortWasmBinaryUrl,
  };
  transformers = module;
  return module;
}

async function ensurePipeline(
  repo: string,
  revision: string,
  onLoading: (note: string) => void,
): Promise<AsrPipeline> {
  const key = `${repo}@${revision}`;
  if (pipelinePromise && key === pipelineKey) return pipelinePromise;

  pipelineKey = key;
  onLoading('Cargando pipeline local…');
  pipelinePromise = (async () => {
    const module = await loadTransformers();
    return module.pipeline('automatic-speech-recognition', repo, {
      revision,
      dtype: 'q4',
      device: 'wasm',
      progress_callback: (progress: { status?: string; file?: string }) => {
        if (progress.status && progress.status !== 'progress' && progress.file) {
          onLoading(`Preparando ${progress.file}…`);
        }
      },
    });
  })().catch((error: unknown) => {
    // Do not cache a failed load — the next attempt starts clean.
    if (key === pipelineKey) {
      pipelinePromise = null;
      pipelineKey = '';
    }
    throw error;
  });
  return pipelinePromise;
}

function reply(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer ?? []);
}

scope.addEventListener('message', async (event) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      await ensurePipeline(request.model.repo, request.model.revision, (note) =>
        reply({ type: 'loading', requestId: request.requestId, note }),
      );
      reply({ type: 'ready', requestId: request.requestId });
      return;
    }

    // request.type === 'transcribe' (load returned above; the protocol has
    // exactly these two requests).
    const asr = await ensurePipeline(request.model.repo, request.model.revision, () => {});
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
