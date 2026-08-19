/**
 * Puertos de navegador del Motor local — thin production adapters.
 *
 * Single responsibility: adapt real browser APIs (Cache Storage,
 * `navigator.storage`) to the download-engine ports. Every function here is
 * a trivially thin wrapper — decisions live in the engine, persistence in
 * the stores — so unit tests exercise the engine through fakes instead.
 */

import { CacheArtifactStore } from './artifact-store';
import type { StorageAdvisorPort } from './download-engine';

/**
 * Cache API adapter, or `null` when the browser has no Cache Storage
 * (insecure context / very old browser) — the section stays informational.
 */
export function createCacheArtifactStore(): CacheArtifactStore | null {
  if (typeof caches === 'undefined') return null;
  return new CacheArtifactStore({ cacheStorage: caches });
}

/** `navigator.storage` advisor; every method degrades to null when absent. */
export function createBrowserStorageAdvisor(): StorageAdvisorPort {
  interface StorageLike {
    estimate?: () => Promise<StorageEstimate>;
    persisted?: () => Promise<boolean>;
    persist?: () => Promise<boolean>;
  }
  const storage = (): StorageLike | undefined => (navigator as { storage?: StorageLike }).storage;

  return {
    async estimate(): Promise<{ usageBytes: number; quotaBytes: number } | null> {
      const estimate = storage()?.estimate;
      if (!estimate) return null;
      try {
        const result = await estimate();
        if (typeof result.usage === 'number' && typeof result.quota === 'number') {
          return { usageBytes: result.usage, quotaBytes: result.quota };
        }
        return null;
      } catch {
        return null;
      }
    },
    async persisted(): Promise<boolean | null> {
      const persisted = storage()?.persisted;
      if (!persisted) return null;
      try {
        return await persisted();
      } catch {
        return null;
      }
    },
    async requestPersistence(): Promise<boolean | null> {
      const persist = storage()?.persist;
      if (!persist) return null;
      try {
        return await persist();
      } catch {
        return null;
      }
    },
  };
}
