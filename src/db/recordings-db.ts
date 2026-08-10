/**
 * Persistent storage for Grabaciones and Resúmenes, backed by IndexedDB via Dexie.
 *
 * Replaces the former localStorage `history-repo` + `summary-repo` and the raw
 * IndexedDB `audio-store`. The API key, application settings and theme remain in
 * localStorage, owned by `src/platform/` and `src/utils/theme.ts` respectively —
 * this module never touches credential or settings storage.
 *
 * Schema (version 1):
 *   grabaciones — lightweight metadata (no blobs): id PK, +createdAt, +language
 *   audios      — audio blobs keyed by grabación id (1:1 with grabaciones)
 *   resumenes   — SummaryHistory records: id PK, +sourceText
 *
 * Splitting audio blobs into their own store keeps metric queries and sidebar
 * rendering cheap (no blob deserialization) while preserving the Grabación
 * aggregate logically: a grabación is its metadata row plus its audio row.
 *
 * SRP: this module's only job is structured persistence of user content.
 * DIP: consumers depend on these functions, not on Dexie or IndexedDB directly.
 */

import Dexie, { type Table } from 'dexie';
import type {
  GeneratedSummary,
  HistoryEntry,
  OperationMode,
  SummaryHistory,
  WhisperModel,
} from '../types';
import { SUMMARY_HISTORY_MAX_ENTRIES } from '../types';

/** Audio blob + MIME, stored separately for cheap metric queries. */
export interface AudioRecord {
  readonly id: string;
  readonly blob: Blob;
  readonly mimeType: string;
}

/** Lightweight metadata row for a Grabación (no blob). */
export interface GrabacionMeta {
  id: string;
  text: string;
  language?: string;
  model: WhisperModel;
  duration?: number;
  createdAt: number;
  operationMode: OperationMode;
  /** Size of the stored audio blob in bytes (denormalized for cheap totals). */
  audioBytes: number;
  /** MIME type of the stored audio (denormalized; mirrors the audios row). */
  audioMimeType: string;
}

class YumeDB extends Dexie {
  grabaciones!: Table<GrabacionMeta, string>;
  audios!: Table<AudioRecord, string>;
  resumenes!: Table<SummaryHistory, string>;

  constructor() {
    super('lu-yume');
    this.version(1).stores({
      grabaciones: 'id, createdAt, language',
      audios: 'id',
      resumenes: 'id, sourceText',
    });
  }
}

let dbInstance: YumeDB | null = null;

/** Lazily open the singleton DB connection. */
function db(): YumeDB {
  if (!dbInstance) dbInstance = new YumeDB();
  return dbInstance;
}

/** Drop the cached connection (test helper for isolation across files). */
export function __resetForTests(): void {
  dbInstance?.close();
  dbInstance = null;
}

// ---------------------------------------------------------------------------
// Grabaciones
// ---------------------------------------------------------------------------

/**
 * Persist a transcription together with its recorded audio as one Grabación.
 * Overwrites any existing grabación with the same id.
 */
export async function saveGrabacion(
  entry: HistoryEntry,
  blob: Blob,
  mimeType: string,
): Promise<void> {
  const meta: GrabacionMeta = {
    id: entry.id,
    text: entry.text,
    language: entry.language,
    model: entry.model,
    duration: entry.duration,
    createdAt: entry.createdAt,
    operationMode: entry.operationMode,
    audioBytes: blob.size,
    audioMimeType: mimeType,
  };
  const audio: AudioRecord = { id: entry.id, blob, mimeType };
  const database = db();
  await database.transaction('rw', database.grabaciones, database.audios, async () => {
    await database.grabaciones.put(meta);
    await database.audios.put(audio);
  });
}

/** All grabaciones newest-first, without audio blobs (sidebar-friendly). */
export async function getAllGrabaciones(): Promise<HistoryEntry[]> {
  const metas = await db().grabaciones.toArray();
  metas.sort((a, b) => b.createdAt - a.createdAt);
  return metas.map(metaToEntry);
}

/** One grabación by id (without the blob), or undefined when missing. */
export async function getGrabacion(id: string): Promise<HistoryEntry | undefined> {
  const meta = await db().grabaciones.get(id);
  return meta ? metaToEntry(meta) : undefined;
}

/** All grabación metadata rows (no blobs), newest-first — for the Métricas panel. */
export async function getAllGrabacionesMeta(): Promise<GrabacionMeta[]> {
  const metas = await db().grabaciones.toArray();
  metas.sort((a, b) => b.createdAt - a.createdAt);
  return metas;
}

/** Fetch the audio for a grabación (playback/download). Null when missing. */
export async function getAudio(id: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const rec = await db().audios.get(id);
  return rec ? { blob: rec.blob, mimeType: rec.mimeType } : null;
}

/** Delete one grabación and its audio atomically. No-op if it does not exist. */
export async function removeGrabacion(id: string): Promise<void> {
  const database = db();
  await database.transaction('rw', database.grabaciones, database.audios, async () => {
    await database.grabaciones.delete(id);
    await database.audios.delete(id);
  });
}

/** Delete every grabación and its audio. */
export async function clearGrabaciones(): Promise<void> {
  const database = db();
  await database.transaction('rw', database.grabaciones, database.audios, async () => {
    await database.grabaciones.clear();
    await database.audios.clear();
  });
}

// ---------------------------------------------------------------------------
// Resúmenes
// ---------------------------------------------------------------------------

/** Find the resumen history belonging to an exact visible-text snapshot. */
export async function getSummaryHistoryBySource(
  sourceText: string,
): Promise<SummaryHistory | undefined> {
  return db().resumenes.where('sourceText').equals(sourceText).first();
}

/** Add one generation, creating its history when needed. */
export async function addSummary(
  sourceText: string,
  summary: GeneratedSummary,
): Promise<SummaryHistory> {
  const database = db();
  return database.transaction('rw', database.resumenes, async () => {
    const existing = await database.resumenes.where('sourceText').equals(sourceText).first();
    if (existing) {
      existing.summaries.push(summary);
      existing.summaries = existing.summaries.slice(-SUMMARY_HISTORY_MAX_ENTRIES);
      existing.updatedAt = summary.createdAt;
      await database.resumenes.put(existing);
      return existing;
    }
    const history: SummaryHistory = {
      id: crypto.randomUUID(),
      sourceText,
      summaries: [summary],
      createdAt: summary.createdAt,
      updatedAt: summary.createdAt,
    };
    await database.resumenes.put(history);
    return history;
  });
}

/** Remove one generated summary and drop its history when it becomes empty. */
export async function removeSummary(
  historyId: string,
  summaryId: string,
): Promise<SummaryHistory | undefined> {
  const database = db();
  return database.transaction('rw', database.resumenes, async () => {
    const history = await database.resumenes.get(historyId);
    if (!history) return undefined;
    const idx = history.summaries.findIndex((s) => s.id === summaryId);
    if (idx === -1) return history;
    history.summaries.splice(idx, 1);
    if (history.summaries.length === 0) {
      await database.resumenes.delete(historyId);
      return undefined;
    }
    history.updatedAt = history.summaries.at(-1)?.createdAt ?? history.createdAt;
    await database.resumenes.put(history);
    return history;
  });
}

/** Count of stored resumen histories (for the Métricas panel). */
export async function countResumenes(): Promise<number> {
  return db().resumenes.count();
}

/** All resumen histories (for JSON export). */
export async function getAllResumenes(): Promise<SummaryHistory[]> {
  return db().resumenes.toArray();
}

/** Delete every resumen history. */
export async function clearResumenes(): Promise<void> {
  await db().resumenes.clear();
}

// ---------------------------------------------------------------------------
// Purge + storage
// ---------------------------------------------------------------------------

/**
 * Purge all user content (grabaciones + audios + resúmenes).
 * Credentials, settings and theme are untouched — they live in localStorage.
 */
export async function purgeAll(): Promise<void> {
  const database = db();
  await database.transaction(
    'rw',
    database.grabaciones,
    database.audios,
    database.resumenes,
    async () => {
      await database.grabaciones.clear();
      await database.audios.clear();
      await database.resumenes.clear();
    },
  );
}

/**
 * Origin storage estimate (quota + usage). Degrades to zeros when the
 * Storage API is unavailable (older browsers, non-secure contexts, tests).
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  const estimate = readHostStorage()?.estimate;
  if (typeof estimate !== 'function') return { usage: 0, quota: 0 };
  try {
    const est = await estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

/**
 * Request persistent storage so the browser resists evicting user content under
 * storage pressure. No-op (returns false) where the API is unavailable.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const persist = readHostStorage()?.persist;
  if (typeof persist !== 'function') return false;
  try {
    return await persist();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The Storage API is optional (older browsers, non-secure contexts, the test runner). */
interface HostStorage {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persist?: () => Promise<boolean>;
}
interface HostNavigator {
  storage?: HostStorage;
}

/** Read the host Storage API without assuming the DOM-typed `navigator` is present. */
function readHostStorage(): HostStorage | undefined {
  const navigator = globalThis.navigator as HostNavigator | undefined;
  return navigator?.storage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metaToEntry(m: GrabacionMeta): HistoryEntry {
  return {
    id: m.id,
    text: m.text,
    language: m.language,
    model: m.model,
    duration: m.duration,
    createdAt: m.createdAt,
    operationMode: m.operationMode,
  };
}
