import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCrossTabLock, LOCAL_MODELS_LOCK_NAME } from '../../src/local-models/cross-tab-lock';

/** Fake navigator.locks holder for injection. */
function setLocks(value: unknown): void {
  Object.defineProperty(navigator, 'locks', { value, configurable: true });
}

afterEach(() => {
  setLocks(undefined);
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

describe('createCrossTabLock — fallback without Web Locks', () => {
  it('always runs the work (single-tab best effort)', async () => {
    setLocks(undefined);
    const lock = createCrossTabLock();

    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => 'done');

    expect(outcome).toEqual({ ok: true, value: 'done' });
  });
});
