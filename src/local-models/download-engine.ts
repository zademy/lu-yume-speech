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
      reason: 'unknown-model' | 'busy' | 'invalid-state' | 'cancelled' | 'download-failed';
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
   * must show as partial, not not-downloaded). Entries without a record start
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

    const controller = new AbortController();
    this.active = { modelId, controller };
    // Read through a closure: `signal.aborted` can flip between awaits, and
    // direct property reads would be narrowed away by TypeScript.
    const aborted = (): boolean => controller.signal.aborted;

    try {
      await this.preFlightWarnings(entry);
      await this.applyTransition(modelId, { type: 'download-start' });

      const fetched = await this.fetchArtifacts(entry, controller.signal);
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
      const verified = await this.verifyArtifacts(entry, controller.signal);
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
  private async fetchArtifacts(entry: LocalCatalogEntry, signal: AbortSignal): Promise<boolean> {
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
      const url = artifactUrl(entry.repo, entry.revision, artifact.path);
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
  private async verifyArtifacts(entry: LocalCatalogEntry, signal: AbortSignal): Promise<boolean> {
    for (const artifact of entry.artifacts) {
      if (signal.aborted) return false;
      const url = artifactUrl(entry.repo, entry.revision, artifact.path);
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
    } else if (transition.state === 'partial' || transition.state === 'error') {
      record.verified = false;
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
  ): void {
    const payload: LocalModelProgressEvent = {
      modelId,
      phase,
      receivedBytes,
      totalBytes,
      percent,
    };
    this.deps.bus.emit('localModel:progress', payload);
  }

  private emitWarning(warning: LocalModelWarningEvent): void {
    this.deps.bus.emit('localModel:warning', warning);
  }
}

/** Integer 0–99 progress; 100 is only meaningful once verified. */
function progressPercent(receivedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(99, Math.floor((receivedBytes / totalBytes) * 100));
}
