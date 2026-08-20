/**
 * Construcción de entradas de historial con procedencia — pure mapping.
 *
 * Single responsibility: turn the transcription outcome plus the app's
 * method/provider/model selections into a {@link HistoryEntry} that records
 * full provenance per spec: Método, provider/model + revision, effective
 * backend, requested/detected language and mode. Pure so the mapping is
 * unit-testable without the pipeline.
 */

import type {
  AppSettings,
  HistoryEntry,
  OperationMode,
  TranscriptionOptions,
  TranscriptionResult,
} from '../types';
import { CLOUDFLARE_WHISPER_MODEL } from '../types';

/** Inputs for {@link buildHistoryEntry}. */
export interface HistoryEntryInput {
  /** Live settings snapshot at success time. */
  config: AppSettings;
  /** Options read from the transcription controls. */
  options: TranscriptionOptions;
  /** Provider result (local results carry `provenance`). */
  result: TranscriptionResult;
  /** Post-processed text actually stored. */
  text: string;
  mode: OperationMode;
  now: number;
}

/**
 * Build the history entry. Local transcriptions stamp method + model id +
 * revision + effective backend from the result's provenance; remote ones
 * stamp the provider (Groq stays implicit) and the worker's fixed model.
 */
export function buildHistoryEntry(input: HistoryEntryInput): HistoryEntry {
  const { config, options, result, text, mode, now } = input;
  const isLocal = config.transcriptionMethod === 'local';
  const isWorker = !isLocal && config.transcriptionProvider === 'cloudflare-whisper';

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    text,
    language: result.language,
    model: isWorker ? CLOUDFLARE_WHISPER_MODEL : options.model,
    method: config.transcriptionMethod,
    provider: isWorker ? 'cloudflare-whisper' : undefined,
    duration: result.duration,
    createdAt: now,
    operationMode: mode,
  };

  if (isLocal) {
    entry.localModelId = result.provenance?.modelId ?? config.localModelId ?? undefined;
    if (result.provenance) {
      entry.localModelRevision = result.provenance.revision;
      entry.backend = result.provenance.backend;
    }
  }
  return entry;
}
