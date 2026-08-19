import { afterEach, describe, expect, it } from 'vitest';

import {
  createBrowserStorageAdvisor,
  createCacheArtifactStore,
} from '../../src/local-models/browser-ports';

/** Install (or remove) a fake navigator.storage on the jsdom navigator. */
function setStorage(value: unknown): void {
  Object.defineProperty(navigator, 'storage', { value, configurable: true });
}

afterEach(() => {
  setStorage(undefined);
});

describe('createBrowserStorageAdvisor', () => {
  it('degrades every method to null without navigator.storage', async () => {
    setStorage(undefined);
    const advisor = createBrowserStorageAdvisor();

    expect(await advisor.estimate()).toBeNull();
    expect(await advisor.persisted()).toBeNull();
    expect(await advisor.requestPersistence()).toBeNull();
  });

  it('degrades to null when the methods are absent', async () => {
    setStorage({});
    const advisor = createBrowserStorageAdvisor();

    expect(await advisor.estimate()).toBeNull();
    expect(await advisor.persisted()).toBeNull();
    expect(await advisor.requestPersistence()).toBeNull();
  });

  it('maps a working navigator.storage onto the port', async () => {
    setStorage({
      estimate: async () => ({ usage: 10, quota: 20 }),
      persisted: async () => false,
      persist: async () => true,
    });
    const advisor = createBrowserStorageAdvisor();

    expect(await advisor.estimate()).toEqual({ usageBytes: 10, quotaBytes: 20 });
    expect(await advisor.persisted()).toBe(false);
    expect(await advisor.requestPersistence()).toBe(true);
  });

  it('returns null when the estimate lacks numeric fields', async () => {
    setStorage({ estimate: async () => ({}) });
    const advisor = createBrowserStorageAdvisor();

    expect(await advisor.estimate()).toBeNull();
  });

  it('swallows API errors into null (advisory only)', async () => {
    setStorage({
      estimate: async () => {
        throw new Error('boom');
      },
      persisted: async () => {
        throw new Error('boom');
      },
      persist: async () => {
        throw new Error('boom');
      },
    });
    const advisor = createBrowserStorageAdvisor();

    expect(await advisor.estimate()).toBeNull();
    expect(await advisor.persisted()).toBeNull();
    expect(await advisor.requestPersistence()).toBeNull();
  });
});

describe('createCacheArtifactStore', () => {
  it('returns null when the Cache API is unavailable (jsdom)', () => {
    expect(createCacheArtifactStore()).toBeNull();
  });
});
