/**
 * Transcription configuration helpers — prompt assembly and config slicing.
 *
 * Pure functions over `AppSettings`: no persistence (that lives in the Platform
 * seam), no DOM, no network. They derive the Whisper initial-prompt string
 * from the user's custom vocabulary and extract the slice of settings that the
 * text post-processing pipeline consumes.
 *
 * SRP: this module only translates settings into API/post-process inputs.
 */

import type { TextPostProcessConfig } from './text-postprocess';
import type { AppSettings } from '../types';

/** Groq Whisper enforces a prompt token budget; keep the vocab well under it. */
const MAX_PROMPT_CHARS = 1024;

/**
 * Build the Whisper initial-prompt string from the custom vocabulary and an
 * optional manual context. Custom words are joined with `", "` (the form
 * Whisper expects for a vocabulary hint); when manual context is also present
 * it is prepended. Returns `undefined` when nothing remains, so callers can
 * omit the parameter entirely.
 *
 * Truncated to `MAX_PROMPT_CHARS` to stay within the model's prompt budget.
 */
export function buildPrompt(customWords: string[], manualPrompt?: string): string | undefined {
  const vocab = customWords
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .join(', ');
  const parts = [manualPrompt?.trim(), vocab].filter((p): p is string => Boolean(p && p.length));
  if (parts.length === 0) return undefined;
  const prompt = parts.join(' ');
  return prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
}

/** Extract the text post-processing config slice from app settings. */
export function toPostProcessConfig(settings: AppSettings): TextPostProcessConfig {
  return {
    customWords: settings.customWords,
    wordCorrectionThreshold: settings.wordCorrectionThreshold,
    customFillerWords: settings.customFillerWords,
  };
}
