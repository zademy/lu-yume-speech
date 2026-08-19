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
import type { InferenceWorkerFactory, InferenceWorkerLike } from './local-whisper-provider';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

/**
 * Cache API adapter, or `null` when the browser has no Cache Storage
 * (insecure context / very old browser) — the section stays informational.
 */
export function createCacheArtifactStore(): CacheArtifactStore | null {
  if (typeof caches === 'undefined') return null;
  return new CacheArtifactStore({ cacheStorage: caches });
}

/**
 * Inference-worker factory: bundles `inference-worker.ts` as a same-origin
 * module worker (spec: `worker-src 'self'`, no blob workers). Returns null
 * when `Worker` is unavailable so the provider can degrade honestly.
 */
export const createInferenceWorker: InferenceWorkerFactory = () => {
  if (typeof Worker === 'undefined') return null;
  const worker = new Worker(new URL('./inference-worker.ts', import.meta.url), {
    type: 'module',
  });
  const adapter: InferenceWorkerLike = {
    postMessage(message: WorkerRequest, transfer?: Transferable[]): void {
      worker.postMessage(message, transfer ?? []);
    },
    terminate(): void {
      worker.terminate();
    },
    onMessage(handler: (data: unknown) => void): void {
      worker.onmessage = (event: MessageEvent) => handler(event.data as WorkerResponse);
    },
  };
  return adapter;
};

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
