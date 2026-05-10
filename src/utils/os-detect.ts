/**
 * Operating system detection utility.
 *
 * Detects the user's platform from the user agent and provides
 * the correct modifier key information for keyboard shortcuts.
 *
 * SRP: This module's sole responsibility is OS detection.
 * OCP: Consumers use the OSDetection interface — new platforms
 *      can be added here without changing any other module.
 */

export interface OSDetection {
  /** True when running on macOS */
  readonly isMac: boolean;
  /** Human-readable modifier key label: "⌥" on Mac, "Ctrl" elsewhere */
  readonly modifierLabel: string;
}

/** Cached result to avoid repeated string matching on every keystroke. */
let cached: OSDetection | null = null;

/**
 * Detect the user's operating system.
 * Result is computed once and cached for the session.
 */
export function detectOS(): OSDetection {
  if (cached) return cached;

  const isMac = navigator.userAgent.toLowerCase().includes('mac');

  cached = {
    isMac,
    modifierLabel: isMac ? '⌥' : 'Ctrl',
  };

  return cached;
}
