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
import type { TranscriptionOptions, OperationMode } from '../types';

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
