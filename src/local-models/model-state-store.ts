/**
 * Estado lógico de Modelos locales — IndexedDB persistence via Dexie.
 *
 * Mirrors the `recordings-db` / `escritos-db` modules: lazy singleton over a
 * dedicated database (`lu-yume-local-models`) holding the Motor local's
 * logical records (state, revision, byte counters, verification flag). The
 * heavy artifacts themselves live in the Cache API (see `artifact-store`);
 * this store only tracks what the browser should still have.
 *
 * SRP: structured persistence of model lifecycle records — nothing else.
 * DIP: the download engine depends on {@link LogicalStateStorePort}, never on
 * Dexie; this module is the production adapter plus a test reset helper.
 */

import Dexie, { type Table } from 'dexie';
import type { LocalModelRecord, LogicalStateStorePort } from './download-engine';

/**
 * Per-model local performance data (benchmark rows land with T8). Kept in a
 * dedicated table so "delete performance data" is a separate action from
 * "delete model" and never touches Grabaciones (different database).
 */
export interface LocalModelPerfRow {
  /** Catalog entry id (primary key). */
  modelId: string;
  /** Rows of benchmark measurements (shape finalized by T8). */
  measurements: unknown[];
  updatedAt: number;
}

class YumeLocalModelsDB extends Dexie {
  modelStates!: Table<LocalModelRecord, string>;
  modelPerf!: Table<LocalModelPerfRow, string>;

  constructor() {
    super('lu-yume-local-models');
    // v2 adds the perf table (T6); v1 DBs upgrade in place.
    this.version(1).stores({ modelStates: 'modelId, state' });
    this.version(2).stores({ modelStates: 'modelId, state', modelPerf: 'modelId' });
  }
}

let dbInstance: YumeLocalModelsDB | null = null;

/** Lazily open the singleton DB connection. */
function db(): YumeLocalModelsDB {
  if (!dbInstance) dbInstance = new YumeLocalModelsDB();
  return dbInstance;
}

/** Drop the cached connection (test helper for isolation across files). */
export function __resetLocalModelStatesForTests(): void {
  dbInstance?.close();
  dbInstance = null;
}

/** Production adapter consumed by the composition root. */
export const logicalStateStore: LogicalStateStorePort = {
  async get(modelId: string): Promise<LocalModelRecord | null> {
    return (await db().modelStates.get(modelId)) ?? null;
  },
  async put(record: LocalModelRecord): Promise<void> {
    await db().modelStates.put(record);
  },
};

/**
 * Delete the local performance data of one model. Separate action from
 * {@link deleteModel} flows by design (spec story 52): it never touches
 * model weights, the logical record, or Grabaciones.
 */
export async function clearLocalPerfData(modelId: string): Promise<void> {
  await db().modelPerf.delete(modelId);
}
