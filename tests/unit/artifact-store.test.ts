import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_MODEL_CACHE_NAME,
  CacheArtifactStore,
  artifactUrl,
  type CacheLike,
  type CacheStorageLike,
} from '../../src/local-models/artifact-store';

/** In-memory CacheStorage fake keyed by request URL (fresh Response per match, like the real API). */
function fakeCacheStorage(): CacheStorageLike & {
  entries: Map<string, { bytes: ArrayBuffer; contentType: string }>;
} {
  const entries = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  const cache: CacheLike = {
    async match(request) {
      const stored = entries.get(request);
      return stored
        ? new Response(stored.bytes, { headers: { 'content-type': stored.contentType } })
        : undefined;
    },
    async put(request, response) {
      entries.set(request, {
        bytes: await response.arrayBuffer(),
        contentType: response.headers.get('content-type') ?? '',
      });
    },
    async delete(request) {
      return entries.delete(request);
    },
  };
  return {
    async open() {
      return cache;
    },
    entries,
  };
}

/** Build a streamed Response body yielding the given chunks. */
function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** A body that emits one chunk and then hangs until aborted. */
function hangingStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      signal.addEventListener('abort', () => controller.error(new Error('aborted')));
    },
  });
}

const NO_SIGNAL = new AbortController().signal;

describe('artifactUrl', () => {
  it('builds the pinned Hugging Face resolve URL', () => {
    expect(artifactUrl('onnx-community/whisper-base', 'abc123', 'onnx/encoder.onnx')).toBe(
      'https://huggingface.co/onnx-community/whisper-base/resolve/abc123/onnx/encoder.onnx',
    );
  });
});

describe('CacheArtifactStore', () => {
  it('streams an artifact into the dedicated cache, reporting byte deltas', async () => {
    const storage = fakeCacheStorage();
    const store = new CacheArtifactStore({
      cacheStorage: storage,
      fetchImpl: async () =>
        new Response(streamOf(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
    });

    const deltas: number[] = [];
    await store.storeArtifact('https://example.test/a.bin', NO_SIGNAL, (delta) =>
      deltas.push(delta),
    );

    expect(deltas).toEqual([3, 2]);
    const cached = storage.entries.get('https://example.test/a.bin');
    expect(cached?.bytes.byteLength).toBe(5);
    expect(cached?.contentType).toBe('application/octet-stream');
  });

  it('caches the full body even when the response has no stream', async () => {
    const storage = fakeCacheStorage();
    const store = new CacheArtifactStore({
      cacheStorage: storage,
      fetchImpl: async () =>
        ({
          ok: true,
          headers: new Headers(),
          arrayBuffer: async () => new Uint8Array([7, 7, 7]).buffer,
        }) as unknown as Response,
    });

    const deltas: number[] = [];
    await store.storeArtifact('https://example.test/nb.bin', NO_SIGNAL, (d) => deltas.push(d));

    expect(deltas).toEqual([3]);
    expect(storage.entries.get('https://example.test/nb.bin')?.bytes.byteLength).toBe(3);
  });

  it('matches only exact-size artifacts and evicts mismatched ones', async () => {
    const storage = fakeCacheStorage();
    storage.entries.set('https://example.test/ok.bin', {
      bytes: new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer,
      contentType: '',
    });
    storage.entries.set('https://example.test/short.bin', {
      bytes: new Uint8Array([1]).buffer as ArrayBuffer,
      contentType: '',
    });
    const store = new CacheArtifactStore({
      cacheStorage: storage,
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });

    expect(await store.hasArtifact('https://example.test/ok.bin', 4)).toBe(true);
    expect(await store.hasArtifact('https://example.test/ok.bin', 5)).toBe(false);
    expect(await store.hasArtifact('https://example.test/short.bin', 4)).toBe(false);
    expect(await store.hasArtifact('https://example.test/missing.bin', 4)).toBe(false);
    // Size-mismatched entries were dropped to force a clean re-download.
    expect(storage.entries.has('https://example.test/ok.bin')).toBe(false);
  });

  it('throws on HTTP failures without caching anything', async () => {
    const storage = fakeCacheStorage();
    const store = new CacheArtifactStore({
      cacheStorage: storage,
      fetchImpl: async () => new Response('nope', { status: 503 }),
    });

    await expect(
      store.storeArtifact('https://example.test/x.bin', NO_SIGNAL, () => undefined),
    ).rejects.toThrow(/HTTP 503/);
    expect(storage.entries.size).toBe(0);
  });

  it('rejects on abort and leaves no truncated artifact behind', async () => {
    const storage = fakeCacheStorage();
    const controller = new AbortController();
    const store = new CacheArtifactStore({
      cacheStorage: storage,
      fetchImpl: async () => new Response(hangingStream(controller.signal)),
    });

    const pending = store.storeArtifact(
      'https://example.test/hang.bin',
      controller.signal,
      () => undefined,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(storage.entries.size).toBe(0);
  });

  it('uses the versioned cache name', async () => {
    const storage = fakeCacheStorage();
    const open = vi.fn(storage.open.bind(storage));
    const store = new CacheArtifactStore({
      cacheStorage: { open },
      fetchImpl: async () => new Response(new Uint8Array([1])),
    });

    await store.storeArtifact('https://example.test/n.bin', NO_SIGNAL, () => undefined);

    expect(open).toHaveBeenCalledWith(LOCAL_MODEL_CACHE_NAME);
  });
});
