import { invoke } from '@tauri-apps/api/core';
import type { Platform } from './platform';
import type { AppSettings } from '../types';
import { apiKeySchema } from './api-key.schema';

/**
 * Desktop platform bridge backed by Rust commands and the OS credential store.
 *
 * This is the supported product path. The API key lives in macOS Keychain
 * or Windows Credential Manager — never in localStorage, never in the JS bundle.
 */
export class TauriBridge implements Platform {
  isDesktop(): boolean {
    return true;
  }

  async hasApiKey(): Promise<boolean> {
    return invoke<boolean>('api_key_has');
  }

  async getApiKey(): Promise<string | null> {
    const key = await invoke<string | null>('api_key_get');
    return key ?? null;
  }

  async setApiKey(key: string): Promise<void> {
    apiKeySchema.parse(key);
    await invoke('api_key_set', { key });
  }

  async deleteApiKey(): Promise<void> {
    await invoke('api_key_delete');
  }

  async loadSettings(): Promise<AppSettings | null> {
    return invoke<AppSettings | null>('settings_load');
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await invoke('settings_save', { value: settings });
  }
}
