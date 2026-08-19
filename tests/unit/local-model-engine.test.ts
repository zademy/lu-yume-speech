import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../../src/core/event-bus';
import { artifactUrl } from '../../src/local-models/artifact-store';
import type { CrossTabLockPort } from '../../src/local-models/cross-tab-lock';
import {
  LocalDownloadEngine,
  type ArtifactStorePort,
  type LocalModelRecord,
  type LogicalStateStorePort,
  type StorageAdvisorPort,
} from '../../src/local-models/download-engine';
import type {
  EventMap,
  LocalModelProgressEvent,
  LocalModelStateEvent,
  LocalModelWarningEvent,
} from '../../src/types';
import type { LocalCatalogEntry, LocalModelArtifact } from '../../src/utils/local-model-catalog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function catalogEntry(
  id: string,
  artifacts: Array<[path: string, bytes: number]>,
): LocalCatalogEntry {
  const files: LocalModelArtifact[] = artifacts.map(([path, bytes]) => ({ path, bytes }));
  return {
    id,
    name: `Model ${id}`,
    family: 'Whisper',
    repo: `onnx-community/${id}`,
    revision: `rev-${id}`,
    dtype: 'q4',
    artifacts: files,
    downloadBytes: files.reduce((acc, file) => acc + file.bytes, 0),
    languages: ['es', 'en'],
    autoDetectLanguage: true,
    supportsTranslation: true,
    precision: 'medium',
    speed: 'balanced',
    memoryTier: 'light',
    backend: 'wasm-compatible',
    license: 'mit',
    licenseUrl: 'https://huggingface.co/example',
  };
}

const MODEL = catalogEntry('model-a', [
  ['first.bin', 100],
  ['second.bin', 60],
  ['config.json', 10],
]);
const OTHER = catalogEntry('model-b', [['only.bin', 50]]);

/** Fake artifact store driven by a per-URL plan; streams in two chunks. */
class FakeArtifactStore implements ArtifactStorePort {
  /** Declared size per URL (defaults resolved by the test's catalog). */
  readonly plan = new Map<string, number>();
  /** Successfully stored artifacts: url → bytes. */
  readonly stored = new Map<string, number>();
  /** storeArtifact invocations per URL. */
  readonly fetches = new Map<string, number>();
  /** URLs whose fetch must fail. */
  readonly failUrls = new Set<string>();
  /** URLs that stream one chunk and then hang until aborted. */
  readonly hangUrls = new Set<string>();
  /** URLs verification must report as missing even after a store. */
  readonly vanishAfterStore = new Set<string>();
  /** URLs whose hasArtifact probe is delayed (to cancel mid-verification). */
  readonly delayHasUrls = new Set<string>();

  constructor(entries: readonly LocalCatalogEntry[]) {
    for (const entry of entries) {
      for (const artifact of entry.artifacts) {
        this.plan.set(artifactUrl(entry.repo, entry.revision, artifact.path), artifact.bytes);
      }
    }
  }

  async hasArtifact(url: string, expectedBytes: number): Promise<boolean> {
    if (this.delayHasUrls.has(url)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.vanishAfterStore.has(url)) return false;
    return this.stored.get(url) === expectedBytes;
  }

  async storeArtifact(
    url: string,
    signal: AbortSignal,
    onDelta: (deltaBytes: number) => void,
  ): Promise<void> {
    this.fetches.set(url, (this.fetches.get(url) ?? 0) + 1);
    if (this.failUrls.has(url)) throw new Error('network down');
    const total = this.plan.get(url) ?? 0;

    if (this.hangUrls.has(url)) {
      onDelta(Math.min(1, total));
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      return;
    }

    let sent = 0;
    const chunk = Math.max(1, Math.floor(total / 2));
    while (sent < total) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const take = Math.min(chunk, total - sent);
      await Promise.resolve();
      onDelta(take);
      sent += take;
    }
    this.stored.set(url, total);
  }

  /** URLs removed by deleteArtifacts (assertions + lost-artifact simulation). */
  readonly deleted = new Set<string>();

  async deleteArtifacts(urls: readonly string[]): Promise<void> {
    for (const url of urls) {
      this.deleted.add(url);
      this.stored.delete(url);
    }
  }
}

class FakeStateStore implements LogicalStateStorePort {
  readonly records = new Map<string, LocalModelRecord>();

  async get(modelId: string): Promise<LocalModelRecord | null> {
    return this.records.get(modelId) ?? null;
  }

  async put(record: LocalModelRecord): Promise<void> {
    this.records.set(record.modelId, { ...record });
  }
}

function fakeStorage(over: Partial<StorageAdvisorPort> = {}): StorageAdvisorPort {
  return {
    estimate: async () => ({ usageBytes: 0, quotaBytes: 100_000_000 }),
    persisted: async () => true,
    requestPersistence: async () => true,
    ...over,
  };
}

function createHarness(over: { storage?: Partial<StorageAdvisorPort> } = {}) {
  const bus = new EventBus<EventMap>();
  const catalog = [MODEL, OTHER];
  const artifacts = new FakeArtifactStore(catalog);
  const states = new FakeStateStore();
  const storage = fakeStorage(over.storage);
  const engine = new LocalDownloadEngine({
    catalog,
    artifacts,
    states,
    storage,
    bus,
    now: () => 1724000000000,
  });

  const progress: LocalModelProgressEvent[] = [];
  const stateEvents: LocalModelStateEvent[] = [];
  const warnings: LocalModelWarningEvent[] = [];
  bus.on('localModel:progress', (event) => progress.push({ ...event }));
  bus.on('localModel:state', (event) => stateEvents.push({ ...event }));
  bus.on('localModel:warning', (event) => warnings.push({ ...event }));

  return { engine, artifacts, states, storage, bus, progress, stateEvents, warnings };
}

const urlOf = (entry: LocalCatalogEntry, path: string): string =>
  artifactUrl(entry.repo, entry.revision, path);

// ---------------------------------------------------------------------------
// Download → progress → verified
// ---------------------------------------------------------------------------

describe('LocalDownloadEngine — download → progress → verified', () => {
  it('downloads every artifact and lands on downloaded only after verification', async () => {
    const h = createHarness();
    await h.engine.init();

    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({
      state: 'downloaded',
      verified: true,
      receivedBytes: MODEL.downloadBytes,
      totalBytes: MODEL.downloadBytes,
      revision: MODEL.revision,
    });

    // State machine walked downloading → preparing → downloaded.
    expect(h.stateEvents.map((event) => event.state)).toEqual([
      'downloading',
      'preparing',
      'downloaded',
    ]);
    expect(h.stateEvents[0]?.previous).toBe('not-downloaded');

    // Progress: downloading events carry bytes, then a preparing event.
    expect(h.progress.length).toBeGreaterThan(1);
    expect(h.progress.every((event) => event.modelId === MODEL.id)).toBe(true);
    const lastDownloading = [...h.progress].reverse().find((p) => p.phase === 'downloading');
    expect(lastDownloading?.receivedBytes).toBe(MODEL.downloadBytes);
    expect(lastDownloading?.totalBytes).toBe(MODEL.downloadBytes);
    const preparing = h.progress.find((p) => p.phase === 'preparing');
    expect(preparing?.percent).toBe(99);

    // Every artifact is cached exactly once.
    for (const artifact of MODEL.artifacts) {
      expect(h.artifacts.stored.get(urlOf(MODEL, artifact.path))).toBe(artifact.bytes);
      expect(h.artifacts.fetches.get(urlOf(MODEL, artifact.path))).toBe(1);
    }
  });

  it('emits monotonically non-decreasing percent values during a download', async () => {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    const percents = h.progress.map((event) => event.percent);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1] ?? 0);
    }
  });

  it('rejects unknown models and re-download attempts on a downloaded model', async () => {
    const h = createHarness();
    await h.engine.init();

    expect(await h.engine.requestDownload('nope')).toEqual({ ok: false, reason: 'unknown-model' });

    await h.engine.requestDownload(MODEL.id);
    expect(await h.engine.requestDownload(MODEL.id)).toEqual({
      ok: false,
      reason: 'invalid-state',
    });
  });

  it('proceeds while a remote transcription is in flight (no mutual blocking)', async () => {
    const h = createHarness();
    await h.engine.init();

    const remoteTranscription = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'groq text';
    })();
    const download = h.engine.requestDownload(MODEL.id);

    const [remoteText, outcome] = await Promise.all([remoteTranscription, download]);
    expect(remoteText).toBe('groq text');
    expect(outcome).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// One at a time
// ---------------------------------------------------------------------------

describe('LocalDownloadEngine — one download at a time', () => {
  it('rejects a second concurrent download as busy', async () => {
    const h = createHarness();
    h.artifacts.hangUrls.add(urlOf(MODEL, 'first.bin'));
    await h.engine.init();

    const first = h.engine.requestDownload(MODEL.id);
    await vi.waitFor(() => expect(h.engine.activeModelId).toBe(MODEL.id));

    expect(await h.engine.requestDownload(OTHER.id)).toEqual({ ok: false, reason: 'busy' });

    h.engine.cancelDownload(MODEL.id);
    expect(await first).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.engine.activeModelId).toBeNull();
  });

  it('cancelDownload reports no-active-download / model-mismatch', async () => {
    const h = createHarness();
    await h.engine.init();

    expect(h.engine.cancelDownload(MODEL.id)).toEqual({ ok: false, reason: 'no-active-download' });

    h.artifacts.hangUrls.add(urlOf(MODEL, 'first.bin'));
    const pending = h.engine.requestDownload(MODEL.id);
    await vi.waitFor(() => expect(h.engine.activeModelId).toBe(MODEL.id));

    expect(h.engine.cancelDownload(OTHER.id)).toEqual({ ok: false, reason: 'model-mismatch' });
    h.engine.cancelDownload(MODEL.id);
    await pending;
  });
});

// ---------------------------------------------------------------------------
// Cancellation → Descarga parcial
// ---------------------------------------------------------------------------

describe('LocalDownloadEngine — cancellation', () => {
  it('cancels into Descarga parcial, keeps complete artifacts, never verifies', async () => {
    const h = createHarness();
    // First artifact streams normally; the second hangs until aborted.
    h.artifacts.hangUrls.add(urlOf(MODEL, 'second.bin'));
    await h.engine.init();

    const pending = h.engine.requestDownload(MODEL.id);
    await vi.waitFor(() => expect(h.artifacts.stored.has(urlOf(MODEL, 'first.bin'))).toBe(true));

    expect(h.engine.cancelDownload(MODEL.id)).toEqual({ ok: true });
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });

    const record = h.engine.getRecord(MODEL.id);
    expect(record).toMatchObject({ state: 'partial', verified: false });
    expect(h.stateEvents.map((event) => event.state)).toEqual(['downloading', 'partial']);

    // Complete artifacts survive; the interrupted one cached nothing.
    expect(h.artifacts.stored.has(urlOf(MODEL, 'first.bin'))).toBe(true);
    expect(h.artifacts.stored.has(urlOf(MODEL, 'second.bin'))).toBe(false);
  });

  it('re-downloads a partial model, resuming from complete artifacts', async () => {
    const h = createHarness();
    h.artifacts.hangUrls.add(urlOf(MODEL, 'second.bin'));
    await h.engine.init();

    const first = h.engine.requestDownload(MODEL.id);
    await vi.waitFor(() => expect(h.artifacts.stored.has(urlOf(MODEL, 'first.bin'))).toBe(true));
    h.engine.cancelDownload(MODEL.id);
    await first;

    h.artifacts.hangUrls.clear();
    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({ state: 'downloaded' });
    // The already-complete artifact was not fetched again.
    expect(h.artifacts.fetches.get(urlOf(MODEL, 'first.bin'))).toBe(1);
    expect(h.artifacts.fetches.get(urlOf(MODEL, 'second.bin'))).toBe(2);
  });

  it('hydration shows a persisted partial from a previous session', async () => {
    const h = createHarness();
    h.states.records.set(MODEL.id, {
      modelId: MODEL.id,
      state: 'partial',
      revision: MODEL.revision,
      receivedBytes: 100,
      totalBytes: MODEL.downloadBytes,
      verified: false,
      updatedAt: 1,
    });

    await h.engine.init();

    expect(h.engine.getRecord(MODEL.id)).toMatchObject({ state: 'partial' });
  });

  it('cancels during the preparing (verification) phase into partial', async () => {
    const h = createHarness();
    h.artifacts.delayHasUrls.add(urlOf(MODEL, 'first.bin'));
    await h.engine.init();

    const pending = h.engine.requestDownload(MODEL.id);
    await vi.waitFor(() =>
      expect(h.stateEvents.some((event) => event.state === 'preparing')).toBe(true),
    );

    h.engine.cancelDownload(MODEL.id);
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({ state: 'partial', verified: false });
  });
});

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

describe('LocalDownloadEngine — failures', () => {
  it('maps a network failure to Error state', async () => {
    const h = createHarness();
    h.artifacts.failUrls.add(urlOf(MODEL, 'second.bin'));
    await h.engine.init();

    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: false, reason: 'download-failed' });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({ state: 'error', verified: false });
    expect(h.stateEvents.at(-1)?.state).toBe('error');
  });

  it('maps verification failure (artifact vanished) to Error state', async () => {
    const h = createHarness();
    h.artifacts.vanishAfterStore.add(urlOf(MODEL, 'config.json'));
    await h.engine.init();

    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: false, reason: 'download-failed' });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({ state: 'error' });
    expect(h.stateEvents.map((event) => event.state)).toEqual([
      'downloading',
      'preparing',
      'error',
    ]);
  });

  it('can retry from Error state', async () => {
    const h = createHarness();
    h.artifacts.failUrls.add(urlOf(MODEL, 'first.bin'));
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    h.artifacts.failUrls.clear();
    expect(await h.engine.requestDownload(MODEL.id)).toEqual({ ok: true });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({ state: 'downloaded' });
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: delete / atomic update / reconcile / cross-tab lock (T6)
// ---------------------------------------------------------------------------

/** Lock fake: `busy` simulates another tab holding the lock. */
function fakeLock(busy = false): CrossTabLockPort {
  return {
    async withLock<T>(_name: string, work: () => Promise<T>) {
      return busy
        ? { ok: false, reason: 'busy-other-tab' as const }
        : { ok: true, value: await work() };
    },
  };
}

describe('LocalDownloadEngine — delete (T6)', () => {
  it('deletes a downloaded model: artifacts of both revisions + record reset', async () => {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    const outcome = await h.engine.deleteModel(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    expect(h.engine.getRecord(MODEL.id)).toMatchObject({
      state: 'not-downloaded',
      revision: MODEL.revision,
      receivedBytes: 0,
      verified: false,
    });
    // Every artifact URL of the revision is gone from the store.
    for (const artifact of MODEL.artifacts) {
      expect(h.artifacts.deleted.has(urlOf(MODEL, artifact.path))).toBe(true);
    }
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'not-downloaded', previous: 'downloaded' });
  });

  it('refuses to delete while an engine operation runs (busy)', async () => {
    const h = createHarness();
    h.artifacts.hangUrls.add(urlOf(MODEL, 'first.bin'));
    await h.engine.init();

    const pending = h.engine.requestDownload(MODEL.id);
    await vi.waitFor(() => expect(h.engine.activeModelId).toBe(MODEL.id));

    expect(await h.engine.deleteModel(OTHER.id)).toEqual({ ok: false, reason: 'busy' });

    h.engine.cancelDownload(MODEL.id);
    await pending;
  });

  it('refuses to delete a not-downloaded model (invalid-state)', async () => {
    const h = createHarness();
    await h.engine.init();
    expect(await h.engine.deleteModel(MODEL.id)).toEqual({ ok: false, reason: 'invalid-state' });
  });

  it('reports busy-other-tab when the lock is held elsewhere', async () => {
    const bus = new EventBus<EventMap>();
    const artifacts = new FakeArtifactStore([MODEL]);
    const states = new FakeStateStore();
    // Seed a fully downloaded record (the lock blocks the download itself);
    // artifacts are pre-cached so startup reconciliation keeps it downloaded.
    states.records.set(MODEL.id, {
      modelId: MODEL.id,
      state: 'downloaded',
      revision: MODEL.revision,
      receivedBytes: MODEL.downloadBytes,
      totalBytes: MODEL.downloadBytes,
      verified: true,
      updatedAt: 1,
    });
    for (const artifact of MODEL.artifacts) {
      artifacts.stored.set(urlOf(MODEL, artifact.path), artifact.bytes);
    }
    const engine = new LocalDownloadEngine({
      catalog: [MODEL],
      artifacts,
      states,
      storage: fakeStorage(),
      bus,
      now: () => 1,
      lock: fakeLock(true),
    });
    await engine.init();

    expect(await engine.deleteModel(MODEL.id)).toEqual({ ok: false, reason: 'busy-other-tab' });
    // Nothing changed: the record is still downloaded.
    expect(engine.getRecord(MODEL.id)).toMatchObject({ state: 'downloaded' });
  });
});

describe('LocalDownloadEngine — atomic update (T6)', () => {
  /** Harness whose catalog was repointed to a NEW revision after download. */
  async function updatedCatalogHarness() {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    const NEW_ENTRY = { ...MODEL, revision: `rev-${MODEL.id}-v2` } as LocalCatalogEntry;
    // The fake's plan is built from constructor entries — teach it the new
    // revision's URLs too (same sizes: same artifacts, different revision).
    for (const artifact of MODEL.artifacts) {
      h.artifacts.plan.set(
        artifactUrl(NEW_ENTRY.repo, NEW_ENTRY.revision, artifact.path),
        artifact.bytes,
      );
    }
    const newCatalog = [NEW_ENTRY, OTHER] as readonly LocalCatalogEntry[];
    const newEngine = new LocalDownloadEngine({
      catalog: newCatalog,
      artifacts: h.artifacts,
      states: h.states,
      storage: h.storage,
      bus: h.bus,
      now: () => 1,
    });
    await newEngine.init();
    return { ...h, engine: newEngine, newEntry: NEW_ENTRY };
  }

  const urlOfRev = (entry: LocalCatalogEntry, revision: string, path: string): string =>
    artifactUrl(entry.repo, revision, path);

  it('downloads the new revision alongside, then swaps and frees the old one', async () => {
    const h = await updatedCatalogHarness();
    expect(h.engine.isUpdateAvailable(MODEL.id)).toBe(true);

    const outcome = await h.engine.requestUpdate(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    const record = h.engine.getRecord(MODEL.id);
    expect(record).toMatchObject({
      state: 'downloaded',
      revision: h.newEntry.revision,
      verified: true,
    });
    // New revision artifacts present; old revision artifacts removed.
    for (const artifact of MODEL.artifacts) {
      expect(h.artifacts.stored.has(urlOfRev(MODEL, h.newEntry.revision, artifact.path))).toBe(
        true,
      );
      expect(h.artifacts.deleted.has(urlOfRev(MODEL, MODEL.revision, artifact.path))).toBe(true);
    }
  });

  it('keeps the old revision intact when the update download fails (implicit rollback)', async () => {
    const h = await updatedCatalogHarness();
    h.artifacts.failUrls.add(urlOfRev(MODEL, h.newEntry.revision, 'second.bin'));

    const outcome = await h.engine.requestUpdate(MODEL.id);

    expect(outcome).toEqual({ ok: false, reason: 'update-failed' });
    const record = h.engine.getRecord(MODEL.id);
    // Record never left the old revision, still downloaded and activatable.
    expect(record).toMatchObject({ state: 'downloaded', revision: MODEL.revision, verified: true });
    // Old artifacts untouched; no new-revision file remains cached.
    for (const artifact of MODEL.artifacts) {
      expect(h.artifacts.stored.has(urlOfRev(MODEL, MODEL.revision, artifact.path))).toBe(true);
      expect(h.artifacts.stored.has(urlOfRev(MODEL, h.newEntry.revision, artifact.path))).toBe(
        false,
      );
    }
  });

  it('rejects an update when the record is already at the catalog revision', async () => {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);
    expect(await h.engine.requestUpdate(MODEL.id)).toEqual({ ok: false, reason: 'up-to-date' });
  });

  it('rejects an update from a non-downloaded state', async () => {
    const h = createHarness();
    await h.engine.init();
    expect(await h.engine.requestUpdate(MODEL.id)).toEqual({ ok: false, reason: 'invalid-state' });
  });

  it('reports update progress flagged as isUpdate', async () => {
    const h = await updatedCatalogHarness();
    await h.engine.requestUpdate(MODEL.id);
    const updateProgress = h.progress.filter((event) => event.isUpdate);
    expect(updateProgress.length).toBeGreaterThan(1);
    expect(updateProgress.every((event) => event.modelId === MODEL.id)).toBe(true);
  });
});

describe('LocalDownloadEngine — startup reconciliation (T6)', () => {
  it('downgrades a downloaded record whose cache lost every file', async () => {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    // The browser evicts everything between sessions.
    h.artifacts.stored.clear();

    const second = new LocalDownloadEngine({
      catalog: [MODEL, OTHER],
      artifacts: h.artifacts,
      states: h.states,
      storage: h.storage,
      bus: h.bus,
      now: () => 2,
    });
    h.stateEvents.length = 0;
    await second.init();

    expect(second.getRecord(MODEL.id)).toMatchObject({ state: 'not-downloaded', verified: false });
    expect(h.stateEvents).toContainEqual({
      modelId: MODEL.id,
      state: 'not-downloaded',
      previous: 'downloaded',
    });
  });

  it('downgrades to partial when only some files survived (resume-friendly)', async () => {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    // Evict all but the first artifact.
    for (const artifact of MODEL.artifacts.slice(1)) {
      h.artifacts.stored.delete(urlOf(MODEL, artifact.path));
    }

    const second = new LocalDownloadEngine({
      catalog: [MODEL, OTHER],
      artifacts: h.artifacts,
      states: h.states,
      storage: h.storage,
      bus: h.bus,
      now: () => 2,
    });
    await second.init();

    expect(second.getRecord(MODEL.id)).toMatchObject({ state: 'partial', verified: false });
  });

  it('leaves consistent records untouched', async () => {
    const h = createHarness();
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);

    const second = new LocalDownloadEngine({
      catalog: [MODEL, OTHER],
      artifacts: h.artifacts,
      states: h.states,
      storage: h.storage,
      bus: h.bus,
      now: () => 2,
    });
    h.stateEvents.length = 0;
    await second.init();

    expect(second.getRecord(MODEL.id)).toMatchObject({ state: 'downloaded' });
    expect(h.stateEvents).toEqual([]);
  });
});

describe('LocalDownloadEngine — pre-flight warnings', () => {
  it('warns when the estimate says there is not enough room, but proceeds', async () => {
    const h = createHarness();
    const estimate = vi.fn(async () => ({ usageBytes: 99_000, quotaBytes: 100_000 }));
    h.storage.estimate = estimate;
    await h.engine.init();

    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    const warning = h.warnings.find((w) => w.kind === 'space-insufficient');
    expect(warning).toMatchObject({ kind: 'space-insufficient', modelId: MODEL.id });
    if (warning?.kind === 'space-insufficient') {
      // model + 25% margin + temporaries, vs ~1000 bytes available.
      expect(warning.neededBytes).toBeGreaterThan(MODEL.downloadBytes);
      expect(warning.availableBytes).toBe(1000);
    }
  });

  it('warns (only) when no storage estimate exists', async () => {
    const h = createHarness({ storage: { estimate: async () => null } });
    await h.engine.init();

    await h.engine.requestDownload(MODEL.id);

    expect(h.warnings).toContainEqual({ kind: 'space-unreliable', modelId: MODEL.id });
    expect(h.warnings.some((w) => w.kind === 'space-insufficient')).toBe(false);
  });

  it('stays silent when space is comfortably available', async () => {
    const h = createHarness();
    await h.engine.init();

    await h.engine.requestDownload(MODEL.id);

    expect(h.warnings).toEqual([]);
  });

  it('requests persistence once and warns on denial', async () => {
    const h = createHarness({
      storage: { persisted: async () => false, requestPersistence: async () => false },
    });
    await h.engine.init();

    await h.engine.requestDownload(MODEL.id);
    await h.engine.requestDownload(OTHER.id);

    expect(h.warnings).toContainEqual({ kind: 'persistence-denied', modelId: MODEL.id });
    expect(h.warnings.filter((w) => w.kind === 'persistence-denied')).toHaveLength(1);
  });

  it('skips the persistence request when already granted', async () => {
    const requestPersistence = vi.fn(async () => true);
    const h = createHarness({ storage: { persisted: async () => true, requestPersistence } });
    await h.engine.init();

    await h.engine.requestDownload(MODEL.id);

    expect(requestPersistence).not.toHaveBeenCalled();
    expect(h.warnings).toEqual([]);
  });

  it('warns (only) when the memory tier outweighs the reported RAM', async () => {
    const heavy: typeof MODEL = { ...MODEL, memoryTier: 'high' };
    const bus = new EventBus<EventMap>();
    const artifacts = new FakeArtifactStore([heavy]);
    const states = new FakeStateStore();
    const engine = new LocalDownloadEngine({
      catalog: [heavy],
      artifacts,
      states,
      storage: fakeStorage(),
      bus,
      now: () => 1,
      deviceMemoryGb: 2,
    });
    const warnings: LocalModelWarningEvent[] = [];
    bus.on('localModel:warning', (event) => warnings.push(event));

    await engine.init();
    const outcome = await engine.requestDownload(heavy.id);

    // Advisory only: the download still completes.
    expect(outcome).toEqual({ ok: true });
    expect(warnings).toEqual([
      { kind: 'memory-tier', modelId: heavy.id, tier: 'high', deviceMemoryGb: 2 },
    ]);
  });

  it('stays silent on memory tier when the device reports no RAM', async () => {
    const h = createHarness();
    // Default harness has no deviceMemoryGb — guard must not fire.
    await h.engine.init();
    await h.engine.requestDownload(MODEL.id);
    expect(h.warnings).toEqual([]);
  });

  it('tolerates a throwing storage estimate (advisory only, no warning)', async () => {
    const h = createHarness({
      storage: {
        estimate: async () => {
          throw new Error('estimate boom');
        },
      },
    });
    await h.engine.init();

    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    expect(h.warnings).toEqual([]);
  });

  it('tolerates a throwing persistence request without failing the download', async () => {
    const h = createHarness({
      storage: {
        persisted: async () => false,
        requestPersistence: async () => {
          throw new Error('persist boom');
        },
      },
    });
    await h.engine.init();

    const outcome = await h.engine.requestDownload(MODEL.id);

    expect(outcome).toEqual({ ok: true });
    expect(h.warnings).toEqual([]);
  });
});
