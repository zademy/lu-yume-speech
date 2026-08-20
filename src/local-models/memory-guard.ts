/**
 * Guard de memoria por tier del Motor local — pure heuristic.
 *
 * Decides, from a model's memory tier and the device's reported RAM,
 * whether loading/downloading deserves a warning or must be blocked.
 * `navigator.deviceMemory` is coarse and Chrome-only: when unknown the
 * guard stays silent (unreliable signals never block anything).
 */

import type { LocalModelMemoryTier } from '../types';

/** Minimum reported GB each tier is comfortable with (heuristic). */
const TIER_MIN_GB: Record<LocalModelMemoryTier, number> = {
  light: 1,
  medium: 2,
  high: 4,
  'very-high': 6,
};

/** Verdict of {@link memoryTierGuard}. */
export type MemoryGuardVerdict =
  { level: 'ok' } | { level: 'warn'; minGb: number } | { level: 'block'; minGb: number };

/**
 * Guard a tier against the device's reported RAM. Pure.
 *
 * - unknown RAM → 'ok' (never act on an unreliable signal);
 * - reported GB below the tier minimum → 'warn';
 * - 'very-high' on ≤2 GB devices → 'block' (extreme mismatch only — every
 *   other tier warns so capable hardware is never blocked by a guess).
 */
export function memoryTierGuard(
  tier: LocalModelMemoryTier,
  deviceMemoryGb: number | null,
): MemoryGuardVerdict {
  if (deviceMemoryGb === null || !Number.isFinite(deviceMemoryGb) || deviceMemoryGb <= 0) {
    return { level: 'ok' };
  }
  const minGb = TIER_MIN_GB[tier];
  if (deviceMemoryGb >= minGb) return { level: 'ok' };
  if (tier === 'very-high' && deviceMemoryGb <= 2) return { level: 'block', minGb };
  return { level: 'warn', minGb };
}
