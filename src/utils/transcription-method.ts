/**
 * Método de transcripción — pure selection logic.
 *
 * Owns the two-level transcription choice (Método → Proveedor remoto /
 * Modelo activo) as pure functions over {@link AppSettings}: computing the
 * settings patch for a method switch and deciding whether dictation is
 * possible for a given method.
 *
 * SRP: no DOM, no storage, no event bus — wiring lives in the composition
 * root; persistence flows through the Platform seam.
 */

import { CLOUDFLARE_WHISPER_MODEL } from '../types';
import type { AppSettings, TranscriptionMethod, TranscriptionProviderId } from '../types';

/** UI options for the Método de transcripción selector (i18n-keyed labels). */
export const TRANSCRIPTION_METHODS: readonly {
  value: TranscriptionMethod;
  labelKey: string;
}[] = [
  { value: 'remote', labelKey: 'method.remote' },
  { value: 'local', labelKey: 'method.local' },
] as const;

/**
 * Settings patch for switching the Método de transcripción.
 *
 * Deliberately carries ONLY the method field — the last Proveedor remoto and
 * the last Modelo activo persist independently so switching methods never
 * loses either selection.
 */
export function methodChangePatch(
  method: TranscriptionMethod,
): Pick<AppSettings, 'transcriptionMethod'> {
  return { transcriptionMethod: method };
}

/** True when the settings carry a Modelo activo for local transcription. */
export function hasActiveLocalModel(settings: AppSettings): boolean {
  return typeof settings.localModelId === 'string' && settings.localModelId.length > 0;
}

/** Inputs for {@link resolveCanDictate}. */
export interface CanDictateDeps {
  method: TranscriptionMethod;
  /** Active Proveedor remoto has its credential configured. */
  remoteCredentialOk: boolean;
  /** A Modelo activo exists for the local method. */
  localModelReady: boolean;
}

/**
 * Whether dictation may start under the current Método de transcripción.
 * Remote follows the provider credential; local requires an active model —
 * never silently falling back to the other method.
 */
export function resolveCanDictate(deps: CanDictateDeps): boolean {
  return deps.method === 'local' ? deps.localModelReady : deps.remoteCredentialOk;
}

/**
 * True when the Groq-only knobs (model, translate, prompt, temperature,
 * response format, timestamps) must lock: under the local method no remote
 * provider is in play, and the worker provider uses a fixed server-side model.
 */
export function remoteKnobsLocked(
  method: TranscriptionMethod,
  provider: TranscriptionProviderId,
): boolean {
  return method === 'local' || provider === 'cloudflare-whisper';
}

/** Descriptor of the Modelo de transcripción vigente (see CONTEXT.md). */
export type ActiveTranscription =
  | { kind: 'groq'; model: string }
  | { kind: 'worker'; model: string }
  | { kind: 'local'; modelId: string }
  | { kind: 'none' };

/**
 * The setup that will produce the next Transcripción: the composite of
 * Método de transcripción + Proveedor remoto/modelo (or Modelo activo under
 * local). Reflects the persisted selection — it says nothing about whether
 * the credential or the download is in place (`resolveCanDictate` owns that).
 */
export function resolveActiveTranscription(settings: AppSettings): ActiveTranscription {
  if (settings.transcriptionMethod === 'local') {
    return hasActiveLocalModel(settings)
      ? { kind: 'local', modelId: settings.localModelId as string }
      : { kind: 'none' };
  }
  return settings.transcriptionProvider === 'cloudflare-whisper'
    ? { kind: 'worker', model: CLOUDFLARE_WHISPER_MODEL }
    : { kind: 'groq', model: settings.model };
}
