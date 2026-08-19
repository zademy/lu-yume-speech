/**
 * Chequeo de espacio previo a la descarga del Motor local — pure math.
 *
 * Single responsibility: decide, from the browser's storage estimate and the
 * model's declared download size, whether there is likely room for the
 * download (model + 25% margin + temporaries). Per spec this is
 * **warning-only**: an unreliable or insufficient estimate never blocks a
 * download, it emits an advisory warning instead.
 */

/** Safety margin over the model size (25%). */
export const SPACE_MARGIN_RATIO = 0.25;

/**
 * Working room for temporaries while an artifact streams into the cache
 * (chunked buffers + response copies). 50 MiB keeps even Large-v3-Turbo's
 * biggest single artifact comfortably covered without inflating small models.
 */
export const SPACE_TEMPORARY_BYTES = 50 * 1024 * 1024;

/** Verdict of {@link evaluateSpace}. */
export type SpaceCheckOutcome =
  | { verdict: 'ok' }
  | { verdict: 'insufficient'; neededBytes: number; availableBytes: number }
  | { verdict: 'unreliable' };

/** Inputs: declared model size plus the browser storage estimate (or null). */
export interface SpaceCheckInput {
  downloadBytes: number;
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** Total bytes the pre-flight wants free before starting a download. Pure. */
export function requiredFreeBytes(downloadBytes: number): number {
  return Math.ceil(downloadBytes * (1 + SPACE_MARGIN_RATIO)) + SPACE_TEMPORARY_BYTES;
}

/**
 * Evaluate free space. Pure.
 *
 * - estimate missing (or partial) → 'unreliable' (warning-only, proceed);
 * - `quota - usage < needed` → 'insufficient' with the numbers for the
 *   warning message (still warning-only per spec);
 * - otherwise 'ok'.
 */
export function evaluateSpace(input: SpaceCheckInput): SpaceCheckOutcome {
  const { usageBytes, quotaBytes } = input;
  if (usageBytes === null || quotaBytes === null || quotaBytes < 0 || usageBytes < 0) {
    return { verdict: 'unreliable' };
  }
  const neededBytes = requiredFreeBytes(input.downloadBytes);
  const availableBytes = Math.max(0, quotaBytes - usageBytes);
  if (availableBytes < neededBytes) {
    return { verdict: 'insufficient', neededBytes, availableBytes };
  }
  return { verdict: 'ok' };
}
