/**
 * MiniMax Speech-to-Text client — implements the {@link TranscriptionProvider} seam.
 *
 * Contract (see https://platform.minimax.io/docs/api-reference/speech-to-text):
 * POST `https://api.minimax.io/v1/speech_to_text` with multipart form data
 * (model `asr-1.0`, the audio as a real file, `response_format=json`,
 * `stream=false`), Bearer-key auth, and an optional BCP-47 `language` HEADER
 * (not a form field). The response carries `text` + `duration`.
 *
 * The service accepts WAV/MP3/AAC/OGG/… up to 500 s and 50 MB per request and
 * does NOT accept WebM, so the client receives an audio port (composition
 * root wires browser decode + WAV encode) that converts the recording into a
 * PCM16 mono 16 kHz WAV Blob and reports its duration — the raw recording is
 * never sent. Requests over either limit are rejected before upload; splitting
 * long recordings lands with the long-audio ticket.
 *
 * Translation is not part of the documented contract: the mode is ignored and
 * the UI disables it while this provider is active. Resilience is identical
 * to GroqClient/worker (shared runner): 30 s timeout, retry on 429/503/504,
 * external AbortSignal, typed error union.
 *
 * SRP — one reason to change: the MiniMax HTTP contract.
 * DIP: depends on the EventBus abstraction, not on concrete consumers.
 */

import { z } from 'zod';
import type { EventBus } from '../core/event-bus';
import type { EventMap, TranscriptionResult } from '../types';
import { MINIMAX_ASR_MODEL } from '../types';
import {
  runTranscriptionFetch,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from './transcription-provider';
import { fail as sharedFail } from '../core/transcription-fail';
import type { TranscriptionError } from '../types';

/** MiniMax Speech-to-Text endpoint. */
export const MINIMAX_ENDPOINT = 'https://api.minimax.io/v1/speech_to_text';

/** Maximum audio duration the service accepts per request (seconds). */
export const MINIMAX_MAX_DURATION_SECONDS = 500;

/** Maximum request size the service accepts (50 MB). */
export const MINIMAX_MAX_REQUEST_BYTES = 50 * 1024 * 1024;

/**
 * Language hints the service documents (BCP-47-ish codes). Anything else —
 * including the app's `auto` — omits the header so the service applies
 * mixed-language recognition instead of receiving an invalid hint.
 */
export const MINIMAX_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set([
  'zh',
  'yue',
  'en',
  'ja',
  'ko',
  'th',
  'vi',
  'id',
  'ms',
  'fil',
  'ar',
  'tr',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'pl',
  'ru',
  'uk',
]);

/**
 * Audio port: recording Blob → WAV Blob ready for upload + its duration in
 * seconds. Production wiring (main.ts) decodes to PCM16 mono 16 kHz and
 * encodes WAV; tests inject a fake so the HTTP contract stays the seam.
 */
export type MiniMaxAudioPort = (blob: Blob) => Promise<{
  blob: Blob;
  durationSeconds: number;
}>;

/** Zod schema for the MiniMax transcription response (`response_format=json`). */
const TRANSCRIPTION_SCHEMA = z
  .object({
    text: z.string().default(''),
    duration: z.number().optional(),
    trace_id: z.string().optional(),
  })
  .loose();

export class MiniMaxClient implements TranscriptionProvider {
  readonly id = 'minimax' as const;

  private readonly bus: EventBus<EventMap>;
  private readonly getApiKey: () => string;
  private readonly prepareAudio: MiniMaxAudioPort;

  constructor(bus: EventBus<EventMap>, getApiKey: () => string, prepareAudio: MiniMaxAudioPort) {
    this.bus = bus;
    this.getApiKey = getApiKey;
    this.prepareAudio = prepareAudio;
  }

  /**
   * Send audio to MiniMax for transcription (translation is not part of the
   * documented contract — the UI disables that mode while this provider is
   * active, and the request mode is ignored here).
   *
   * Emits `transcription:start`, then `transcription:success` or
   * `transcription:error` through the event bus.
   *
   * @returns A result carrying `text` and the audio `duration`.
   * @throws {TranscriptionApiError} on any failure (auth, incompatible audio,
   *   rate-limit, network, parse, server).
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
        message: 'Falta la API key de MiniMax. Configúrala desde Ajustes.',
      });
    }

    let prepared: Awaited<ReturnType<MiniMaxAudioPort>>;
    try {
      prepared = await this.prepareAudio(blob);
    } catch (cause) {
      throw this.fail({
        kind: 'parse',
        message: 'No se pudo convertir el audio para MiniMax.',
        cause,
      });
    }

    if (prepared.durationSeconds > MINIMAX_MAX_DURATION_SECONDS) {
      throw this.fail({
        kind: 'incompatible',
        message: `La grabación supera los ${MINIMAX_MAX_DURATION_SECONDS} segundos que MiniMax admite por petición. Vuelve a intentarlo con una grabación más corta.`,
      });
    }
    if (prepared.blob.size > MINIMAX_MAX_REQUEST_BYTES) {
      throw this.fail({
        kind: 'incompatible',
        message: 'El audio convertido supera el límite de 50 MB por petición de MiniMax.',
      });
    }

    this.bus.emit('transcription:start', MINIMAX_ASR_MODEL);
    this.bus.emit('status:change', {
      message: 'Procesando con MiniMax…',
      level: 'processing',
    });

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    // Language hint travels as a HEADER per the documented contract; only
    // documented codes are sent, anything else enables mixed-language mode.
    if (request.language && MINIMAX_SUPPORTED_LANGUAGES.has(request.language)) {
      headers.language = request.language;
    }

    const form = new FormData();
    form.append('model', MINIMAX_ASR_MODEL);
    form.append('file', prepared.blob, 'audio.wav');
    form.append('response_format', 'json');
    form.append('stream', 'false');

    const res = await runTranscriptionFetch(
      this.bus,
      (signal) => fetch(MINIMAX_ENDPOINT, { method: 'POST', headers, body: form, signal }),
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
      duration: parsed.data.duration,
    };
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
