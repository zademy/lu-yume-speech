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

class YumeLocalModelsDB extends Dexie {
  modelStates!: Table<LocalModelRecord, string>;

  constructor() {
    super('lu-yume-local-models');
    this.version(1).stores({
      modelStates: 'modelId, state',
    });
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
