/**
 * Cloudflare Whisper worker client — implements the {@link TranscriptionProvider} seam.
 *
 * Contract (see API.md): POST `<baseUrl>/transcribe?lang=<iso>` with the
 * raw audio bytes in the body (no multipart), Bearer-token auth, and a
 * plain-text response. The model is fixed server-side
 * (`whisper-large-v3-turbo`); translation, prompt, temperature, response
 * format and timestamps are not supported and ignored.
 *
 * Resilience is identical to GroqClient (shared runner): 30s timeout,
 * retry on 429/503/504, external AbortSignal, typed error union.
 *
 * SRP — one reason to change: the worker's HTTP contract.
 * DIP: depends on the EventBus abstraction, not on concrete consumers.
 */

import type { EventBus } from '../core/event-bus';
import type { EventMap, TranscriptionResult } from '../types';
import { CLOUDFLARE_WHISPER_MODEL } from '../types';
import {
  runTranscriptionFetch,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from './transcription-provider';
import { fail as sharedFail } from '../core/transcription-fail';
import type { TranscriptionError } from '../types';

export class CloudflareWhisperClient implements TranscriptionProvider {
  readonly id = 'cloudflare-whisper' as const;

  private readonly bus: EventBus<EventMap>;
  private readonly getToken: () => string;
  private readonly getBaseUrl: () => string;

  constructor(bus: EventBus<EventMap>, getToken: () => string, getBaseUrl: () => string) {
    this.bus = bus;
    this.getToken = getToken;
    this.getBaseUrl = getBaseUrl;
  }

  /**
   * Send audio to the worker for transcription (translation unsupported —
   * the UI disables that mode while this provider is active).
   *
   * Emits `transcription:start`, then `transcription:success` or
   * `transcription:error` through the event bus.
   *
   * @returns A result carrying only `text` — the worker returns no metadata.
   * @throws {TranscriptionApiError} on any failure.
   */
  async transcribe(
    blob: Blob,
    request: TranscriptionRequest,
    externalSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const token = this.getToken();
    if (!token) {
      throw this.fail({
        kind: 'auth',
        message: 'Falta el token del worker. Configúralo desde Ajustes.',
      });
    }

    const base = this.getBaseUrl().replace(/\/+$/u, '');
    // 'auto' omits the param — the worker then applies its server default.
    const lang = request.language ? `?lang=${encodeURIComponent(request.language)}` : '';
    const url = `${base}/transcribe${lang}`;

    this.bus.emit('transcription:start', CLOUDFLARE_WHISPER_MODEL);
    this.bus.emit('status:change', {
      message: 'Procesando con Cloudflare Whisper…',
      level: 'processing',
    });

    const res = await runTranscriptionFetch(
      this.bus,
      (signal) =>
        fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': blob.type || 'audio/webm',
          },
          body: blob,
          signal,
        }),
      externalSignal,
    );

    const text = (await res.text()).trim();
    const result: TranscriptionResult = { text };
    this.bus.emit('transcription:success', result);
    return result;
  }

  /**
   * Emit the error on the bus and return a `TranscriptionApiError` for the caller to throw.
   */
  private fail(detail: TranscriptionError) {
    return sharedFail(this.bus, detail);
  }
}
