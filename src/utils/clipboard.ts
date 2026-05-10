/**
 * Clipboard utility with graceful error handling.
 *
 * Wraps the Clipboard API with a boolean return so callers
 * don't need to know about permission errors or fallbacks.
 *
 * SRP: This module's only job is copying text to the system clipboard.
 */

/**
 * Copy text to the system clipboard.
 *
 * @returns `true` if the copy succeeded, `false` otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
