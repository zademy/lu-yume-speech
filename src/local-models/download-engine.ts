/**
 * Motor de descarga de Modelos locales — the download slice of the Motor local.
 *
 * Single responsibility: orchestrate ONE catalog download at a time —
 * streaming artifacts into the artifact store (Cache API), keeping the
 * logical record in IndexedDB, and reporting progress, state changes and
 * advisory warnings through the typed EventBus. Pure decisions live in
 * sibling modules (state machine, space check); all I/O hides behind the
 * constructor ports so tests drive everything through this message-style
 * interface (`init` / `requestDownload` / `cancelDownload` / `getRecord`).
 *
 * Invariants (spec + #38):
 * - one active download at a time; a second request returns `busy`;
 * - downloads never block or inspect remote transcription (and vice versa);
 * - cancellation → Descarga parcial (never activatable; the incomplete file
 *   is simply re-downloaded — complete cached artifacts are reused);
 * - only after every artifact is present with its exact declared size does
 *   the state become Descargado (verified);
 * - space / persistence problems are warnings, never blockers.
 */

import type { EventBus } from '../core/event-bus';
import type {
  EventMap,
  LocalModelProgressEvent,
  LocalModelState,
  LocalModelStateEvent,
  LocalModelWarningEvent,
} from '../types';
import type { LocalCatalogEntry } from '../utils/local-model-catalog';
import { artifactUrl } from './artifact-store';
import type { CrossTabLockPort } from './cross-tab-lock';
import { LOCAL_MODELS_LOCK_NAME } from './cross-tab-lock';
import { nextLocalModelState, type LocalModelLifecycleEvent } from './download-state-machine';
import { memoryTierGuard } from './memory-guard';
import { evaluateSpace } from './space-check';

/** Persisted logical record of one Modelo del catálogo. */
export interface LocalModelRecord {
  /** Catalog entry id (primary key). */
  modelId: string;
  /** Logical lifecycle state. */
  state: LocalModelState;
  /** Pinned revision the artifacts belong to. */
  revision: string;
  /** Bytes received (complete cached artifacts included). */
  receivedBytes: number;
  /** Declared total (`downloadBytes`). */
  totalBytes: number;
  /** True only after every artifact verified complete. */
  verified: boolean;
  /** Unix timestamp (ms) of the last transition. */
  updatedAt: number;
}

/** Where complete artifacts live (Cache API in production). */
export interface ArtifactStorePort {
  /** Whether the artifact is cached with exactly `expectedBytes`. */
  hasArtifact(url: string, expectedBytes: number): Promise<boolean>;
  /**
   * Fetch and cache one complete artifact. Rejects on abort (the artifact is
   * then NOT cached) or on any network/HTTP failure; `onDelta` reports
   * streamed byte increments.
   */
  storeArtifact(
    url: string,
    signal: AbortSignal,
    onDelta: (deltaBytes: number) => void,
  ): Promise<void>;
  /** Remove artifacts by canonical URL (deletion / failed-update cleanup). */
  deleteArtifacts(urls: readonly string[]): Promise<void>;
}

/** Logical state persistence (IndexedDB in production). */
export interface LogicalStateStorePort {
  get(modelId: string): Promise<LocalModelRecord | null>;
  put(record: LocalModelRecord): Promise<void>;
}

/** navigator.storage advisor (persistence + quota estimate). */
export interface StorageAdvisorPort {
  estimate(): Promise<{ usageBytes: number; quotaBytes: number } | null>;
  persisted(): Promise<boolean | null>;
  requestPersistence(): Promise<boolean | null>;
}

/** Terminal outcome of a `requestDownload` message. */
export type DownloadRequestOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unknown-model'
        | 'busy'
        | 'invalid-state'
        | 'cancelled'
        | 'download-failed'
        | 'busy-other-tab';
    };

/** Outcome of a `deleteModel` message. */
export type DeleteModelOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'unknown-model' | 'busy' | 'invalid-state' | 'busy-other-tab';
    };

/** Terminal outcome of a `requestUpdate` message (explicit, atomic). */
export type UpdateRequestOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unknown-model'
        | 'busy'
        | 'invalid-state'
        | 'up-to-date'
        | 'cancelled'
        | 'update-failed'
        | 'busy-other-tab';
    };

/** Outcome of a `cancelDownload` message. */
export type CancelDownloadOutcome =
  { ok: true } | { ok: false; reason: 'no-active-download' | 'model-mismatch' };

/** Constructor dependencies — every side effect is a port. */
export interface LocalDownloadEngineDeps {
  catalog: readonly LocalCatalogEntry[];
  artifacts: ArtifactStorePort;
  states: LogicalStateStorePort;
  storage: StorageAdvisorPort;
  bus: EventBus<EventMap>;
  now?: () => number;
  /** Device RAM in GB when reported (memory-tier advisory); null/omitted = unknown. */
  deviceMemoryGb?: number | null;
  /** Cross-tab serialization (Web Locks in production; noop fallback). */
  lock?: CrossTabLockPort;
}

interface ActiveDownload {
  modelId: string;
  controller: AbortController;
}

export class LocalDownloadEngine {
  private readonly deps: LocalDownloadEngineDeps;
  private readonly records = new Map<string, LocalModelRecord>();
  private active: ActiveDownload | null = null;
  private persistenceRequested = false;

  constructor(deps: LocalDownloadEngineDeps) {
    this.deps = deps;
  }

  /**
   * Hydrate persisted records (a Descarga parcial from a previous session
   * must show as partial, not not-downloaded), then reconcile them against
   * what the browser actually still stores: a "downloaded" record whose
   * artifacts the browser evicted becomes Descarga parcial (some files) or
   * No descargado (none) — surfaced as state events so the UI can show
   * instructions, never a technical error. Entries without a record start
   * as an unpersisted `not-downloaded`.
   */
  async init(): Promise<void> {
    for (const entry of this.deps.catalog) {
      const persisted = await this.deps.states.get(entry.id);
      this.records.set(
        entry.id,
        persisted ?? {
          modelId: entry.id,
          state: 'not-downloaded',
          revision: entry.revision,
          receivedBytes: 0,
          totalBytes: entry.downloadBytes,
          verified: false,
          updatedAt: this.now(),
        },
      );
    }
    await this.reconcile();
  }

  /**
   * Compare persisted records with the physical artifact store and repair
   * the logical state (spec story 32). Only `downloaded` records are
   * checked — every other state already assumes missing files. Stale
   * artifacts of a superseded revision are NOT deleted here: updates own
   * their replacement.
   */
  private async reconcile(): Promise<void> {
    for (const entry of this.deps.catalog) {
      const record = this.records.get(entry.id);
      if (!record || record.state !== 'downloaded') continue;

      const artifactUrls = entry.artifacts.map((artifact) =>
        artifactUrl(entry.repo, record.revision, artifact.path),
      );
      let present = 0;
      for (let i = 0; i < entry.artifacts.length; i += 1) {
        const artifact = entry.artifacts[i];
        if (!artifact) continue;
        const complete = await this.deps.artifacts.hasArtifact(
          artifactUrls[i] as string,
          artifact.bytes,
        );
        if (complete) present += 1;
      }
      if (present === entry.artifacts.length) continue;

      // Physical loss: some files are gone. Any file left = Descarga parcial
      // (re-download resumes from the survivors); nothing = No descargado.
      record.state = present > 0 ? 'partial' : 'not-downloaded';
      record.verified = false;
      record.receivedBytes = present > 0 ? present : 0;
      await this.deps.states.put({ ...record });
      this.deps.bus.emit('localModel:state', {
        modelId: entry.id,
        state: record.state,
        previous: 'downloaded',
      });
    }
  }

  /** Read-only snapshot of the logical record (null for unknown ids). */
  getRecord(modelId: string): LocalModelRecord | null {
    const record = this.records.get(modelId);
    return record ? { ...record } : null;
  }

  /** Model id currently downloading, if any. */
  get activeModelId(): string | null {
    return this.active?.modelId ?? null;
  }

  /** Whether a newer catalog revision exists for this model's record. */
  isUpdateAvailable(modelId: string): boolean {
    const entry = this.deps.catalog.find((candidate) => candidate.id === modelId);
    const record = this.records.get(modelId);
    return (
      !!entry && !!record && record.state === 'downloaded' && record.revision !== entry.revision
    );
  }

  /**
   * Message: download a catalog model (one at a time). Resolves when the
   * download reaches a terminal state — downloaded, partial (cancelled) or
   * error — with progress and state changes already emitted on the bus.
   */
  async requestDownload(modelId: string): Promise<DownloadRequestOutcome> {
    const entry = this.deps.catalog.find((candidate) => candidate.id === modelId);
    if (!entry) return { ok: false, reason: 'unknown-model' };
    if (this.active) return { ok: false, reason: 'busy' };

    const record = this.record(modelId);
    if (!nextLocalModelState(record.state, { type: 'download-start' }).ok) {
      return { ok: false, reason: 'invalid-state' };
    }

    const lock = this.deps.lock ?? noopLock;
    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () =>
      this.runDownload(modelId, entry, record),
    );
    if (!outcome.ok) return { ok: false, reason: 'busy-other-tab' };
    return outcome.value;
  }

  /** Download flow — runs holding the cross-tab lock. */
  private async runDownload(
    modelId: string,
    entry: LocalCatalogEntry,
    record: LocalModelRecord,
  ): Promise<DownloadRequestOutcome> {
    const controller = new AbortController();
    this.active = { modelId, controller };
    // Read through a closure: `signal.aborted` can flip between awaits, and
    // direct property reads would be narrowed away by TypeScript.
    const aborted = (): boolean => controller.signal.aborted;

    try {
      await this.preFlightWarnings(entry);
      await this.applyTransition(modelId, { type: 'download-start' });

      const fetched = await this.fetchArtifacts(entry, controller.signal, record.revision);
      if (aborted()) {
        await this.applyTransition(modelId, { type: 'cancelled' });
        return { ok: false, reason: 'cancelled' };
      }
      if (!fetched) {
        await this.applyTransition(modelId, { type: 'failed' });
        return { ok: false, reason: 'download-failed' };
      }

      await this.applyTransition(modelId, { type: 'artifacts-complete' });
      this.deps.bus.emit('localModel:progress', {
        modelId,
        phase: 'preparing',
        receivedBytes: entry.downloadBytes,
        totalBytes: entry.downloadBytes,
        percent: 99,
      });

      if (aborted()) {
        await this.applyTransition(modelId, { type: 'cancelled' });
        return { ok: false, reason: 'cancelled' };
      }
      const verified = await this.verifyArtifacts(entry, record.revision, controller.signal);
      if (aborted()) {
        await this.applyTransition(modelId, { type: 'cancelled' });
        return { ok: false, reason: 'cancelled' };
      }
      if (!verified) {
        await this.applyTransition(modelId, { type: 'verify-failed' });
        return { ok: false, reason: 'download-failed' };
      }
      await this.applyTransition(modelId, { type: 'verified' });
      return { ok: true };
    } catch (error) {
      if (aborted()) {
        await this.applyTransition(modelId, { type: 'cancelled' });
        return { ok: false, reason: 'cancelled' };
      }
      console.error(`[local-models] download of ${modelId} failed:`, error);
      await this.applyTransition(modelId, { type: 'failed' });
      return { ok: false, reason: 'download-failed' };
    } finally {
      this.active = null;
    }
  }

  /**
   * Message: cancel the active download. The engine records Descarga parcial
   * (complete artifacts stay cached; the interrupted one re-downloads).
   */
  cancelDownload(modelId: string): CancelDownloadOutcome {
    if (!this.active) return { ok: false, reason: 'no-active-download' };
    if (this.active.modelId !== modelId) return { ok: false, reason: 'model-mismatch' };
    this.active.controller.abort();
    return { ok: true };
  }

  /**
   * Message: delete a model — weights, partials and the logical record of
   * the revision. Runs under the cross-tab lock; refused while any engine
   * operation is in flight. The caller decides what "deleting the active
   * model" means for the Modelo activo (the engine never switches models
   * or providers on its own).
   */
  async deleteModel(modelId: string): Promise<DeleteModelOutcome> {
    const entry = this.deps.catalog.find((candidate) => candidate.id === modelId);
    if (!entry) return { ok: false, reason: 'unknown-model' };
    if (this.active) return { ok: false, reason: 'busy' };

    const record = this.record(modelId);
    if (!nextLocalModelState(record.state, { type: 'deleted' }).ok) {
      return { ok: false, reason: 'invalid-state' };
    }

    const lock = this.deps.lock ?? noopLock;
    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () => {
      // Remove every artifact of every revision this record may have used:
      // the persisted revision and the current catalog revision (a failed
      // update may have left new-revision partials behind).
      const revisions = new Set([record.revision, entry.revision]);
      const urls: string[] = [];
      for (const revision of revisions) {
        for (const artifact of entry.artifacts) {
          urls.push(artifactUrl(entry.repo, revision, artifact.path));
        }
      }
      await this.deps.artifacts.deleteArtifacts(urls);
      await this.applyTransition(modelId, { type: 'deleted' });
      // 'deleted' lands on not-downloaded; reset the byte counters and pin
      // the record back to the catalog revision.
      const updated = this.record(modelId);
      updated.receivedBytes = 0;
      updated.revision = entry.revision;
      await this.deps.states.put({ ...updated });
      return true;
    });
    if (!outcome.ok) return { ok: false, reason: 'busy-other-tab' };
    return { ok: true };
  }

  /**
   * Message: explicit, atomic model update. The new catalog revision is
   * downloaded and verified ALONGSIDE the old one — the record keeps its
   * old revision (usable, still the Modelo activo) until the new artifacts
   * are complete; only then are the old artifacts deleted and the record
   * repointed. A failure or cancellation cleans up the new-revision
   * artifacts and leaves the old revision exactly as it was (implicit
   * rollback: the old revision is never removed before the new one is
   * verified).
   */
  async requestUpdate(modelId: string): Promise<UpdateRequestOutcome> {
    const entry = this.deps.catalog.find((candidate) => candidate.id === modelId);
    if (!entry) return { ok: false, reason: 'unknown-model' };
    if (this.active) return { ok: false, reason: 'busy' };

    const record = this.record(modelId);
    if (record.state !== 'downloaded') return { ok: false, reason: 'invalid-state' };
    if (record.revision === entry.revision) return { ok: false, reason: 'up-to-date' };

    const lock = this.deps.lock ?? noopLock;
    const outcome = await lock.withLock(LOCAL_MODELS_LOCK_NAME, async () =>
      this.runUpdate(modelId, entry, record),
    );
    if (!outcome.ok) return { ok: false, reason: 'busy-other-tab' };
    return outcome.value;
  }

  /** Update flow — runs holding the cross-tab lock; old revision stays live. */
  private async runUpdate(
    modelId: string,
    entry: LocalCatalogEntry,
    record: LocalModelRecord,
  ): Promise<UpdateRequestOutcome> {
    const oldRevision = record.revision;
    const newRevision = entry.revision;
    const controller = new AbortController();
    this.active = { modelId, controller };
    const aborted = (): boolean => controller.signal.aborted;
    const newArtifactUrls = entry.artifacts.map((artifact) =>
      artifactUrl(entry.repo, newRevision, artifact.path),
    );

    try {
      await this.preFlightWarnings(entry);
      this.emitProgress(modelId, 'downloading', 0, entry.downloadBytes, 0, true);

      let received = 0;
      for (const artifact of entry.artifacts) {
        if (aborted()) throw new DOMException('aborted', 'AbortError');
        const url = artifactUrl(entry.repo, newRevision, artifact.path);
        const cached = await this.deps.artifacts.hasArtifact(url, artifact.bytes);
        if (cached) {
          received += artifact.bytes;
          continue;
        }
        await this.deps.artifacts.storeArtifact(url, controller.signal, (delta) => {
          received += delta;
          this.emitProgress(
            modelId,
            'downloading',
            received,
            entry.downloadBytes,
            progressPercent(received, entry.downloadBytes),
            true,
          );
        });
      }

      if (aborted()) throw new DOMException('aborted', 'AbortError');
      this.emitProgress(modelId, 'preparing', entry.downloadBytes, entry.downloadBytes, 99, true);
      let verified = true;
      for (const artifact of entry.artifacts) {
        if (aborted()) {
          verified = false;
          break;
        }
        const url = artifactUrl(entry.repo, newRevision, artifact.path);
        if (!(await this.deps.artifacts.hasArtifact(url, artifact.bytes))) {
          verified = false;
          break;
        }
      }
      if (aborted()) throw new DOMException('aborted', 'AbortError');
      if (!verified) return { ok: false, reason: 'update-failed' };

      // Success atomically: old artifacts out, record repointed, still
      // downloaded. The record never left 'downloaded', so the old revision
      // stayed usable (and activatable) throughout.
      await this.deps.artifacts.deleteArtifacts(
        entry.artifacts.map((artifact) => artifactUrl(entry.repo, oldRevision, artifact.path)),
      );
      record.revision = newRevision;
      record.receivedBytes = record.totalBytes;
      record.updatedAt = this.now();
      await this.deps.states.put({ ...record });
      this.deps.bus.emit('localModel:state', {
        modelId,
        state: 'downloaded',
        previous: 'downloaded',
      });
      return { ok: true };
    } catch (error) {
      // Rollback by construction: remove the partial new-revision artifacts;
      // the old revision was never touched.
      await this.deps.artifacts.deleteArtifacts(newArtifactUrls).catch(() => undefined);
      if (aborted()) return { ok: false, reason: 'cancelled' };
      console.error(`[local-models] update of ${modelId} failed:`, error);
      return { ok: false, reason: 'update-failed' };
    } finally {
      this.active = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private record(modelId: string): LocalModelRecord {
    const record = this.records.get(modelId);
    if (!record) throw new Error(`[local-models] unknown model "${modelId}" — call init() first`);
    return record;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Pre-flight checks per spec — advisory warnings only, never blockers:
   * space (model + 25% + temporaries, unreliable estimate tolerated) and the
   * one-time persistent-storage request right after the first explicit
   * Download click (denial → eviction warning).
   */
  private async preFlightWarnings(entry: LocalCatalogEntry): Promise<void> {
    try {
      const estimate = await this.deps.storage.estimate();
      const outcome = evaluateSpace({
        downloadBytes: entry.downloadBytes,
        usageBytes: estimate?.usageBytes ?? null,
        quotaBytes: estimate?.quotaBytes ?? null,
      });
      if (outcome.verdict === 'insufficient') {
        this.emitWarning({
          kind: 'space-insufficient',
          modelId: entry.id,
          neededBytes: outcome.neededBytes,
          availableBytes: outcome.availableBytes,
        });
      } else if (outcome.verdict === 'unreliable') {
        this.emitWarning({ kind: 'space-unreliable', modelId: entry.id });
      }
    } catch (error) {
      console.warn('[local-models] storage estimate failed (advisory only):', error);
    }

    // Memory-tier advisory before download (guard is silent when the device
    // reports no RAM — unreliable signals never warn).
    const memoryVerdict = memoryTierGuard(entry.memoryTier, this.deps.deviceMemoryGb ?? null);
    if (memoryVerdict.level === 'warn' || memoryVerdict.level === 'block') {
      this.emitWarning({
        kind: 'memory-tier',
        modelId: entry.id,
        tier: entry.memoryTier,
        deviceMemoryGb: this.deps.deviceMemoryGb as number,
      });
    }

    if (!this.persistenceRequested) {
      this.persistenceRequested = true;
      try {
        const already = await this.deps.storage.persisted();
        if (already !== true) {
          const granted = await this.deps.storage.requestPersistence();
          if (granted === false) {
            this.emitWarning({ kind: 'persistence-denied', modelId: entry.id });
          }
        }
      } catch (error) {
        console.warn('[local-models] persistence request failed (advisory only):', error);
      }
    }
  }

  /**
   * Fetch every artifact, skipping ones already cached complete (partial
   * re-download resumes instead of restarting). Returns false on failure;
   * aborts propagate to the caller, which maps them to Descarga parcial.
   */
  private async fetchArtifacts(
    entry: LocalCatalogEntry,
    signal: AbortSignal,
    revision: string,
  ): Promise<boolean> {
    const record = this.record(entry.id);
    let received = 0;
    let lastPercent = -1;

    const report = (phase: 'downloading', force: boolean): void => {
      const percent = progressPercent(received, entry.downloadBytes);
      if (force || percent !== lastPercent) {
        lastPercent = percent;
        this.emitProgress(entry.id, phase, received, entry.downloadBytes, percent);
      }
    };

    for (const artifact of entry.artifacts) {
      // Honour a cancellation that arrived while an earlier await was still
      // settling (e.g. during pre-flight): registering work under an already
      // aborted signal must stop immediately, not stream a full artifact.
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const url = artifactUrl(entry.repo, revision, artifact.path);
      const cached = await this.deps.artifacts.hasArtifact(url, artifact.bytes);
      if (cached) {
        received += artifact.bytes;
        report('downloading', true);
        continue;
      }
      await this.deps.artifacts.storeArtifact(url, signal, (delta) => {
        received += delta;
        report('downloading', false);
      });
      record.receivedBytes = received;
      await this.deps.states.put({ ...record });
      report('downloading', true);
    }
    record.receivedBytes = received;
    return true;
  }

  /**
   * Every artifact present in the store with its exact declared size. Bails
   * out with false when cancelled mid-verification (caller maps to partial).
   */
  private async verifyArtifacts(
    entry: LocalCatalogEntry,
    revision: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (const artifact of entry.artifacts) {
      if (signal.aborted) return false;
      const url = artifactUrl(entry.repo, revision, artifact.path);
      const present = await this.deps.artifacts.hasArtifact(url, artifact.bytes);
      if (!present) return false;
    }
    return true;
  }

  /** Run one lifecycle transition: update, persist, then emit on the bus. */
  private async applyTransition(modelId: string, event: LocalModelLifecycleEvent): Promise<void> {
    const record = this.record(modelId);
    const transition = nextLocalModelState(record.state, event);
    if (!transition.ok) return;
    const previous = record.state;
    record.state = transition.state;
    record.updatedAt = this.now();
    if (transition.state === 'downloading') {
      record.verified = false;
    } else if (transition.state === 'downloaded') {
      record.verified = true;
      record.receivedBytes = record.totalBytes;
    } else if (
      transition.state === 'partial' ||
      transition.state === 'error' ||
      transition.state === 'not-downloaded'
    ) {
      record.verified = false;
      if (transition.state === 'not-downloaded') record.receivedBytes = 0;
    }
    await this.deps.states.put({ ...record });
    const payload: LocalModelStateEvent = { modelId, state: record.state, previous };
    this.deps.bus.emit('localModel:state', payload);
  }

  private emitProgress(
    modelId: string,
    phase: LocalModelProgressEvent['phase'],
    receivedBytes: number,
    totalBytes: number,
    percent: number,
    isUpdate = false,
  ): void {
    const payload: LocalModelProgressEvent = {
      modelId,
      phase,
      receivedBytes,
      totalBytes,
      percent,
      ...(isUpdate ? { isUpdate: true } : {}),
    };
    this.deps.bus.emit('localModel:progress', payload);
  }

  private emitWarning(warning: LocalModelWarningEvent): void {
    this.deps.bus.emit('localModel:warning', warning);
  }
}

/** Fallback lock used when no cross-tab port is injected (single-tab). */
const noopLock: CrossTabLockPort = {
  async withLock<T>(_name: string, work: () => Promise<T>) {
    return { ok: true, value: await work() };
  },
};

/** Integer 0–99 progress; 100 is only meaningful once verified. */
function progressPercent(receivedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(99, Math.floor((receivedBytes / totalBytes) * 100));
}
