import { afterEach, vi, beforeAll } from 'vitest';

// Node 25 ships a built-in experimental localStorage whose methods are
// stubs (setItem is undefined). It shadows jsdom's implementation on the
// global. Replace both localStorage and sessionStorage with working
// in-memory implementations so tests get a real Web Storage API.
beforeAll(() => {
  const createStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length(): number {
        return store.size;
      },
    };
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createStorage(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
