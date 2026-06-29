/**
 * Audio clip storage module backed by IndexedDB.
 *
 * Stores recorded audio Blobs keyed by their HistoryEntry ID.
 * This is the binary counterpart to history-repo.ts (which stores
 * metadata in localStorage). The two are always kept in sync:
 * when a history entry is deleted or evicted, the corresponding
 * audio clip is deleted here.
 *
 * SRP: One responsibility — persisting and retrieving audio blobs.
 * DIP: No dependency on EventBus or UI; pure data layer.
 *
 * Lifecycle:
 * ```ts
 * await audioStore.save('uuid-123', blob, 'audio/webm');
 * const clip = await audioStore.get('uuid-123');  // { blob, mimeType } | null
 * await audioStore.delete('uuid-123');
 * await audioStore.clearAll();
 * ```
 */

const DB_NAME = 'lu-yume-audio';
const DB_VERSION = 1;
const STORE_NAME = 'clips';

/** A stored audio clip record. */
export interface AudioClip {
  readonly id: string;
  readonly blob: Blob;
  readonly mimeType: string;
  readonly createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or create) the IndexedDB database.
 * Caches the connection for reuse.
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });

  return dbPromise;
}

/**
 * Store an audio clip associated with a history entry ID.
 * If a clip with the same ID exists, it is overwritten.
 */
export async function save(id: string, blob: Blob, mimeType: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: AudioClip = { id, blob, mimeType, createdAt: Date.now() };
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });
}

/**
 * Retrieve an audio clip by history entry ID.
 * Returns null if not found.
 */
export async function get(id: string): Promise<AudioClip | null> {
  const db = await openDB();
  return new Promise<AudioClip | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve((request.result as AudioClip | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });
}

/**
 * Delete a single audio clip by ID.
 * No-op if the clip doesn't exist.
 */
export async function remove(id: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });
}

/**
 * Delete multiple audio clips in a single transaction.
 * Used when history entries are evicted (FIFO) or bulk-deleted.
 */
export async function removeMany(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction error'));
  });
}

/**
 * Delete all audio clips.
 */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });
}
