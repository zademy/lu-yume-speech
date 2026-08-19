/**
 * Lock entre pestañas del Motor local — cross-tab serialization.
 *
 * Single responsibility: serialize mutating local-model operations
 * (download / delete / update) across browser tabs. Production uses the Web
 * Locks API with `ifAvailable` (another tab holding the lock surfaces as
 * `busy-other-tab` instead of queueing behind it); browsers without Web
 * Locks fall back to a single-tab no-op lock — coordination is impossible
 * there, so operations proceed (remote transcription is never gated by
 * this lock in any case).
 */

/** Result of running work under the lock. */
export type LockOutcome<T> = { ok: true; value: T } | { ok: false; reason: 'busy-other-tab' };

/** Port consumed by the download engine (injectable for tests). */
export interface CrossTabLockPort {
  withLock<T>(name: string, work: () => Promise<T>): Promise<LockOutcome<T>>;
}

/** Narrow navigator.locks surface (the real API satisfies it). */
interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Production adapter over `navigator.locks`; falls back to a no-op lock
 * when the API is unavailable (spec: coordinated fallback, never a block).
 */
export function createCrossTabLock(): CrossTabLockPort {
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  if (!locks) {
    return {
      async withLock<T>(_name: string, work: () => Promise<T>): Promise<LockOutcome<T>> {
        return { ok: true, value: await work() };
      },
    };
  }
  return {
    async withLock<T>(name: string, work: () => Promise<T>): Promise<LockOutcome<T>> {
      const granted = await locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock === null) return undefined;
        return work();
      });
      return granted === undefined
        ? { ok: false, reason: 'busy-other-tab' }
        : { ok: true, value: granted as T };
    },
  };
}

/** Canonical lock name for every mutating Motor local operation. */
export const LOCAL_MODELS_LOCK_NAME = 'lu-yume-local-models';
