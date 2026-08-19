/**
 * Almacén de artefactos del Motor local — Cache API adapter.
 *
 * Single responsibility: keep complete model artifacts in a dedicated Cache
 * Storage cache, addressed by their canonical Hugging Face resolve URL. The
 * artifact store port ({@link ArtifactStorePort}) it implements is the only
 * shape the download engine knows — production passes this adapter with the
 * real `caches` global; tests pass fakes.
 *
 * Only fully-received artifacts are cached (`cache.put` happens after the
 * body streams in), so an aborted download leaves nothing behind for the
 * interrupted file — it is simply re-downloaded next time.
 */

import type { ArtifactStorePort } from './download-engine';

/** Dedicated cache (versioned name; bump to invalidate every artifact). */
export const LOCAL_MODEL_CACHE_NAME = 'lu-yume-local-models-v1';

/**
 * Canonical cache key / download URL for one artifact.
 *
 * `huggingface.co/{repo}/resolve/{revision}/{path}` pins the immutable
 * revision; LFS files redirect to `cdn-lfs*.huggingface.co`, which fetch
 * follows transparently (the CDN hosts must be allowed by the deployment's
 * CSP connect-src — see SECURITY.md).
 */
export function artifactUrl(repo: string, revision: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${path}`;
}

/** Minimal Cache surface the adapter uses (jsdom-safe subset). */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

/** Minimal CacheStorage surface (the global `caches` satisfies it). */
export interface CacheStorageLike {
  open(cacheName: string): Promise<CacheLike>;
}

/** Narrow fetch signature so tests can inject a fake without DOM types. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export interface CacheArtifactStoreDeps {
  cacheStorage: CacheStorageLike;
  fetchImpl?: FetchLike;
}

export class CacheArtifactStore implements ArtifactStorePort {
  private readonly cacheStorage: CacheStorageLike;
  private readonly fetchImpl: FetchLike;
  constructor(deps: CacheArtifactStoreDeps) {
    this.cacheStorage = deps.cacheStorage;
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  }
  /** True only when the artifact is cached with exactly `expectedBytes`. */
  async hasArtifact(url: string, expectedBytes: number): Promise<boolean> {
    const cache = await this.cacheStorage.open(LOCAL_MODEL_CACHE_NAME);
    const cached = await cache.match(url);
    if (!cached) return false;
    const buffer = await cached.arrayBuffer();
    if (buffer.byteLength === expectedBytes) return true;
    // Stale or corrupt entry — drop it so the next download is clean.
    await cache.delete(url);
    return false;
  }

  /**
   * Stream one artifact into the cache. The response body is read in chunks
   * (`onDelta` per chunk) and only the reassembled full body is cached, so
   * aborts never leave a truncated artifact behind.
   */
  async storeArtifact(
    url: string,
    signal: AbortSignal,
    onDelta: (deltaBytes: number) => void,
  ): Promise<void> {
    const response = await this.fetchImpl(url, { signal });
    if (!response.ok) {
      throw new Error(`[local-models] artifact fetch failed: HTTP ${response.status} ${url}`);
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    const chunks: Uint8Array[] = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onDelta(value.byteLength);
      }
    } else {
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
      received = buffer.byteLength;
      onDelta(received);
    }

    const body = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const cache = await this.cacheStorage.open(LOCAL_MODEL_CACHE_NAME);
    await cache.put(url, new Response(body.buffer, { headers: { 'content-type': contentType } }));
  }
}
