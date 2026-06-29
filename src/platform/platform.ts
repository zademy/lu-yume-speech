import type { AppSettings } from '../types';

/**
 * Platform abstraction layer.
 *
 * The ONLY interface the app depends on for credential and settings
 * storage. Concrete implementations:
 *
 *  - {@link TauriBridge} — desktop (OS keychain + file system), the supported product path.
 *  - {@link WebBridge}   — dev/test fallback (localStorage), NOT a supported product path.
 *
 * No module outside `src/platform/` imports `@tauri-apps/api`.
 * This boundary enforces Dependency Inversion — the app talks to the
 * abstraction, never to the concrete Tauri/web implementation.
 */
export interface Platform {
  isDesktop(): boolean;
  hasApiKey(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  loadSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;
}

let cached: Platform | undefined;

/**
 * Detect whether we are running inside Tauri (desktop) or a plain browser
 * (dev/test) and return the appropriate Platform implementation.
 *
 * Uses dynamic import so `@tauri-apps/api` is never bundled for the web
 * fallback path.
 */
export async function detectPlatform(): Promise<Platform> {
  if (cached) return cached;

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;

  const impl: Platform = isTauri
    ? await import('./tauri-bridge').then((m) => new m.TauriBridge())
    : await import('./web-bridge').then((m) => new m.WebBridge());

  cached = impl;
  return impl;
}
