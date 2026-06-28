/**
 * Groq Whisper API client.
 *
 * Handles all HTTP communication with the Groq speech-to-text API.
 * Supports both transcription (same language) and translation (to English).
 *
 * Features:
 * - 30s request timeout via AbortController
 * - Automatic retry on 429 / 503 / 504 (max 3, exponential backoff + jitter)
 * - External AbortSignal support for user-initiated cancellation
 * - Zod schema validation of the API response
 * - Typed error union (`GroqError`) surfaced via `GroqApiError`
 *
 * Responsibilities (SRP — one reason to change: Groq API contract):
 * - Build and send multipart form requests
 * - Authenticate with API key
 * - Parse responses into typed objects
 * - Surface HTTP and network errors through the event bus
 *
 * DIP: Depends on EventBus abstraction, not on concrete consumers.
 */

import { z } from 'zod';
import type { EventBus } from '../core/event-bus';
import type { EventMap, GroqError, TranscriptionOptions, TranscriptionResult } from '../types';
import { GroqApiError } from '../types';

/** Groq API base URL (OpenAI-compatible). */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Audio endpoints supported by Groq. */
type AudioEndpoint = 'transcriptions' | 'translations';

/** Request timeout in milliseconds. */
const TIMEOUT_MS = 30_000;
/** Maximum retry attempts for transient failures. */
const MAX_RETRIES = 3;
/** HTTP status codes eligible for retry. */
const RETRYABLE = new Set([429, 503, 504]);

/** Zod schema for the Groq transcription response. */
const TRANSCRIPTION_SCHEMA = z
  .object({
    text: z.string().default(''),
    language: z.string().optional(),
    duration: z.number().optional(),
    segments: z.array(z.any()).optional(),
    words: z.array(z.any()).optional(),
  })
  .passthrough();

export class GroqClient {
  private readonly bus: EventBus<EventMap>;
  private readonly apiKey: string;

  constructor(bus: EventBus<EventMap>, apiKey: string) {
    this.bus = bus;
    this.apiKey = apiKey;
  }

  /**
   * Send audio to Groq for transcription or translation.
   *
   * Emits `transcription:start`, then either `transcription:success`
   * or `transcription:error` through the event bus.
   *
   * @returns The parsed transcription result.
   * @throws {GroqApiError} on any failure (auth, rate-limit, network, parse, server).
   */
  async transcribe(
    blob: Blob,
    options: TranscriptionOptions,
    endpoint: AudioEndpoint = 'transcriptions',
    externalSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw this.fail({
        kind: 'auth',
        message: 'Falta la API key de Groq. Configúrala desde Ajustes.',
      });
    }

    const url = `${GROQ_BASE_URL}/audio/${endpoint}`;
    this.bus.emit('transcription:start', options.model);
    this.bus.emit('status:change', {
      message: `Procesando con ${options.model}...`,
      level: 'processing',
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      if (externalSignal) {
        if (externalSignal.aborted) ctrl.abort();
        else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: this.buildFormData(blob, options, endpoint),
          signal: ctrl.signal,
        });

        if (res.ok) {
          const rawData: unknown = await res.json().catch(() => ({}));
          const parsed = TRANSCRIPTION_SCHEMA.safeParse(rawData);
          if (!parsed.success) {
            throw this.fail({
              kind: 'parse',
              message: 'Respuesta inesperada del servidor.',
              cause: parsed.error,
            });
          }
          const result: TranscriptionResult = {
            text: parsed.data.text,
            language: parsed.data.language,
            duration: parsed.data.duration,
            segments: parsed.data.segments,
            words: parsed.data.words,
          };
          this.bus.emit('transcription:success', result);
          return result;
        }

        const status = res.status;
        const body: unknown = await res.json().catch(() => ({}));
        const apiMsg =
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
            ? (body as { error: { message: string } }).error.message
            : undefined;
        const msg = apiMsg ?? `HTTP ${status}`;

        if (RETRYABLE.has(status) && attempt < MAX_RETRIES) {
          const retryAfter = Number(res.headers.get('Retry-After') ?? 0);
          const backoff = (retryAfter || 2 ** attempt) * 1000;
          const jitter = Math.random() * 250;
          await new Promise((r) => setTimeout(r, backoff + jitter));
          continue;
        }

        const kind: GroqError['kind'] =
          status === 401 || status === 403
            ? 'auth'
            : status === 429
              ? 'rate-limit'
              : status >= 500
                ? 'server'
                : 'network';
        const err: GroqError =
          kind === 'rate-limit'
            ? {
                kind,
                message: msg,
                retryAfterMs: Number(res.headers.get('Retry-After') ?? 0) * 1000,
              }
            : kind === 'server'
              ? { kind, message: msg, status }
              : { kind, message: msg };
        throw this.fail(err);
      } catch (e) {
        if (e instanceof GroqApiError) throw e;
        if (e instanceof DOMException && e.name === 'AbortError') {
          if (externalSignal?.aborted) {
            throw this.fail({ kind: 'network', message: 'Transcripción cancelada.', cause: e });
          }
          if (attempt < MAX_RETRIES) continue;
          throw this.fail({ kind: 'network', message: 'Tiempo de espera agotado.', cause: e });
        }
        throw this.fail({ kind: 'network', message: 'Error de red.', cause: e });
      } finally {
        clearTimeout(timeout);
      }
    }

    // Unreachable — loop either returns or throws
    throw this.fail({ kind: 'network', message: 'Reintentos agotados.' });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build the multipart form payload for the API request.
   * Only appends parameters that have values — avoids sending empty strings.
   */
  private buildFormData(
    blob: Blob,
    options: TranscriptionOptions,
    endpoint: AudioEndpoint,
  ): FormData {
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', options.model);

    if (options.language && endpoint === 'transcriptions') {
      form.append('language', options.language);
    }
    if (options.prompt) form.append('prompt', options.prompt);
    if (options.temperature !== undefined) form.append('temperature', String(options.temperature));
    if (options.responseFormat && options.responseFormat !== 'json') {
      form.append('response_format', options.responseFormat);
    }
    if (options.timestampGranularities?.length) {
      for (const g of options.timestampGranularities) {
        form.append('timestamp_granularities[]', g);
      }
    }

    return form;
  }

  /**
   * Emit the error on the bus and return a `GroqApiError` for the caller to throw.
   */
  private fail(detail: GroqError): GroqApiError {
    const error = new GroqApiError(detail);
    this.bus.emit('transcription:error', error);
    return error;
  }
}
