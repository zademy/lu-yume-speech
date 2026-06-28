import type { Platform } from './platform';
import type { AppSettings } from '../types';
import { save, load, remove } from '../utils/storage';

const KEY = 'groq_api_key';

/* eslint-disable @typescript-eslint/require-await -- Methods are async to satisfy the Platform interface; storage ops are synchronous. */

/**
 * Web/dev/test fallback platform bridge backed by localStorage.
 *
 * This is NOT a supported product path — it exists so the SPA can run in
 * `vite dev` without a Tauri shell and so unit tests can mock the Platform
 * interface. The supported product path is desktop via {@link TauriBridge}.
 *
 * All keys flow through {@link save/load/remove} in storage.ts so they
 * consistently use the `stt_` prefix.
 */
export class WebBridge implements Platform {
  isDesktop(): boolean {
    return false;
  }

  async hasApiKey(): Promise<boolean> {
    return Boolean(load<string | null>(KEY, null));
  }

  async getApiKey(): Promise<string | null> {
    return load<string | null>(KEY, null);
  }

  async setApiKey(key: string): Promise<void> {
    save(KEY, key);
  }

  async deleteApiKey(): Promise<void> {
    remove(KEY);
  }

  async loadSettings(): Promise<AppSettings | null> {
    return load<AppSettings | null>('settings', null);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    save('settings', settings);
  }
}
