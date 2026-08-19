/**
 * Resolución de peticiones del Motor local — pure option mapping.
 *
 * Decides, from a {@link TranscriptionRequest} and the active catalog entry,
 * which language code and Whisper task the local engine must run — or which
 * incompatibility makes the request impossible. Pure so every capability
 * combination is unit-testable without a model.
 */

import type { OperationMode } from '../types';
import type { LocalCatalogEntry } from '../utils/local-model-catalog';

/** Resolved worker parameters. */
export interface ResolvedLocalRequest {
  /** ISO-639-1 code; omitted → let the model auto-detect. */
  language?: string;
  task: 'transcribe' | 'translate';
}

/** Why a request cannot run on the active model. */
export type LocalRequestIncompatibility = 'explicit-language-required' | 'translation-unsupported';

/** Outcome of {@link resolveLocalRequest}. */
export type LocalRequestResolution =
  | { ok: true; request: ResolvedLocalRequest }
  | { ok: false; incompatibility: LocalRequestIncompatibility };

/**
 * Map provider-agnostic options onto the active model's capabilities.
 *
 * - `language: 'auto'` → detection when the model supports it, otherwise the
 *   request is rejected: behaviour is never silently guessed (story 42);
 * - `mode: 'translate'` → only when the model declares translation support;
 *   otherwise rejected instead of silently transcribing (story 45).
 */
export function resolveLocalRequest(
  requestedLanguage: string | undefined,
  mode: OperationMode,
  entry: Pick<LocalCatalogEntry, 'autoDetectLanguage' | 'supportsTranslation'>,
): LocalRequestResolution {
  if (mode === 'translate' && !entry.supportsTranslation) {
    return { ok: false, incompatibility: 'translation-unsupported' };
  }

  const language =
    !requestedLanguage || requestedLanguage === 'auto' ? undefined : requestedLanguage;
  if (language === undefined && !entry.autoDetectLanguage) {
    return { ok: false, incompatibility: 'explicit-language-required' };
  }

  return {
    ok: true,
    request: {
      language,
      task: mode === 'translate' ? 'translate' : 'transcribe',
    },
  };
}
