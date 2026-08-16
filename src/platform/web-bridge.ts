import type { CredentialName, Platform } from './platform';
import type { AppSettings } from '../types';
import { save, load, remove } from '../utils/storage';

/** Storage key per credential. `groq` keeps its historical key — no migration. */
const CREDENTIAL_KEYS: Record<CredentialName, string> = {
  groq: 'groq_api_key',
  worker: 'worker_token',
  gate: 'gate_credential',
};

/* eslint-disable @typescript-eslint/require-await -- Methods are async to satisfy the Platform interface; storage ops are synchronous. */

/**
 * Platform bridge backed by localStorage.
 *
 * All keys flow through {@link save/load/remove} in storage.ts so they
 * consistently use the `stt_` prefix.
 */
export class WebBridge implements Platform {
  async hasCredential(name: CredentialName): Promise<boolean> {
    return Boolean(load<string | null>(CREDENTIAL_KEYS[name], null));
  }

  async getCredential(name: CredentialName): Promise<string | null> {
    return load<string | null>(CREDENTIAL_KEYS[name], null);
  }

  async setCredential(name: CredentialName, value: string): Promise<void> {
    save(CREDENTIAL_KEYS[name], value);
  }

  async deleteCredential(name: CredentialName): Promise<void> {
    remove(CREDENTIAL_KEYS[name]);
  }

  async loadSettings(): Promise<AppSettings | null> {
    return load<AppSettings | null>('settings', null);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    save('settings', settings);
  }
}
