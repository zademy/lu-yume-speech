import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCrossTabLock,
  createFallbackLock,
  LOCAL_MODELS_LOCK_NAME,
} from '../../src/local-models/cross-tab-lock';

/** Fake navigator.locks holder for injection. */
function setLocks(value: unknown): void {
  Object.defineProperty(navigator, 'locks', { value, configurable: true });
}

afterEach(() => {
  setLocks(undefined);
  localStorage.clear();
  vi.useRealTimers();
});

describe('createCrossTabLock — Web Locks available', () => {
  it('runs the work and returns its value when the lock is free', async () => {
    const held: string[] = [];
    setLocks({
      request: async (
        name: string,
        _options: unknown,
        callback: (lock: unknown) => Promise<unknown>,
      ) => callback({ name }),
    });
    const lock = createCrossTabLock();

    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => {
      held.push(LOCAL_MODELS_LOCK_NAME);
      return 42;
    });

    expect(outcome).toEqual({ ok: true, value: 42 });
    expect(held).toEqual([LOCAL_MODELS_LOCK_NAME]);
  });

  it('reports busy-other-tab when ifAvailable yields no lock', async () => {
    setLocks({
      request: async () => undefined,
    });
    const lock = createCrossTabLock();

    const ran = vi.fn();
    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => {
      ran();
      return 1;
    });

    expect(outcome).toEqual({ ok: false, reason: 'busy-other-tab' });
    expect(ran).not.toHaveBeenCalled();
  });
});

describe('createCrossTabLock — localStorage fallback (no Web Locks)', () => {
  it('claims, runs the work and releases the storage key', async () => {
    setLocks(undefined);
    const lock = createFallbackLock({ jitter: () => 0 });

    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => 'done');

    expect(outcome).toEqual({ ok: true, value: 'done' });
    expect(localStorage.getItem('lu-yume-local-models.lock')).toBeNull();
  });

  it('reports busy-other-tab while another tab holds a fresh claim', async () => {
    setLocks(undefined);
    const holder = createFallbackLock({ jitter: () => 0 });
    const contender = createFallbackLock({ jitter: () => 0 });

    const gate = { resolve: null as null | (() => void) };
    const held = holder.withLock(LOCAL_MODELS_LOCK_NAME, () => {
      const waiting = new Promise<void>((resolve) => {
        gate.resolve = resolve;
      });
      return waiting.then(() => 'holder-done');
    });
    // Wait until the claim is written AND the work actually started (the
    // tie-break wait delays work by one macrotask).
    await vi.waitFor(() => {
      const raw = localStorage.getItem('lu-yume-local-models.lock');
      if (!raw) throw new Error('not claimed yet');
      expect(JSON.parse(raw).tabId).toBeTruthy();
      if (gate.resolve === null) throw new Error('work not started yet');
    });

    const ran = vi.fn();
    const outcome = await contender.withLock(LOCAL_MODELS_LOCK_NAME, async () => {
      ran();
      return 'contender';
    });

    expect(outcome).toEqual({ ok: false, reason: 'busy-other-tab' });
    expect(ran).not.toHaveBeenCalled();
    gate.resolve?.();
    await expect(held).resolves.toEqual({ ok: true, value: 'holder-done' });
  });

  it('reclaims a stale claim from a crashed tab', async () => {
    setLocks(undefined);
    localStorage.setItem(
      'lu-yume-local-models.lock',
      JSON.stringify({ tabId: 'crashed-tab', heldAt: Date.now() - 60_000 }),
    );
    const lock = createFallbackLock({ jitter: () => 0 });

    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => 'reclaimed');

    expect(outcome).toEqual({ ok: true, value: 'reclaimed' });
    expect(localStorage.getItem('lu-yume-local-models.lock')).toBeNull();
  });

  it('heartbeats the claim while long work runs', async () => {
    vi.useFakeTimers();
    const clock = { now: 1_000_000 };
    const lock = createFallbackLock({ now: () => clock.now, jitter: () => 0 });

    const latch = { resolve: null as null | (() => void) };
    const held = lock.withLock(LOCAL_MODELS_LOCK_NAME, () => {
      const waiting = new Promise<void>((resolve) => {
        latch.resolve = resolve;
      });
      return waiting.then(() => 'ok');
    });
    await vi.advanceTimersByTimeAsync(0);
    const heldAt = () => {
      const raw = localStorage.getItem('lu-yume-local-models.lock');
      return raw ? (JSON.parse(raw) as { heldAt: number }).heldAt : null;
    };
    const initial = heldAt();
    expect(initial).toBe(1_000_000);

    clock.now += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(heldAt()).toBe(1_005_000);

    clock.now += 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(heldAt()).toBe(1_010_000);

    latch.resolve?.();
    await vi.advanceTimersByTimeAsync(0);
    await expect(held).resolves.toEqual({ ok: true, value: 'ok' });
    expect(heldAt()).toBeNull();
  });

  it('proceeds when storage is broken (never a block)', async () => {
    const broken: Storage = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    const lock = createFallbackLock({ storage: broken, jitter: () => 0 });

    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => 'uncoordinated');

    expect(outcome).toEqual({ ok: true, value: 'uncoordinated' });
  });
});
