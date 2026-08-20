/**
 * Lock entre pestañas del Motor local — cross-tab serialization.
 *
 * Single responsibility: serialize every Motor local operation that must not
 * run twice at once (download / delete / update AND inference) across
 * browser tabs, surfacing contention as `busy-other-tab`.
 *
 * Production uses the Web Locks API with `ifAvailable` (another tab holding
 * the lock reports instead of queueing behind it). Browsers without Web
 * Locks fall back to a localStorage claim with a heartbeat: holders refresh
 * a timestamp while working, claims go stale after `STALE_MS` (crashed or
 * killed tabs self-heal), and a short randomized re-check breaks the
 * read-claim race between simultaneous tabs. localStorage failures (private
 * mode, quota) degrade to a no-op lock — coordination is best-effort, never
 * a block. Remote transcription is never gated by this lock in any case.
 */

/** Result of running work under the lock. */
export type LockOutcome<T> = { ok: true; value: T } | { ok: false; reason: 'busy-other-tab' };

/** Port consumed by the download engine and the local provider (injectable for tests). */
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

/** localStorage claim shape for the Web Locks fallback. */
interface LockClaim {
  tabId: string;
  heldAt: number;
}

const FALLBACK_KEY = 'lu-yume-local-models.lock';
/** A claim older than this is considered abandoned (tab crashed/killed). */
const STALE_MS = 15_000;
/** Holder refresh cadence — keeps a live claim away from STALE_MS. */
const HEARTBEAT_MS = 5_000;
/** Randomized re-check window that breaks simultaneous claims. */
const TIE_BREAK_MS = 80;

/** Injected clock so tests can age claims without real waiting. */
export interface FallbackLockDeps {
  now?: () => number;
  storage?: Storage;
  /** Random jitter in ms for the tie-break wait (tests pass 0). */
  jitter?: () => number;
}

/** localStorage-backed best-effort lock (see module doc for the protocol). */
export function createFallbackLock(deps: FallbackLockDeps = {}): CrossTabLockPort {
  const now = deps.now ?? (() => Date.now());
  const storage = deps.storage ?? globalThis.localStorage;
  const jitter = deps.jitter ?? (() => Math.random() * TIE_BREAK_MS);
  const tabId = `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const readClaim = (): LockClaim | null => {
    try {
      const raw = storage.getItem(FALLBACK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<LockClaim>;
      if (typeof parsed.tabId !== 'string' || typeof parsed.heldAt !== 'number') return null;
      return { tabId: parsed.tabId, heldAt: parsed.heldAt };
    } catch {
      return null;
    }
  };
  const writeClaim = (): boolean => {
    try {
      storage.setItem(FALLBACK_KEY, JSON.stringify({ tabId, heldAt: now() } satisfies LockClaim));
      return true;
    } catch {
      return false;
    }
  };
  const isHeldByOther = (claim: LockClaim | null): boolean =>
    claim !== null && claim.tabId !== tabId && now() - claim.heldAt < STALE_MS;

  return {
    async withLock<T>(_name: string, work: () => Promise<T>): Promise<LockOutcome<T>> {
      // Claim: free or stale → write ours; then re-check after a randomized
      // wait so two tabs claiming at once converge on one winner.
      if (isHeldByOther(readClaim())) return { ok: false, reason: 'busy-other-tab' };
      if (!writeClaim()) return { ok: true, value: await work() }; // storage broken → proceed
      await new Promise((resolve) => setTimeout(resolve, jitter()));
      if (isHeldByOther(readClaim())) {
        // Lost the race — the other tab's claim overwrote ours.
        return { ok: false, reason: 'busy-other-tab' };
      }
      const heartbeat = setInterval(() => writeClaim(), HEARTBEAT_MS);
      try {
        return { ok: true, value: await work() };
      } finally {
        clearInterval(heartbeat);
        try {
          if (readClaim()?.tabId === tabId) storage.removeItem(FALLBACK_KEY);
        } catch {
          // Unreachable storage on release — the claim goes stale on its own.
        }
      }
    },
  };
}

/**
 * Production adapter over `navigator.locks`; falls back to the localStorage
 * claim lock when the API is unavailable (spec: coordinated fallback,
 * never a block).
 */
export function createCrossTabLock(): CrossTabLockPort {
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  if (!locks) return createFallbackLock();
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
