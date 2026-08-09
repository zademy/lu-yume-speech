import type { AppSettings } from '../types';
import { WebBridge } from './web-bridge';

/**
 * Platform abstraction layer.
 *
 * The ONLY interface the app depends on for credential and settings
 * storage. Concrete implementation:
 *
 *  - {@link WebBridge} — browser storage (localStorage).
 *
 * This boundary enforces Dependency Inversion — the app talks to the
 * abstraction, never to a concrete storage implementation.
 */
export interface Platform {
  hasApiKey(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  loadSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;
}

let cached: Platform | undefined;

/**
 * Return the Platform implementation (browser storage), caching it
 * so all callers share the same instance.
 */
export function detectPlatform(): Platform {
  if (!cached) {
    cached = new WebBridge();
  }
  return cached;
}
