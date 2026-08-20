/**
 * Groq Whisper API client — implements the {@link TranscriptionProvider} seam.
 *
 * Handles all HTTP communication with the Groq speech-to-text API.
 * Supports both transcription (same language) and translation (to English).
 *
 * Features (shared with other providers via transcription-provider.ts):
 * - 30s request timeout via AbortController
 * - Automatic retry on 429 / 503 / 504 (max 3, exponential backoff + jitter)
 * - External AbortSignal support for user-initiated cancellation
 * - Zod schema validation of the API response
 * - Typed error union (`TranscriptionError`) surfaced via `TranscriptionApiError`
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
import type { EventMap, TranscriptionOptions, TranscriptionResult } from '../types';
import {
  runTranscriptionFetch,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from './transcription-provider';
import { fail as sharedFail } from '../core/transcription-fail';
import type { TranscriptionError } from '../types';

/** Groq API base URL (OpenAI-compatible). */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Zod schema for the Groq transcription response. */
const TRANSCRIPTION_SCHEMA = z
  .object({
    text: z.string().default(''),
    language: z.string().optional(),
    duration: z.number().optional(),
    segments: z.array(z.any()).optional(),
    words: z.array(z.any()).optional(),
  })
  .loose();

export class GroqClient implements TranscriptionProvider {
  readonly id = 'groq' as const;

  private readonly bus: EventBus<EventMap>;
  private readonly getApiKey: () => string;

  constructor(bus: EventBus<EventMap>, getApiKey: () => string) {
    this.bus = bus;
    this.getApiKey = getApiKey;
  }

  /**
   * Send audio to Groq for transcription or translation.
   *
   * Emits `transcription:start`, then either `transcription:success`
   * or `transcription:error` through the event bus.
   *
   * @returns The parsed transcription result.
   * @throws {TranscriptionApiError} on any failure (auth, rate-limit, network, parse, server).
   */
  async transcribe(
    blob: Blob,
    request: TranscriptionRequest,
    externalSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw this.fail({
        kind: 'auth',
        message: 'Falta la API key de Groq. Configúrala desde Ajustes.',
      });
    }

    const endpoint = request.mode === 'translate' ? 'translations' : 'transcriptions';
    const url = `${GROQ_BASE_URL}/audio/${endpoint}`;
    this.bus.emit('transcription:start', request.model);
    this.bus.emit('status:change', {
      message: `Procesando con ${request.model}...`,
      level: 'processing',
    });

    const res = await runTranscriptionFetch(
      this.bus,
      (signal) =>
        fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: this.buildFormData(blob, request, endpoint),
          signal,
        }),
      externalSignal,
    );

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
    endpoint: 'transcriptions' | 'translations',
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
   * Emit the error on the bus and return a `TranscriptionApiError` for the caller to throw.
   */
  private fail(detail: TranscriptionError) {
    return sharedFail(this.bus, detail);
  }
}
