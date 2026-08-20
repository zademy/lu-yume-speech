/**
 * Transcription provider contract (Adapter pattern).
 *
 * Every transcription backend (Groq API, Cloudflare Whisper worker, …)
 * implements this interface, so the rest of the app depends only on the
 * abstraction — never on a concrete HTTP contract. `main.ts` owns the
 * registry that maps `TranscriptionProviderId` → instance.
 *
 * SRP: this module declares the seam shared by all providers, plus the
 * retry/timeout/error-classification runner they reuse so every provider
 * behaves identically under transient failures.
 */

import type {
  EventMap,
  OperationMode,
  TranscriptionError,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
} from '../types';
import { TranscriptionApiError } from '../types';
import type { EventBus } from '../core/event-bus';
import { fail } from '../core/transcription-fail';

/** Parameters for one transcription request, provider-agnostic. */
export interface TranscriptionRequest extends TranscriptionOptions {
  /** What to do with the audio. Providers without translation ignore it. */
  mode: OperationMode;
}

/** The seam every transcription backend implements. */
export interface TranscriptionProvider {
  /**
   * Stable provider id: a `TranscriptionProviderId` for remote backends or
   * `'local'` for the Motor local.
   */
  readonly id: TranscriptionProviderId | 'local';
  /**
   * Send audio for transcription/translation. Emits `transcription:start`,
   * then `transcription:success` or `transcription:error` on the bus.
   *
   * @throws {TranscriptionApiError} on any failure.
   */
  transcribe(
    blob: Blob,
    request: TranscriptionRequest,
    externalSignal?: AbortSignal,
  ): Promise<TranscriptionResult>;
}

/** Request timeout in milliseconds (shared policy across providers). */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for transient failures (shared policy). */
export const MAX_RETRIES = 3;

/** HTTP status codes eligible for retry (shared policy). */
const RETRYABLE = new Set([429, 503, 504]);

/**
 * Shared fetch runner: 30s timeout via AbortController, external-signal
 * cancellation, retry on 429/503/504 (max 3, exponential backoff + jitter,
 * honoring `Retry-After`), and HTTP-status → `TranscriptionError` mapping.
 *
 * Providers plug in their request builder; they only handle the successful
 * `Response` body afterwards. Failures are already emitted on the bus and
 * thrown as `TranscriptionApiError`.
 */
export async function runTranscriptionFetch(
  bus: EventBus<EventMap>,
  buildRequest: (signal: AbortSignal) => Promise<Response>,
  externalSignal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort();
      else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    try {
      const res = await buildRequest(ctrl.signal);

      if (res.ok) return res;

      const status = res.status;
      const bodyText = await res.text().catch(() => '');
      const msg = bodyText.trim() || `HTTP ${status}`;

      if (RETRYABLE.has(status) && attempt < MAX_RETRIES) {
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 0;
        const backoff = (retryAfter || 2 ** attempt) * 1000;
        const jitter = Math.random() * 250;
        await new Promise((r) => setTimeout(r, backoff + jitter));
        continue;
      }

      const kind: TranscriptionError['kind'] =
        status === 401 || status === 403
          ? 'auth'
          : status === 429
            ? 'rate-limit'
            : status >= 500
              ? 'server'
              : 'network';
      const err: TranscriptionError =
        kind === 'rate-limit'
          ? { kind, message: msg, retryAfterMs: Number(res.headers.get('Retry-After') ?? 0) * 1000 }
          : kind === 'server'
            ? { kind, message: msg, status }
            : { kind, message: msg };
      throw fail(bus, err);
    } catch (e) {
      if (e instanceof TranscriptionApiError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (externalSignal?.aborted) {
          throw fail(bus, { kind: 'network', message: 'Transcripción cancelada.', cause: e });
        }
        if (attempt < MAX_RETRIES) continue;
        throw fail(bus, { kind: 'network', message: 'Tiempo de espera agotado.', cause: e });
      }
      throw fail(bus, { kind: 'network', message: 'Error de red.', cause: e });
    } finally {
      clearTimeout(timeout);
    }
  }

  // Unreachable — loop either returns or throws
  throw fail(bus, { kind: 'network', message: 'Reintentos agotados.' });
}
