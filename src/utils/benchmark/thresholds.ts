/**
 * Public label thresholds for the local-model catalog (spec T8).
 *
 * The precision and speed labels shown on the model cards derive from the
 * published benchmark numbers through THESE thresholds — nothing else.
 * They are deliberately coarse buckets over global WER and RTF so small
 * measurement noise never flips a label. Changing a threshold is a public
 * decision: document it in docs/benchmark.md and bump resultsVersion.
 *
 * Threshold rationale (v1, measured on the synthesized ES/EN corpus):
 * - WER ≤ 8% on clean+noisy synthesized speech ≈ usable daily dictation
 *   → 'high'. WER ≤ 20% ≈ understandable drafts → 'medium'. Above → 'basic'.
 * - RTF (seconds of inference per second of audio) ≤ 0.5 feels live →
 *   'fast'. ≤ 1.5 still quicker than re-recording → 'balanced'. Above →
 *   'slow'.
 */

import type { LocalModelPrecision, LocalModelSpeed } from '../local-model-catalog';

/** Global WER above which precision labels cap at 'basic'. */
export const WER_MEDIUM_MAX = 0.2;
/** Global WER at (or below) which precision labels reach 'high'. */
export const WER_HIGH_MAX = 0.08;
/** Relative-time factor at (or below) which speed labels reach 'fast'. */
export const RTF_FAST_MAX = 0.5;
/** Relative-time factor above which speed labels cap at 'slow'. */
export const RTF_SLOW_MIN = 1.5;

/** Precision bucket from the benchmark global WER. */
export function derivePrecision(globalWer: number): LocalModelPrecision {
  if (globalWer <= WER_HIGH_MAX) return 'high';
  if (globalWer <= WER_MEDIUM_MAX) return 'medium';
  return 'basic';
}

/** Speed bucket from the benchmark relative-time factor (lower = faster). */
export function deriveSpeed(rtf: number): LocalModelSpeed {
  if (rtf <= RTF_FAST_MAX) return 'fast';
  if (rtf <= RTF_SLOW_MIN) return 'balanced';
  return 'slow';
}
