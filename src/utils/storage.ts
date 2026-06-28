/**
 * Persistent storage utility with type-safe access.
 *
 * Wraps localStorage with JSON serialization and error handling.
 * Silently degrades when storage is unavailable (e.g., private browsing,
 * storage quota exceeded).
 *
 * SRP: This module's sole responsibility is key-value persistence.
 * DIP: Consumers depend on these functions (abstraction), not on localStorage directly.
 */

const PREFIX = 'stt_';

/**
 * Read a typed value from localStorage.
 * Returns `defaultValue` when the key is missing or parsing fails.
 */
export function load<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Write a typed value to localStorage.
 * Silently fails when storage is unavailable or full.
 */
export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — non-critical, ignore gracefully
  }
}

/**
 * Remove a key from localStorage.
 */
export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore
  }
}
