/**
 * Settings provider — reads current UI state into typed configuration.
 *
 * This module is the bridge between the DOM (renderer) and the API client.
 * It reads form values from interactive elements and builds a clean
 * TranscriptionOptions object that the GroqClient can consume.
 *
 * SRP: This module's only job is reading settings from the DOM.
 * OCP: When new settings are added to the UI, only this module
 *      and types.ts need to change — not the API client or recorder.
 * DIP: The API client depends on TranscriptionOptions (an interface),
 *      not on DOM elements or this module.
 */

import type { AppElements } from '../ui/renderer';
import type { TranscriptionOptions, OperationMode, AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

/**
 * Read the current transcription settings from the UI.
 *
 * Returns a frozen object so consumers can't accidentally mutate it.
 * This is a pure function — no side effects.
 */
export function readTranscriptionOptions(elements: AppElements): TranscriptionOptions {
  return Object.freeze({
    model: elements.modelSelect.value as TranscriptionOptions['model'],
    language: resolveLanguage(elements),
    prompt: resolvePrompt(elements),
    temperature: parseTemperature(elements.temperatureSlider.value),
    responseFormat: elements.responseFormatSelect.value as TranscriptionOptions['responseFormat'],
    timestampGranularities: resolveTimestampGranularities(
      elements.responseFormatSelect.value,
      elements.timestampToggle.checked,
    ),
  });
}

/**
 * Read the current operation mode (transcribe vs translate).
 */
export function readOperationMode(elements: AppElements): OperationMode {
  return elements.operationModeSelect.value as OperationMode;
}

/**
 * Read the transcription-quality controls into a partial `AppSettings` patch.
 * The patch is merged over the loaded config so unrelated fields are preserved.
 */
export function readQualitySettings(elements: AppElements): Partial<AppSettings> {
  const customWords = elements.customWordsInput.value
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  const fillerRaw = elements.customFillerWordsInput.value.trim();
  const customFillerWords: string[] | null =
    fillerRaw === ''
      ? null // empty → use language defaults
      : fillerRaw
          .split(',')
          .map((w) => w.trim())
          .filter((w) => w.length > 0);

  return {
    customWords,
    wordCorrectionThreshold: parseTemperature(elements.wordCorrectionThresholdSlider.value),
    customFillerWords,
    enableSilenceTrim: elements.silenceTrimToggle.checked,
    enableLlmPostProcess: elements.llmToggle.checked,
    localLlmAuthorized: elements.localLlmAuth.checked,
    llmModel: elements.llmModelInput.value.trim() || DEFAULT_SETTINGS.llmModel,
    llmInstructions: elements.llmInstructionsInput.value,
  };
}

/**
 * Populate the transcription-quality controls from the current settings so the
 * modal reflects persisted state when it is first opened.
 */
export function populateQualitySettings(elements: AppElements, settings: AppSettings): void {
  elements.customWordsInput.value = settings.customWords.join(', ');
  elements.wordCorrectionThresholdSlider.value = String(settings.wordCorrectionThreshold);
  elements.wordCorrectionThresholdValue.textContent = String(settings.wordCorrectionThreshold);
  elements.customFillerWordsInput.value =
    settings.customFillerWords === null ? '' : settings.customFillerWords.join(', ');
  elements.silenceTrimToggle.checked = settings.enableSilenceTrim;
  elements.llmToggle.checked = settings.enableLlmPostProcess;
  elements.localLlmAuth.checked = settings.localLlmAuthorized;
  elements.llmModelInput.value = settings.llmModel;
  elements.llmInstructionsInput.value = settings.llmInstructions;
}

// -----------------------------------------------------------------------
// Private helpers
// -----------------------------------------------------------------------

/**
 * Resolve the language parameter.
 * 'auto' means auto-detect, which is expressed by omitting the param.
 */
function resolveLanguage(elements: AppElements): string | undefined {
  const value = elements.languageSelect.value;
  return value === 'auto' ? undefined : value;
}

/**
 * Resolve the prompt parameter.
 * Empty strings are expressed by omitting the param.
 */
function resolvePrompt(elements: AppElements): string | undefined {
  const value = elements.promptInput.value.trim();
  return value || undefined;
}

/**
 * Parse the temperature slider value (stored as string in DOM).
 * Clamped to [0, 1] for safety.
 */
function parseTemperature(raw: string): number {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Determine timestamp granularities based on response format
 * and the user's word-level toggle.
 *
 * Segment timestamps are free (no extra latency).
 * Word timestamps add latency, so they're opt-in.
 */
function resolveTimestampGranularities(
  format: string,
  includeWords: boolean,
): Array<'word' | 'segment'> | undefined {
  if (format !== 'verbose_json') return undefined;

  if (includeWords) return ['word', 'segment'];
  return ['segment'];
}
