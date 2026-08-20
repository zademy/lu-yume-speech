/**
 * Protocolo de mensajes del Worker de inferencia del Motor local.
 *
 * Single responsibility: the typed message contracts shared by the
 * inference worker (`inference-worker.ts`) and the provider that owns it
 * (`local-whisper-provider.ts`). Pure types plus a runtime guard — no
 * behaviour, so both sides stay decoupled from each other's implementation
 * while keeping the wire format compile-checked.
 */

import type { LocalBackend } from '../types';

/** Model identity the worker needs to build its Transformers.js pipeline. */
export interface WorkerModelSpec {
  repo: string;
  revision: string;
}

/** Main → worker messages. */
export type WorkerRequest =
  | {
      type: 'load';
      requestId: number;
      model: WorkerModelSpec;
      /**
       * Ordered backend attempts (planned by the provider): WebGPU first with
       * a WASM fallback only for models that permit it. The worker verifies
       * each attempt by actually creating the session and reports the
       * effective backend in `ready`.
       */
      backends: LocalBackend[];
    }
  | {
      type: 'transcribe';
      requestId: number;
      model: WorkerModelSpec;
      /** Mono 16 kHz PCM samples (transferred, not copied). */
      audio: Float32Array;
      /** ISO-639-1 code; omitted = auto-detect. */
      language?: string;
      task: 'transcribe' | 'translate';
    };

/** Worker → main messages (every reply echoes the originating requestId). */
export type WorkerResponse =
  | { type: 'loading'; requestId: number; note: string }
  | { type: 'ready'; requestId: number; backend: LocalBackend }
  | { type: 'result'; requestId: number; text: string; language?: string }
  | { type: 'error'; requestId: number; message: string };

/**
 * Runtime guard for {@link WorkerResponse} — the provider consumes untrusted
 * `MessageEvent.data`, so every handler path goes through this check.
 */
export function isWorkerResponse(data: unknown): data is WorkerResponse {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as { type?: unknown; requestId?: unknown };
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.requestId === 'number' &&
    ['loading', 'ready', 'result', 'error'].includes(candidate.type)
  );
}
