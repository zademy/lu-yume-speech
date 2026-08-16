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
import type { AppSettings } from '../types';
import { WebBridge } from './web-bridge';

/** Named credentials managed through the Platform seam. */
export type CredentialName = 'groq' | 'worker' | 'gate';

export interface Platform {
  hasCredential(name: CredentialName): Promise<boolean>;
  getCredential(name: CredentialName): Promise<string | null>;
  setCredential(name: CredentialName, value: string): Promise<void>;
  deleteCredential(name: CredentialName): Promise<void>;
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
