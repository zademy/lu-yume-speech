/**
 * MiniMax Speech-to-Text client — implements the {@link TranscriptionProvider} seam.
 *
 * Contract (see https://platform.minimax.io/docs/api-reference/speech-to-text):
 * POST `https://api.minimax.io/v1/speech_to_text` with multipart form data
 * (model `asr-1.0`, the audio as a real WAV file, `response_format=json`,
 * `stream=false`), Bearer-key auth, and an optional BCP-47 `language` HEADER
 * (not a form field). The response carries `text` + `duration`.
 *
 * Long recordings: the service accepts at most 500 s / 50 MB per request, so
 * the decoded audio is partitioned BY SAMPLES into independently valid WAV
 * fragments (never compressed-container byte cuts), submitted sequentially,
 * and their texts joined in recording order into ONE result — one
 * `transcription:start`, one `transcription:success`, so history/refinement
 * stay per-take. Cut points prefer a nearby silence gap (2 s lookback) over
 * slicing speech; the in-flight status names the fragment, and a fragment
 * failure fails the whole take without emitting partial text. Ordered
 * fragment outcomes are tracked per take for the resumable-recovery ticket.
 *
 * Translation is not part of the documented contract: the mode is ignored and
 * the UI disables it while this provider is active. Resilience reuses the
 * shared runner (retry on 429/503/504, external AbortSignal, typed errors)
 * with a per-fragment timeout scaled to the fragment duration.
 *
 * SRP — one reason to change: how a recording becomes MiniMax HTTP requests
 * (the provider's documented contract + the partitioning policy it implies).
 * DIP: depends on the EventBus abstraction, not on concrete consumers.
 */

import { z } from 'zod';
import type { EventBus } from '../core/event-bus';
import type { EventMap, TranscriptionResult } from '../types';
import { MINIMAX_ASR_MODEL } from '../types';
import {
  runTranscriptionFetch,
  REQUEST_TIMEOUT_MS,
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

/** How far before a hard boundary a silence-aligned cut may move (seconds). */
const BOUNDARY_LOOKBACK_SECONDS = 2;

/** RMS window used to rank candidate cut points (milliseconds). */
const BOUNDARY_FRAME_MS = 20;

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

/** Decoded recording ready for fragment partitioning. */
export interface MiniMaxDecodedAudio {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Audio port: recording Blob → decoded PCM samples. Production wiring
 * (main.ts) decodes to mono 16 kHz; tests inject a fake so the HTTP contract
 * stays the seam.
 */
export type MiniMaxAudioPort = (blob: Blob) => Promise<MiniMaxDecodedAudio>;

/** WAV encoder port: one fragment's samples → an uploadable WAV Blob. */
export type WavEncoderPort = (samples: Float32Array, sampleRate: number) => Blob;

/** Zod schema for the MiniMax transcription response (`response_format=json`). */
const TRANSCRIPTION_SCHEMA = z
  .object({
    text: z.string().default(''),
    duration: z.number().optional(),
    trace_id: z.string().optional(),
  })
  .loose();

/**
 * Per-attempt timeout for one fragment request: the shared 30 s floor, scaled
 * to ~3× the fragment's realtime duration for ASR headroom, capped at 15 min
 * so the bounded retry loop cannot hang for hours.
 */
export function fragmentTimeoutMs(durationSeconds: number): number {
  const scaled = Math.round(durationSeconds * 3) * 1000;
  return Math.min(Math.max(REQUEST_TIMEOUT_MS, scaled), 900_000);
}

/** RMS amplitude (0–1) of a sample window — pure, no allocation. */
function windowRms(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  for (let i = start; i < start + length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / length);
}

/**
 * Choose the cut sample for a fragment ending near `ideal`: scan the lookback
 * window in fixed frames and keep the LATEST frame whose RMS is strictly
 * below the hard-cut frame's, so the cut moves only into a genuinely quieter
 * stretch — a silence gap when one exists — and stays at the hard boundary
 * when the window is uniformly speech.
 */
function chooseCutSample(
  samples: Float32Array,
  sampleRate: number,
  ideal: number,
  fragmentStart: number,
): number {
  const lookback = Math.min(
    ideal - fragmentStart,
    Math.round(BOUNDARY_LOOKBACK_SECONDS * sampleRate),
  );
  const frame = Math.max(1, Math.round((sampleRate * BOUNDARY_FRAME_MS) / 1000));
  if (lookback <= frame || ideal - frame < fragmentStart) return ideal;
  const baseline = windowRms(samples, ideal - frame, frame);
  const windowStart = ideal - lookback;
  let best = ideal;
  let bestRms = baseline;
  for (let start = windowStart; start + frame <= ideal; start += frame) {
    const rms = windowRms(samples, start, frame);
    if (rms < baseline && rms <= bestRms) {
      bestRms = rms;
      best = start;
    }
  }
  // A cut must always advance the partition — never at/before the start.
  return Math.max(best, fragmentStart + 1);
}

/** Half-open [start, end) sample ranges covering every sample exactly once. */
function partitionSamples(
  samples: Float32Array,
  sampleRate: number,
): Array<{ start: number; end: number }> {
  const maxSamples = Math.floor(MINIMAX_MAX_DURATION_SECONDS * sampleRate);
  const bounds: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < samples.length) {
    const idealEnd = Math.min(start + maxSamples, samples.length);
    const end =
      idealEnd === samples.length
        ? idealEnd
        : chooseCutSample(samples, sampleRate, idealEnd, start);
    bounds.push({ start, end });
    start = end;
  }
  return bounds;
}

export class MiniMaxClient implements TranscriptionProvider {
  readonly id = 'minimax' as const;

  private readonly bus: EventBus<EventMap>;
  private readonly getApiKey: () => string;
  private readonly prepareAudio: MiniMaxAudioPort;
  private readonly encodeWav: WavEncoderPort;

  constructor(
    bus: EventBus<EventMap>,
    getApiKey: () => string,
    prepareAudio: MiniMaxAudioPort,
    encodeWav: WavEncoderPort,
  ) {
    this.bus = bus;
    this.getApiKey = getApiKey;
    this.prepareAudio = prepareAudio;
    this.encodeWav = encodeWav;
  }

  /**
   * Send audio to MiniMax for transcription (translation is not part of the
   * documented contract — the UI disables that mode while this provider is
   * active, and the request mode is ignored here). Recordings beyond the
   * per-request duration limit are split into ordered fragments; the returned
   * result is the single joined Transcripción for the whole take.
   *
   * Emits `transcription:start` once, then `transcription:success` once (or
   * `transcription:error`) through the event bus. The per-fragment status
   * names the fragment in flight; a fragment failure fails the take without
   * emitting partial text.
   *
   * @returns A result carrying the joined `text` and the total audio `duration`.
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

    let decoded: MiniMaxDecodedAudio;
    try {
      decoded = await this.prepareAudio(blob);
    } catch (cause) {
      throw this.fail({
        kind: 'parse',
        message: 'No se pudo convertir el audio para MiniMax.',
        cause,
      });
    }
    if (decoded.samples.length === 0 || decoded.sampleRate <= 0) {
      throw this.fail({
        kind: 'incompatible',
        message: 'El audio está vacío; no hay nada que transcribir.',
      });
    }

    const fragments = partitionSamples(decoded.samples, decoded.sampleRate);
    const totalDuration = decoded.samples.length / decoded.sampleRate;
    this.bus.emit('transcription:start', MINIMAX_ASR_MODEL);

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    // Language hint travels as a HEADER per the documented contract; only
    // documented codes are sent, anything else enables mixed-language mode.
    if (request.language && MINIMAX_SUPPORTED_LANGUAGES.has(request.language)) {
      headers.language = request.language;
    }

    // Ordered fragment outcomes — one entry per fragment once it succeeds.
    // (Lifted into resumable recovery by the long-audio recovery ticket.)
    const texts: string[] = [];
    for (let index = 0; index < fragments.length; index++) {
      const fragment = fragments[index];
      if (!fragment) continue;
      const fragmentSeconds = (fragment.end - fragment.start) / decoded.sampleRate;
      const wav = this.encodeWav(
        decoded.samples.subarray(fragment.start, fragment.end),
        decoded.sampleRate,
      );
      if (wav.size > MINIMAX_MAX_REQUEST_BYTES) {
        throw this.fail({
          kind: 'incompatible',
          message: 'Un fragmento de audio supera el límite de 50 MB por petición de MiniMax.',
        });
      }

      this.bus.emit('status:change', {
        message:
          fragments.length > 1
            ? `Procesando con MiniMax… (fragmento ${index + 1} de ${fragments.length})`
            : 'Procesando con MiniMax…',
        level: 'processing',
      });

      const form = new FormData();
      form.append('model', MINIMAX_ASR_MODEL);
      form.append('file', wav, 'audio.wav');
      form.append('response_format', 'json');
      form.append('stream', 'false');

      const res = await runTranscriptionFetch(
        this.bus,
        (signal) => fetch(MINIMAX_ENDPOINT, { method: 'POST', headers, body: form, signal }),
        externalSignal,
        fragmentTimeoutMs(fragmentSeconds),
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
      texts.push(parsed.data.text);
    }

    const result: TranscriptionResult = {
      text: texts.filter((t) => t.length > 0).join(' '),
      duration: totalDuration,
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
