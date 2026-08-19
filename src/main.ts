/**
 * Application entry point and composition root.
 *
 * This is the ONLY module that knows about all other modules.
 * It wires them together through the EventBus so that:
 *
 *   Recorder    → events → EventBus → GroqClient
 *   Analyzer    → levels → EventBus → WaveformVisualizer
 *   Timer       → ticks  → EventBus → Timer display
 *   Keyboard    → calls  → Recorder → EventBus → UI
 *   GroqClient  → events → EventBus → Toast + Metadata + Output + History
 *
 * No module imports another module directly — they depend exclusively
 * on the EventBus abstraction (Dependency Inversion Principle).
 */

import './style.css';

import { EventBus } from './core/event-bus';
import { TranscriptionSession } from './core/transcription-session';
import type {
  EventMap,
  TranscriptionOptions,
  StatusUpdate,
  HistoryEntry,
  AppSettings,
  TranscriptionProviderId,
  TranscriptionMethod,
  LocalModelState,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  methodChangePatch,
  hasActiveLocalModel,
  resolveCanDictate,
  remoteKnobsLocked,
} from './utils/transcription-method';
import { LOCAL_MODEL_CATALOG, formatDownloadSize } from './utils/local-model-catalog';
import { detectCapabilities, probeEnvironment } from './utils/local-model-capabilities';
import { LocalDownloadEngine } from './local-models/download-engine';
import { logicalStateStore } from './local-models/model-state-store';
import {
  createBrowserStorageAdvisor,
  createCacheArtifactStore,
  createInferenceWorker,
  readDeviceMemoryGb,
} from './local-models/browser-ports';
import { buildHistoryEntry } from './utils/history-entry';
import { LocalWhisperProvider } from './local-models/local-whisper-provider';
import { decodeAudioTo16kMono } from './local-models/audio-decode';

import { Recorder } from './audio/recorder';
import { AudioAnalyzer } from './audio/audio-analyzer';
import { RecordingTimer } from './audio/recording-timer';
import { WaveformVisualizer, type WaveformStyle } from './audio/waveform-visualizer';
import { AudioProcessor } from './audio/audio-processor';
import type { NoiseReductionMode } from './audio/audio-processor';
import { trimSilence } from './audio/silence-trimmer';
import * as store from './db/recordings-db';
import { GroqClient } from './api/groq-client';
import { CloudflareWhisperClient } from './api/cloudflare-whisper-client';
import type { TranscriptionProvider } from './api/transcription-provider';
import { postProcessWithLlm } from './api/llm-postprocessor';
import { generateSummary, SUMMARY_MODEL } from './api/summary-client';
import { renderApp } from './ui/renderer';
import type { AppElements } from './ui/renderer';
import { renderMetadata } from './ui/metadata-panel';
import { showToast } from './ui/toast';
import { createMetricsPanel } from './ui/metrics-panel';
import { createPlumaPanel } from './escritos/escritos-ui';
import * as escritos from './escritos/escritos-db';
import type { EditorHandle } from './escritos/editor';
import { createDictationController } from './escritos/dictation';
import { createImproveController } from './escritos/improve-ui';
import { translate, translateTree } from './i18n/translations';
import { APP_VERSION } from './version';
import type { AppLanguage } from './types';
import { computeMetrics } from './metrics/metrics';
import { renderSummaryHistory, summaryToText } from './ui/summary-panel';
import { ThemeManager } from './utils/theme';
import { createSidebar, populateEntries } from './ui/sidebar';
import { calculateHistoryStats } from './utils/history-stats';
import { buildPrompt, toPostProcessConfig } from './utils/transcription-config';
import { postProcessText } from './utils/text-postprocess';

import { registerKeyboardShortcuts } from './utils/keyboard';
import {
  readTranscriptionOptions,
  readOperationMode,
  readQualitySettings,
  populateQualitySettings,
} from './utils/settings';
import { copyToClipboard } from './utils/clipboard';
import { detectPlatform } from './platform/platform';
import type { Platform } from './platform/platform';
import { apiKeySchema } from './platform/api-key.schema';
import { workerTokenSchema } from './platform/worker-token.schema';
import { GateService } from './gate/gate-service';
import type { GateError, GateState } from './types';

/**
 * Query-selector helper that asserts the matched element is of the expected
 * subtype. Throws at boot if the template drifts so a broken shell surfaces
 * here, not as a `null` later in an unrelated module.
 */
function getRequiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
  elementType: new () => T,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Required element has an invalid type: ${selector}`);
  }
  return element;
}

// ===========================================================================
// Bootstrap
// ===========================================================================

let activeLang: AppLanguage = DEFAULT_SETTINGS.appLanguage;

/** Short-lived alias bound to the active UI language. Re-bound on language change. */
function t(key: string, params?: Record<string, string | number>): string {
  return translate(activeLang, key, params);
}

/**
 * App entry point. Catches fatal boot errors and renders a user-visible
 * banner with the i18n `fatal.message` text instead of a blank page.
 */
async function main(): Promise<void> {
  try {
    await bootstrap();
  } catch (err) {
    console.error('[App] Fatal error during initialization:', err);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="alert" style="position:fixed;bottom:1rem;right:1rem;background:var(--color-surface-sunken,#0d1117);color:var(--color-text-primary,#f0f6fc);border:2px solid var(--color-border-strong,#6e7681);padding:1rem;border-radius:8px;z-index:9999;font-family:sans-serif">' +
        translate('en', 'fatal.message') +
        '</div>',
    );
  }
}

/**
 * Composition root — wires every module through the EventBus.
 *
 * Order matters: platform/storage first → render shell → mount panels →
 * construct services → wire event handlers → register shortcuts →
 * register lifecycle cleanup on `unload`. The closures below capture shared
 * mutable holders (`apiKey`, `config`, `editorHandle`, `dictationTarget`)
 * so platform and pipeline reads always see the latest value.
 */
async function bootstrap(): Promise<void> {
  const bus = new EventBus<EventMap>();

  // Platform bridge — browser storage (localStorage)
  const platform = detectPlatform();
  let apiKey = (await platform.getCredential('groq')) ?? '';
  let workerToken = (await platform.getCredential('worker')) ?? '';
  const getApiKey = (): string => apiKey;
  const getWorkerToken = (): string => workerToken;

  // Live configuration: loaded once, refreshed on settings:change.
  let config: AppSettings = { ...DEFAULT_SETTINGS, ...((await platform.loadSettings()) ?? {}) };
  // Effective provider: the configured one when its credential exists,
  // otherwise the alternative when configured. Keeps the gate honest at boot.
  if (config.transcriptionProvider === 'cloudflare-whisper' && !workerToken && apiKey) {
    config.transcriptionProvider = 'groq';
  } else if (config.transcriptionProvider === 'groq' && !apiKey && workerToken) {
    config.transcriptionProvider = 'cloudflare-whisper';
  }
  /** True when the active method allows dictation (see resolveCanDictate). */
  // The Motor local readiness is decided by the download engine's records
  // (hydrated after engine.init); until then no local model is ready.
  const localEngineState: { ready: (modelId: string) => boolean } = {
    ready: () => false,
  };
  const canDictate = (): boolean =>
    resolveCanDictate({
      method: config.transcriptionMethod,
      remoteCredentialOk:
        config.transcriptionProvider === 'cloudflare-whisper'
          ? workerToken.length > 0
          : apiKey.length > 0,
      localModelReady:
        hasActiveLocalModel(config) && localEngineState.ready(config.localModelId as string),
    });
  const getConfig = (): AppSettings => config;
  const setConfig = (next: AppSettings): void => {
    config = next;
  };
  bus.on('settings:change', (patch) => {
    config = { ...config, ...patch };
  });
  activeLang = config.appLanguage;

  const elements = renderApp();
  elements.methodSelect.value = config.transcriptionMethod;
  elements.providerSelect.value = config.transcriptionProvider;
  elements.workerBaseUrlInput.value = config.workerBaseUrl;
  translateTree(elements.root, config.appLanguage);

  const versionEl = elements.root.querySelector('.about-version');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  // Inicio history panel
  const sidebar = createSidebar(
    elements.historyList,
    elements.historyEmptyState,
    elements.historyClearButton,
    elements.historyCount,
    (id) => {
      bus.emit('history:restore', id);
    },
    (id) => {
      bus.emit('history:delete', id);
    },
    async (id) => {
      const entry = await store.getGrabacion(id);
      if (!entry) return;
      void copyToClipboard(entry.text).then((copied) => {
        showToast(
          elements.toastContainer,
          copied ? t('toast.copied') : t('toast.copyFail'),
          copied ? 'success' : 'error',
        );
      });
    },
    () => {
      bus.emit('history:clear', undefined);
    },
    config.appLanguage,
  );

  const appDiv = getRequiredElement(document, '#app', HTMLDivElement);
  appDiv.replaceChildren(elements.root);

  // Métricas panel — lives in its own sidebar view (Inicio | Dictar | Ajustes | Métricas).
  const metricsPanel = createMetricsPanel(
    { onExport: exportSnapshot, onPurge: purgeContent },
    config.appLanguage,
  );
  elements.metricsView.appendChild(metricsPanel.root);

  // Pluma panel — document list + read-only preview (T1). T2 swaps preview for Milkdown.
  const plumaWorkspace = elements.plumaView.querySelector<HTMLElement>('#plumaWorkspace');
  const plumaHolder: { panel: ReturnType<typeof createPlumaPanel> | null } = { panel: null };
  let editorHandle: EditorHandle | null = null;
  const refreshEscritos = async (): Promise<void> => {
    const panel = plumaHolder.panel;
    if (panel) panel.setEscritos(await escritos.getAllEscritos());
  };
  // Image persistence adapter — pasted/dropped images become Dexie blobs
  // referenced as `app-image:<id>` (see src/escritos/images.ts).
  const imagesAdapter = {
    loadBlob: (id: string) => escritos.getImagen(id).then((img) => (img ? img.blob : null)),
    saveImage: async (file: File, escritoId: string) => {
      const id = crypto.randomUUID();
      try {
        await escritos.saveImagen({
          id,
          escritoId,
          blob: file,
          mimeType: file.type || 'image/png',
          createdAt: Date.now(),
        });
        return id;
      } catch (err) {
        console.warn('[Pluma] image save failed:', err);
        showToast(elements.toastContainer, t('pluma.image.error'), 'error');
        throw err;
      }
    },
  };
  plumaHolder.panel = createPlumaPanel(
    {
      onSelect: async (id) => {
        await openEscrito(id);
      },
      onRename: async (id, titulo) => {
        await escritos.renameEscrito(id, titulo);
        await refreshEscritos();
      },
      onRemove: async (id) => {
        if (editorHandle) {
          await editorHandle.destroy();
          editorHandle = null;
        }
        plumaHolder.panel?.editorMount.replaceChildren();
        dictationController.setEnabled(false);
        await escritos.removeEscrito(id);
        await refreshEscritos();
      },
      onClose: () => {
        if (editorHandle) {
          void editorHandle.destroy();
          editorHandle = null;
        }
        plumaHolder.panel?.editorMount.replaceChildren();
        dictationController.setEnabled(false);
      },
    },
    config.appLanguage,
  );
  const plumaPanel = plumaHolder.panel;
  plumaWorkspace?.appendChild(plumaPanel.root);

  // T4 — dictation toggle in the Pluma status bar. Reuses the shared recorder
  // + Groq pipeline; flips `dictation:target` so transcription lands here.
  const dictationController = createDictationController({
    bus,
    startRecorder: async () => {
      // Gate Pluma dictation the same way the Dictar view is gated — a
      // blocked method must record nothing rather than silently transcribe
      // through a remote provider.
      if (!canDictate()) {
        showToast(elements.toastContainer, t('toast.needLocalModel'), 'warning');
        return;
      }
      await ensureAudioReady();
      recorder.start();
    },
    stopRecorder: () => recorder.stop(),
    isRecording: () => recorder.state === 'recording',
    getEditor: () => editorHandle,
    toastContainer: elements.toastContainer,
    getLang: () => config.appLanguage,
  });
  plumaPanel.statusBar.prepend(dictationController.root);
  // No document is open initially — disable the toggle until a note is selected.
  dictationController.setEnabled(false);

  // T5 — improve star + popover anchored to the editor pane. Subscribes to
  // selection changes via the editor handle; re-subscribes on doc swap.
  const improveController = createImproveController({
    getEditor: () => editorHandle,
    anchor: plumaPanel.previewPane,
    toastContainer: elements.toastContainer,
    getApiKey,
    getLang: () => config.appLanguage,
  });

  // Shared editor-open path used by row select and the "New escrito" button.
  // Lazy-loads Crepe/ProseMirror so it stays out of the initial bundle — only
  // Pluma users pay for it, and only on first open.
  async function openEscrito(id: string): Promise<void> {
    const escrito = await escritos.getEscrito(id);
    const panel = plumaHolder.panel;
    if (!escrito || !panel) return;
    const { mountEditor } = await import('./escritos/editor');
    // Doc switch: tear down the previous editor, then mount a fresh one.
    if (editorHandle) {
      await editorHandle.destroy();
      editorHandle = null;
    }
    panel.editorMount.replaceChildren();
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    editorHandle = await mountEditor(panel.editorMount, {
      initialMD: escrito.contenidoMD,
      escritoId: escrito.id,
      images: imagesAdapter,
      onChange: (md) => {
        const docId = escrito.id;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          void escritos.updateContent(docId, md).then(() => void refreshEscritos());
        }, 800);
      },
    });
    // The improve controller re-binds its selection subscription to the
    // freshly mounted editor on every swap.
    improveController.attach(editorHandle);
    dictationController.setEnabled(true);
  }

  void refreshEscritos();
  elements.plumaView
    .querySelector<HTMLButtonElement>('#plumaNewButton')
    ?.addEventListener('click', async () => {
      const escrito = await escritos.createEscrito(t('pluma.untitled'));
      await refreshEscritos();
      plumaPanel.setOpenDoc(escrito.id);
      await openEscrito(escrito.id);
    });
  elements.plumaNavButton.addEventListener('click', () => void refreshEscritos());

  const refreshMetrics = async (): Promise<void> => {
    const [metas, resumenesCount, estimate] = await Promise.all([
      store.getAllGrabacionesMeta(),
      store.countResumenes(),
      store.getStorageEstimate(),
    ]);
    metricsPanel.update(
      computeMetrics({
        metas,
        resumenesCount,
        storageUsage: estimate.usage,
        storageQuota: estimate.quota,
      }),
    );
  };

  const renderHistory = async (): Promise<void> => {
    const entries = await store.getAllGrabaciones();
    populateEntries(sidebar, entries);
    renderHistoryStats(elements, entries);
    void refreshMetrics();
  };
  void renderHistory();

  async function purgeContent(): Promise<void> {
    try {
      await store.purgeAll();
      await renderHistory();
      showToast(elements.toastContainer, t('toast.contentPurged'), 'info');
    } catch (err) {
      console.warn('[App] Purge failed:', err);
      showToast(elements.toastContainer, t('toast.purgeFail'), 'error');
      void renderHistory();
    }
  }

  function exportSnapshot(): void {
    void (async () => {
      try {
        const [metas, resumenes, estimate] = await Promise.all([
          store.getAllGrabacionesMeta(),
          store.getAllResumenes(),
          store.getStorageEstimate(),
        ]);
        const snapshot = {
          exportedAt: new Date().toISOString(),
          storage: estimate,
          grabaciones: metas,
          resumenes,
        };
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yume-metricas-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(elements.toastContainer, t('toast.metricsExported'), 'success');
      } catch (err) {
        console.warn('[App] Export failed:', err);
        showToast(elements.toastContainer, t('toast.exportFail'), 'error');
      }
    })();
  }

  // Theme — initialize before first paint to avoid flash
  const theme = new ThemeManager(elements.themeToggle);
  theme.init();

  // Wire live UI interactions
  wireLiveControls(elements);
  wireOutputToolbar(elements);
  wireSummaryFeature(elements, getApiKey);

  // Noise reduction mode switch
  elements.noiseReductionSelect.addEventListener('change', () => {
    const mode = elements.noiseReductionSelect.value as NoiseReductionMode;
    void audioProcessor.setMode(mode).then(() => {
      showToast(
        elements.toastContainer,
        `Reducción de ruido: ${elements.noiseReductionSelect.selectedOptions[0]?.textContent ?? mode}`,
        'info',
      );
    });
  });

  // Service modules (DIP: they receive the bus, not each other)
  const recorder = new Recorder(bus);
  const analyzer = new AudioAnalyzer(bus);
  const timer = new RecordingTimer(bus);
  const groqClient = new GroqClient(bus, getApiKey);
  const workerClient = new CloudflareWhisperClient(bus, getWorkerToken, () => {
    const url = config.workerBaseUrl.trim();
    return url || DEFAULT_SETTINGS.workerBaseUrl;
  });
  /** Provider registry — adding a backend means one class + one entry here. */
  const transcriptionClients: Record<TranscriptionProviderId, TranscriptionProvider> = {
    groq: groqClient,
    'cloudflare-whisper': workerClient,
  };
  // Motor local (T4): third provider behind the same seam. Reads the active
  // model + its download-engine record lazily; the worker (and therefore
  // Transformers.js) only spawns on the first local transcription.
  // `localModelsCaps` is hydrated by probeEnvironment below; until then no
  // WebGPU is assumed (models requiring it fail honestly at transcribe time).
  let localModelsCaps: ReturnType<typeof detectCapabilities> | null = null;
  const localClient = new LocalWhisperProvider({
    bus,
    catalog: LOCAL_MODEL_CATALOG,
    getActiveModelId: () => config.localModelId,
    isModelReady: (modelId: string) => localEngineState.ready(modelId),
    hasWebgpu: () => localModelsCaps?.webgpu === true,
    getBackendPolicy: () => config.localBackend,
    getDeviceMemoryGb: () => readDeviceMemoryGb(),
    workerFactory: createInferenceWorker,
    decoder: decodeAudioTo16kMono,
  });
  const getActiveTranscriptionClient = (): TranscriptionProvider => {
    // Local never silently falls back to a remote provider — canDictate
    // gates the UI and this branch returns the local engine (which itself
    // fails loudly when the model is missing or incomplete).
    if (config.transcriptionMethod === 'local') return localClient;
    return transcriptionClients[config.transcriptionProvider];
  };
  const visualizer = new WaveformVisualizer(
    elements.waveformCanvas,
    resolveWaveformStyle(elements.waveformCanvas),
  );
  const audioProcessor = new AudioProcessor();

  elements.themeToggle.addEventListener('click', () => {
    visualizer.setStyle(resolveWaveformStyle(elements.waveformCanvas));
    if (!elements.waveformContainer.classList.contains('recording-active')) {
      visualizer.drawIdle();
    }
  });

  // Microphone access is deferred until Dictar is opened with a configured key.
  let audioReady = false;
  let audioInitialization: Promise<boolean> | null = null;
  const ensureAudioReady = (): Promise<boolean> => {
    if (audioReady) return Promise.resolve(true);
    if (audioInitialization) return audioInitialization;
    audioInitialization = recorder
      .init()
      .then((rawStream) =>
        audioProcessor.process(
          rawStream,
          elements.noiseReductionSelect.value as NoiseReductionMode,
        ),
      )
      .then((processed) => {
        recorder.setRecordingStream(processed.stream);
        analyzer.connectAnalyser(processed.analyser);
        visualizer.connectAnalyser(processed.analyser);
        visualizer.syncSize();
        visualizer.drawIdle();
        audioReady = true;
        return true;
      })
      .catch((error: unknown) => {
        console.error('[App] Microphone access denied:', error);
        showToast(elements.toastContainer, t('toast.micDenied'), 'error');
        audioInitialization = null;
        return false;
      });
    return audioInitialization;
  };
  const resizeObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => visualizer.syncSize()) : null;
  resizeObserver?.observe(elements.waveformCanvas);
  const onResize = resizeObserver ? null : () => visualizer.syncSize();
  if (onResize) window.addEventListener('resize', onResize);

  // Reflect persisted quality settings in the modal and persist any change.
  populateQualitySettings(elements, config);
  wireQualitySettings(elements, bus, platform, getConfig, setConfig);

  // Wire everything through the event bus
  const activeView: { view: AppView } = { view: 'home' };
  // Dictation routing — 'output' (Dictar view, default) vs 'pluma' (editor).
  // The Pluma dictation controller flips this when its toggle is on so the
  // shared capture/transcription pipeline knows where to deliver the result.
  const dictationTarget: { current: 'output' | 'pluma' } = { current: 'output' };
  bus.on('dictation:target', (next) => {
    dictationTarget.current = next;
  });
  const navigate = wireNavigation(
    elements,
    () => (canDictate() ? 'active' : ''),
    ensureAudioReady,
    () => config.appLanguage,
    activeView,
    (view) => {
      // Leaving Pluma: disarm dictation so the routing target doesn't leak
      // into the Dictate view (each screen owns its recording state).
      if (view !== 'pluma') {
        dictationController.setEnabled(false);
      } else if (editorHandle) {
        // Returning to Pluma with a document still open — re-enable the toggle.
        dictationController.setEnabled(true);
      }
    },
  );
  // Credential + provider wiring: badges, gates, and the method/provider selectors.
  const refreshCredentialUi = (): void => {
    const localBlocked = config.transcriptionMethod === 'local' && !hasActiveLocalModel(config);
    updateApiKeyState(elements, apiKey, canDictate());
    updateWorkerTokenState(elements, workerToken);
    // Under a blocked local method the key gate is irrelevant — the local
    // model gate below owns the Dictar view instead.
    if (localBlocked) elements.dictationKeyGate.hidden = true;
    elements.dictationLocalGate.hidden = !localBlocked;
    applyMethodConstraints(
      elements,
      config.transcriptionMethod,
      config.transcriptionProvider,
      workerToken.length > 0,
    );
  };
  /** Switch the active transcription provider and persist the choice. */
  const switchProvider = (provider: TranscriptionProviderId): void => {
    const patch: Partial<AppSettings> = { transcriptionProvider: provider };
    const next: AppSettings = { ...getConfig(), ...patch };
    setConfig(next);
    void platform.saveSettings(next);
    bus.emit('settings:change', patch);
    refreshCredentialUi();
  };
  /**
   * Switch the Método de transcripción and persist the choice.
   * The patch carries ONLY the method — the last Proveedor remoto and the
   * last Modelo activo persist independently.
   */
  const switchMethod = (method: TranscriptionMethod): void => {
    const patch = methodChangePatch(method);
    const next: AppSettings = { ...getConfig(), ...patch };
    setConfig(next);
    void platform.saveSettings(next);
    bus.emit('settings:change', patch);
    refreshCredentialUi();
  };
  wireMethodSelect(elements, () => config.transcriptionMethod, switchMethod);
  wireProviderSelect(elements, () => config.transcriptionProvider, switchProvider);
  wireApiKeySettings(
    elements,
    platform,
    () => apiKey,
    (next) => {
      apiKey = next;
      // Deleting the active Groq key with a worker token available:
      // auto-switch — only under the remote method (under local the provider
      // selection is parked and must not be mutated).
      if (
        !next &&
        config.transcriptionMethod === 'remote' &&
        config.transcriptionProvider === 'groq' &&
        workerToken
      ) {
        switchProvider('cloudflare-whisper');
        return;
      }
      refreshCredentialUi();
    },
  );
  wireWorkerTokenSettings(
    elements,
    platform,
    bus,
    getConfig,
    setConfig,
    () => workerToken,
    (next) => {
      workerToken = next;
      // Deleting the active worker token with a Groq key available:
      // auto-switch — only under the remote method (see wireApiKeySettings).
      if (
        !next &&
        config.transcriptionMethod === 'remote' &&
        config.transcriptionProvider === 'cloudflare-whisper' &&
        apiKey
      ) {
        switchProvider('groq');
        return;
      }
      refreshCredentialUi();
    },
  );
  refreshCredentialUi();

  wireGate(elements, platform, bus);
  wireGatePhraseSettings(elements, platform);

  // Device summary for Ajustes › Modelos locales — async, best-effort, and
  // re-rendered on language change so it never stays in a stale language.
  // (localModelsCaps itself is declared next to the local provider above.)
  const renderLocalModelsDevice = (): void => {
    if (!localModelsCaps) return;
    const caps = localModelsCaps;
    const backend = t(`localModels.device.${caps.backendKey}`);
    if (caps.storageQuotaBytes === null || !caps.localInferenceSupported) {
      elements.localModelsDevice.textContent = backend;
      return;
    }
    const usage = formatDownloadSize(caps.storageUsageBytes ?? 0);
    const quota = formatDownloadSize(caps.storageQuotaBytes);
    elements.localModelsDevice.textContent = `${backend} · ${t('localModels.device.storage')}: ${usage} / ${quota}`;
  };
  probeEnvironment()
    .then((probe) => {
      localModelsCaps = detectCapabilities(probe);
      renderLocalModelsDevice();
    })
    .catch(() => {
      // Capability probing is decorative here — silence leaves the line blank.
    });

  // Motor local (T3+T4): download engine behind the Local models cards plus
  // the Modelo activo selector. Fully independent of the transcription
  // pipeline — downloads while transcribing with Groq/Cloudflare are
  // allowed by design.
  const localModels = wireLocalModelEngine(bus, elements, {
    getActiveModelId: () => config.localModelId,
    getMethod: () => config.transcriptionMethod,
    onActiveModelChange: (modelId) => {
      const next = { ...getConfig(), localModelId: modelId };
      setConfig(next);
      void platform.saveSettings(next);
      bus.emit('settings:change', { localModelId: modelId });
      refreshCredentialUi();
    },
    onReadyStateChange: (ready) => {
      localEngineState.ready = ready;
      refreshCredentialUi();
    },
  });

  // Motor local advanced controls (T5): backend policy, idle release,
  // resident-model line and manual memory release.
  const renderLocalResident = (): void => {
    const resident = localClient.getResident();
    if (!resident) {
      elements.localResidentLine.textContent = t('localModels.resident.none');
      elements.localReleaseBtn.classList.add('hidden');
      return;
    }
    const entry = LOCAL_MODEL_CATALOG.find((candidate) => candidate.id === resident.modelId);
    elements.localResidentLine.textContent = t('localModels.resident', {
      name: entry?.name ?? resident.modelId,
      backend: t(`localModels.backendName.${resident.backend}`),
    });
    elements.localReleaseBtn.classList.remove('hidden');
  };
  bus.on('localModel:memory', renderLocalResident);

  const persistLocalSetting = (patch: Partial<AppSettings>): void => {
    const next = { ...getConfig(), ...patch };
    setConfig(next);
    void platform.saveSettings(next);
    bus.emit('settings:change', patch);
  };
  elements.localBackendSelect.value = config.localBackend;
  elements.localBackendSelect.addEventListener('change', () => {
    persistLocalSetting({
      localBackend: elements.localBackendSelect.value as 'auto' | 'wasm',
    });
    showToast(elements.toastContainer, t('toast.localModel.backendMode'), 'info');
  });
  elements.localIdleMinutes.value = String(config.localIdleReleaseMinutes);
  elements.localIdleMinutes.addEventListener('change', () => {
    const minutes = Math.max(0, Math.floor(Number(elements.localIdleMinutes.value) || 0));
    elements.localIdleMinutes.value = String(minutes);
    persistLocalSetting({ localIdleReleaseMinutes: minutes });
  });
  elements.localReleaseBtn.addEventListener('click', () => {
    localClient.release();
    showToast(elements.toastContainer, t('toast.localModel.released'), 'success');
  });
  renderLocalResident();

  // Idle release: the resident model frees after configurable minutes with
  // no user interaction (download kept; the model reloads on next use).
  let lastUserActivity = Date.now();
  const onUserActivity = (): void => {
    lastUserActivity = Date.now();
  };
  window.addEventListener('pointerdown', onUserActivity, { passive: true });
  window.addEventListener('keydown', onUserActivity);
  const idleTimer = window.setInterval(() => {
    const minutes = getConfig().localIdleReleaseMinutes;
    if (minutes <= 0 || !localClient.getResident()) return;
    if (Date.now() - lastUserActivity >= minutes * 60_000) {
      localClient.release();
      setStatus(elements, { message: t('status.localModel.idleReleased'), level: 'idle' });
    }
  }, 30_000);

  wireTranscriptionPipeline(
    bus,
    getActiveTranscriptionClient,
    elements,
    getConfig,
    getApiKey,
    renderHistory,
    () => dictationTarget.current,
  );
  wireRecordingHandlers(
    bus,
    elements,
    analyzer,
    timer,
    visualizer,
    recorder,
    () => dictationTarget.current,
  );
  wireHistoryEvents(bus, elements, navigate, renderHistory);

  // Interface language — switching it re-translates the shell in place.
  elements.appLanguageSelect.value = config.appLanguage;
  elements.appLanguageSelect.addEventListener('change', async () => {
    const lang = elements.appLanguageSelect.value as AppLanguage;
    activeLang = lang;
    const next = { ...getConfig(), appLanguage: lang };
    setConfig(next);
    await platform.saveSettings(next);
    bus.emit('settings:change', { appLanguage: lang });
    translateTree(elements.root, lang);
    renderLocalModelsDevice();
    renderLocalResident();
    localModels.renderAll();
    metricsPanel.setLanguage(lang);
    plumaPanel.setLanguage(lang);
    sidebar._lang = lang;
    await renderHistory();
    await refreshMetrics();
    await refreshEscritos();
    navigate(activeView.view);
  });

  // Keyboard shortcuts
  const cleanup = registerKeyboardShortcuts({
    onRecordStart: () => {
      if (!canDictate()) {
        navigate('settings');
        showToast(
          elements.toastContainer,
          config.transcriptionMethod === 'local'
            ? t('toast.needLocalModel')
            : t(
                config.transcriptionProvider === 'cloudflare-whisper'
                  ? 'toast.needWorkerToken'
                  : 'toast.needApiKey',
              ),
          'warning',
        );
        return;
      }
      navigate('dictation');
      void ensureAudioReady().then((ready) => {
        if (ready) recorder.start();
      });
    },
    onRecordStop: () => {
      if (audioReady) recorder.stop();
    },
    getMode: () => elements.recordModeSelect.value as 'push-to-talk' | 'toggle',
  });

  window.addEventListener('unload', () => {
    cleanup();
    window.clearInterval(idleTimer);
    window.removeEventListener('pointerdown', onUserActivity);
    window.removeEventListener('keydown', onUserActivity);
    resizeObserver?.disconnect();
    if (onResize) window.removeEventListener('resize', onResize);
    visualizer.stop();
    timer.dispose();
    analyzer.dispose();
    audioProcessor.dispose();
    recorder.dispose();
    bus.clear();
  });
}

// ===========================================================================
// Application shell
// ===========================================================================

type AppView = 'home' | 'dictation' | 'settings' | 'metrics' | 'pluma' | 'about';

/**
 * View-switch controller for the sidebar + mobile drawer.
 *
 * `navigate(target)` toggles the single visible `<section>`, syncs the
 * active button's `aria-current`, updates the mobile page title, and lazily
 * primes microphone access only when entering Dictar with a configured key.
 */
function wireNavigation(
  elements: AppElements,
  getApiKey: () => string,
  ensureAudioReady: () => Promise<boolean>,
  getLang: () => AppLanguage,
  holder: { view: AppView },
  onNavigate?: (view: AppView) => void,
): (view: AppView) => void {
  const views: Record<AppView, HTMLElement> = {
    home: elements.homeView,
    dictation: elements.dictationView,
    settings: elements.settingsView,
    metrics: elements.metricsView,
    pluma: elements.plumaView,
    about: elements.aboutView,
  };
  const buttons: Record<AppView, HTMLButtonElement> = {
    home: elements.homeNavButton,
    dictation: elements.dictationNavButton,
    settings: elements.settingsNavButton,
    metrics: elements.metricsNavButton,
    pluma: elements.plumaNavButton,
    about: elements.aboutNavButton,
  };
  const titles: Record<AppView, string> = {
    home: 'home.title',
    dictation: 'dictation.title',
    settings: 'settings.title',
    metrics: 'metrics.title',
    pluma: 'pluma.title',
    about: 'about.title',
  };

  const closeNavigation = (): void => {
    elements.navigation.dataset.open = 'false';
    elements.mobileMenuButton.setAttribute('aria-expanded', 'false');
  };
  const navigate = (view: AppView): void => {
    for (const [key, panel] of Object.entries(views) as Array<[AppView, HTMLElement]>) {
      const active = key === view;
      panel.hidden = !active;
      buttons[key].classList.toggle('is-active', active);
      buttons[key].setAttribute('aria-current', active ? 'page' : 'false');
    }
    holder.view = view;
    elements.pageTitle.textContent = translate(getLang(), titles[view]);
    closeNavigation();
    if (view === 'dictation' && getApiKey()) {
      void ensureAudioReady();
    }
    document.querySelector<HTMLElement>('#mainContent')?.focus({ preventScroll: true });
    onNavigate?.(view);
  };

  for (const [view, button] of Object.entries(buttons) as Array<[AppView, HTMLButtonElement]>) {
    button.addEventListener('click', () => navigate(view));
  }
  elements.root.querySelectorAll<HTMLButtonElement>('[data-open-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.openView;
      if (
        view === 'home' ||
        view === 'dictation' ||
        view === 'settings' ||
        view === 'metrics' ||
        view === 'pluma'
      )
        navigate(view);
    });
  });
  elements.dictationKeyGateButton.addEventListener('click', () => navigate('settings'));
  elements.dictationLocalGateButton.addEventListener('click', () => navigate('settings'));
  elements.mobileMenuButton.addEventListener('click', () => {
    const open = elements.navigation.dataset.open !== 'true';
    elements.navigation.dataset.open = String(open);
    elements.mobileMenuButton.setAttribute('aria-expanded', String(open));
  });
  elements.navBackdrop.addEventListener('click', closeNavigation);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNavigation();
  });
  return navigate;
}

/** Wires the show/hide toggle, save (Zod-validated), and delete for the Groq key. */
function wireApiKeySettings(
  elements: AppElements,
  platform: Platform,
  getApiKey: () => string,
  setApiKey: (next: string) => void,
): void {
  elements.apiKeyToggle.addEventListener('click', () => {
    const visible = elements.apiKeyInput.type === 'text';
    elements.apiKeyInput.type = visible ? 'password' : 'text';
    elements.apiKeyToggle.setAttribute('aria-pressed', String(!visible));
    elements.apiKeyToggle.setAttribute(
      'aria-label',
      visible ? 'Mostrar API key' : 'Ocultar API key',
    );
  });

  elements.apiKeyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = elements.apiKeyInput.value.trim();
    const result = apiKeySchema.safeParse(key);
    if (!result.success) {
      elements.apiKeyError.textContent =
        'Formato inválido. Debe empezar con gsk_ y tener al menos 44 caracteres.';
      elements.apiKeyInput.setAttribute('aria-invalid', 'true');
      elements.apiKeyInput.focus();
      return;
    }
    elements.apiKeySaveButton.disabled = true;
    elements.apiKeySaveButton.textContent = 'Guardando...';
    void platform
      .setCredential('groq', key)
      .then(() => {
        setApiKey(key);
        elements.apiKeyInput.value = '';
        elements.apiKeyError.textContent = '';
        elements.apiKeyInput.removeAttribute('aria-invalid');
        showToast(elements.toastContainer, t('toast.apiKeySaved'), 'success');
      })
      .finally(() => {
        elements.apiKeySaveButton.disabled = false;
        elements.apiKeySaveButton.textContent = 'Guardar key';
      });
  });

  elements.apiKeyDeleteButton.addEventListener('click', () => {
    if (!getApiKey()) return;
    void platform.deleteCredential('groq').then(() => {
      setApiKey('');
      elements.apiKeyInput.value = '';
      elements.apiKeyError.textContent = '';
      showToast(elements.toastContainer, t('toast.apiKeyDeleted'), 'info');
    });
  });
}

/**
 * Wires the worker-token form (toggle, Zod-validated save, delete) and the
 * base-URL field (https-validated, persisted on change).
 */
function wireWorkerTokenSettings(
  elements: AppElements,
  platform: Platform,
  bus: EventBus<EventMap>,
  getConfig: () => AppSettings,
  setConfig: (next: AppSettings) => void,
  getWorkerToken: () => string,
  setWorkerToken: (next: string) => void,
): void {
  elements.workerTokenToggle.addEventListener('click', () => {
    const visible = elements.workerTokenInput.type === 'text';
    elements.workerTokenInput.type = visible ? 'password' : 'text';
    elements.workerTokenToggle.setAttribute('aria-pressed', String(!visible));
    elements.workerTokenToggle.setAttribute(
      'aria-label',
      visible ? 'Mostrar token del worker' : 'Ocultar token del worker',
    );
  });

  elements.workerTokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = elements.workerTokenInput.value.trim();
    const result = workerTokenSchema.safeParse(token);
    if (!result.success) {
      elements.workerTokenError.textContent = result.error.issues[0]?.message ?? 'Token inválido.';
      elements.workerTokenInput.setAttribute('aria-invalid', 'true');
      elements.workerTokenInput.focus();
      return;
    }
    elements.workerTokenSaveButton.disabled = true;
    elements.workerTokenSaveButton.textContent = 'Guardando...';
    void platform
      .setCredential('worker', token)
      .then(() => {
        setWorkerToken(token);
        elements.workerTokenInput.value = '';
        elements.workerTokenError.textContent = '';
        elements.workerTokenInput.removeAttribute('aria-invalid');
        showToast(elements.toastContainer, t('toast.workerTokenSaved'), 'success');
      })
      .finally(() => {
        elements.workerTokenSaveButton.disabled = false;
        elements.workerTokenSaveButton.textContent = t('settings.worker.save');
      });
  });

  elements.workerTokenDeleteButton.addEventListener('click', () => {
    if (!getWorkerToken()) return;
    void platform.deleteCredential('worker').then(() => {
      setWorkerToken('');
      elements.workerTokenInput.value = '';
      elements.workerTokenError.textContent = '';
      showToast(elements.toastContainer, t('toast.workerTokenDeleted'), 'info');
    });
  });

  elements.workerBaseUrlInput.addEventListener('change', () => {
    const raw = elements.workerBaseUrlInput.value.trim();
    let valid = false;
    try {
      valid = new URL(raw).protocol === 'https:';
    } catch {
      // invalid URL — keep valid = false
    }
    if (!valid) {
      elements.workerBaseUrlInput.value = getConfig().workerBaseUrl;
      showToast(elements.toastContainer, t('settings.worker.baseUrlHelp'), 'warning');
      return;
    }
    const patch: Partial<AppSettings> = { workerBaseUrl: raw };
    const next: AppSettings = { ...getConfig(), ...patch };
    setConfig(next);
    void platform.saveSettings(next);
    bus.emit('settings:change', patch);
  });
}

/**
 * Wires the Puerta de acceso.
 *
 * Owns the GateService, applies its state to the DOM via `gate:change`
 * events, and handles the overlay forms (locked unlock + first-run setup).
 * The shell ships `inert` in the template; only `open` removes it, so no
 * content is reachable before the Puerta opens.
 */
function wireGate(elements: AppElements, platform: Platform, bus: EventBus<EventMap>): void {
  const gate = new GateService(platform);

  const applyState = (state: GateState): void => {
    if (state === 'open') {
      elements.gateOverlay.hidden = true;
      elements.navigation.removeAttribute('inert');
      elements.navBackdrop.removeAttribute('inert');
      elements.appWorkspace.removeAttribute('inert');
      elements.navigation.removeAttribute('aria-hidden');
      elements.appWorkspace.removeAttribute('aria-hidden');
      elements.homeNavButton.focus();
      return;
    }
    elements.gateOverlay.hidden = false;
    elements.gateOverlay.dataset.mode = state === 'setup' ? 'setup' : 'locked';
    elements.gateLockedError.textContent = '';
    elements.gateSetupError.textContent = '';
    (state === 'setup' ? elements.gateSetupInput : elements.gateLockedInput).focus();
  };

  bus.on('gate:change', applyState);

  const messages = gateErrorMessages();

  elements.gateLockedForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const phrase = elements.gateLockedInput.value;
    void gate.abrir(phrase).then((result) => {
      if (result.ok) {
        bus.emit('gate:change', 'open');
        return;
      }
      elements.gateLockedError.textContent = messages[result.error] ?? t('gate.error.incorrect');
      elements.gateLockedInput.value = '';
      elements.gateLockedInput.focus();
    });
  });

  elements.gateSetupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const phrase = elements.gateSetupInput.value;
    const confirmation = elements.gateSetupConfirmInput.value;
    if (phrase !== confirmation) {
      elements.gateSetupError.textContent = t('gate.error.mismatch');
      elements.gateSetupConfirmInput.focus();
      return;
    }
    void gate.establecer(phrase).then((result) => {
      if (result.ok) {
        bus.emit('gate:change', 'open');
        return;
      }
      elements.gateSetupError.textContent = messages[result.error] ?? t('gate.error.incorrect');
      elements.gateSetupInput.focus();
    });
  });

  // Initial state — resolved from storage; the Puerta always starts closed
  // (setup on first run, locked afterwards), once per application load.
  void gate.estado().then((state) => {
    bus.emit('gate:change', state);
  });
}

/**
 * Wires the Frase de acceso section in Settings: change the phrase after
 * confirming the current one. Inline errors; success clears the form.
 */
function wireGatePhraseSettings(elements: AppElements, platform: Platform): void {
  const gate = new GateService(platform);
  const messages = gateErrorMessages();

  elements.gatePhraseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = elements.gatePhraseCurrentInput.value;
    const next = elements.gatePhraseNewInput.value;
    const confirmation = elements.gatePhraseConfirmInput.value;
    if (next !== confirmation) {
      elements.gatePhraseError.textContent = t('gate.error.mismatch');
      elements.gatePhraseConfirmInput.focus();
      return;
    }
    void gate.cambiar(current, next).then((result) => {
      if (result.ok) {
        elements.gatePhraseCurrentInput.value = '';
        elements.gatePhraseNewInput.value = '';
        elements.gatePhraseConfirmInput.value = '';
        elements.gatePhraseError.textContent = '';
        showToast(elements.toastContainer, t('toast.gatePhraseChanged'), 'success');
        return;
      }
      elements.gatePhraseError.textContent = messages[result.error] ?? t('gate.error.incorrect');
      elements.gatePhraseCurrentInput.focus();
    });
  });
}

/** Shared i18n mapping of GateService error codes to user-facing messages. */
function gateErrorMessages(): Partial<Record<GateError, string>> {
  return {
    'frase-vacia': t('gate.error.empty'),
    'frase-corta': t('gate.error.short'),
    'frase-incorrecta': t('gate.error.incorrect'),
    'credencial-invalida': t('gate.error.corrupt'),
  };
}

// ===========================================================================
// Motor local — download engine (T3)
// ===========================================================================

/** i18n suffix per logical state ('not-downloaded' → 'notDownloaded', …). */
const LOCAL_STATE_I18N_KEY: Record<LocalModelState, string> = {
  'not-downloaded': 'notDownloaded',
  downloading: 'downloading',
  preparing: 'preparing',
  downloaded: 'downloaded',
  partial: 'partial',
  error: 'error',
};

/** Cached DOM handles for one Modelo del catálogo card. */
interface LocalCardRefs {
  chip: HTMLElement;
  download: HTMLButtonElement;
  cancel: HTMLButtonElement;
  progress: HTMLElement;
  bar: HTMLProgressElement;
  text: HTMLElement;
}

/**
 * Wires the Motor local download engine to the Local models cards: one
 * download at a time, progress (percent + bytes + phase) on an aria-live
 * region, cancellation → Descarga parcial, advisory warnings as toasts.
 * Also owns the Modelo activo slice: downloaded models populate the
 * Ajustes selector and selecting one persists `localModelId` through the
 * caller's change callback (never auto-switching anything else).
 *
 * Downloads are deliberately independent of the transcription pipeline —
 * a download while transcribing with Groq/Cloudflare is allowed by design.
 *
 * @returns `renderAll()` — re-renders every card's dynamic texts (called on
 * language change); the engine instance for later lifecycle tickets.
 */
function wireLocalModelEngine(
  bus: EventBus<EventMap>,
  elements: AppElements,
  deps: {
    getActiveModelId: () => string | null;
    onActiveModelChange: (modelId: string | null) => void;
    onReadyStateChange: (ready: (modelId: string) => boolean) => void;
    getMethod: () => TranscriptionMethod;
  },
): { engine: LocalDownloadEngine | null; renderAll: () => void } {
  const artifactStore = createCacheArtifactStore();

  // No Cache Storage (insecure context / old browser): the section stays
  // informational — download controls remain disabled, nothing is wired.
  if (!artifactStore) {
    for (const button of elements.root.querySelectorAll<HTMLButtonElement>(
      '[data-model-download]',
    )) {
      button.disabled = true;
    }
    return { engine: null, renderAll: () => undefined };
  }

  const engine = new LocalDownloadEngine({
    catalog: LOCAL_MODEL_CATALOG,
    artifacts: artifactStore,
    states: logicalStateStore,
    storage: createBrowserStorageAdvisor(),
    bus,
    deviceMemoryGb: readDeviceMemoryGb(),
  });

  // Expose readiness to the dictation gate as soon as records exist.
  deps.onReadyStateChange((modelId) => engine.getRecord(modelId)?.state === 'downloaded');

  /**
   * Modelo activo selector refresh: only verified-complete models appear;
   * the persisted selection survives while still downloaded. Under remote
   * the select is disabled anyway (applyMethodConstraints).
   */
  const refreshLocalModelOptions = (): void => {
    const downloaded = LOCAL_MODEL_CATALOG.filter(
      (entry) => engine.getRecord(entry.id)?.state === 'downloaded',
    );
    const activeId = deps.getActiveModelId();
    const select = elements.localModelSelect;
    select.replaceChildren();
    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = t('localModel.none');
    select.appendChild(noneOption);
    for (const entry of downloaded) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      select.appendChild(option);
    }
    select.disabled = deps.getMethod() !== 'local' || downloaded.length === 0;
    select.value =
      activeId && downloaded.some((entry) => entry.id === activeId) ? activeId : 'none';
  };

  elements.localModelSelect.addEventListener('change', () => {
    const value = elements.localModelSelect.value;
    const next = value === 'none' ? null : value;
    if (next !== deps.getActiveModelId()) deps.onActiveModelChange(next);
  });

  // Method switches (remote ↔ local) re-apply constraints elsewhere; this
  // keeps the selector's options/disabled/value in sync through the bus so
  // ordering never matters.
  bus.on('settings:change', (patch) => {
    if ('transcriptionMethod' in patch) refreshLocalModelOptions();
  });

  const refsCache = new Map<string, LocalCardRefs>();
  const refsFor = (modelId: string): LocalCardRefs | null => {
    const cached = refsCache.get(modelId);
    if (cached) return cached;
    const card = elements.root.querySelector(`[data-model-id="${modelId}"]`);
    if (!card) return null;
    const chip = card.querySelector<HTMLElement>(`[data-model-state="${modelId}"]`);
    const download = card.querySelector<HTMLButtonElement>(`[data-model-download="${modelId}"]`);
    const cancel = card.querySelector<HTMLButtonElement>(`[data-model-cancel="${modelId}"]`);
    const progress = card.querySelector<HTMLElement>(`[data-model-progress="${modelId}"]`);
    const bar = card.querySelector<HTMLProgressElement>(`[data-model-progressbar="${modelId}"]`);
    const text = card.querySelector<HTMLElement>(`[data-model-progresstext="${modelId}"]`);
    if (!chip || !download || !cancel || !progress || !bar || !text) return null;
    const refs: LocalCardRefs = { chip, download, cancel, progress, bar, text };
    refsCache.set(modelId, refs);
    return refs;
  };

  let pendingFocusModel: string | null = null;

  const updateCard = (modelId: string): void => {
    const refs = refsFor(modelId);
    const record = engine.getRecord(modelId);
    if (!refs || !record) return;
    const state = record.state;
    const busy = state === 'downloading' || state === 'preparing';

    refs.chip.dataset.state = state;
    refs.chip.textContent = t(`localModels.state.${LOCAL_STATE_I18N_KEY[state]}`);

    // One download at a time: every Download button disables while any run.
    refs.download.disabled = engine.activeModelId !== null;
    refs.download.textContent = t(
      state === 'partial' || state === 'error'
        ? 'localModels.downloadAgain'
        : 'localModels.download',
    );
    refs.download.classList.toggle('hidden', busy || state === 'downloaded');
    refs.cancel.classList.toggle('hidden', !busy);

    // Stable focus: download start moves focus to Cancel; after cancel it
    // returns to the (re-enabled) Download button.
    if (busy && document.activeElement === refs.download) refs.cancel.focus();
    if (!busy && pendingFocusModel === modelId) {
      pendingFocusModel = null;
      refs.download.focus();
    }

    if (!busy) {
      refs.progress.classList.add('hidden');
      refs.bar.value = 0;
      refs.text.textContent = '';
    }
  };

  const renderAll = (): void => {
    for (const entry of LOCAL_MODEL_CATALOG) updateCard(entry.id);
    refreshLocalModelOptions();
  };

  bus.on('localModel:progress', ({ modelId, phase, percent, receivedBytes, totalBytes }) => {
    const refs = refsFor(modelId);
    if (!refs) return;
    refs.progress.classList.remove('hidden');
    refs.bar.value = percent;
    refs.text.textContent =
      phase === 'downloading'
        ? t('localModels.progress.downloading', {
            percent,
            received: formatDownloadSize(receivedBytes),
            total: formatDownloadSize(totalBytes),
          })
        : t('localModels.progress.preparing');
  });

  bus.on('localModel:state', ({ modelId, state }) => {
    updateCard(modelId);
    refreshLocalModelOptions();
    if (state === 'partial') {
      showToast(elements.toastContainer, t('toast.localModel.cancelled'), 'warning');
    } else if (state === 'error') {
      showToast(elements.toastContainer, t('toast.localModel.failed'), 'error');
    }
  });

  bus.on('localModel:warning', (warning) => {
    const message =
      warning.kind === 'space-insufficient'
        ? t('localModels.warn.spaceInsufficient', {
            available: formatDownloadSize(warning.availableBytes),
            needed: formatDownloadSize(warning.neededBytes),
          })
        : warning.kind === 'memory-tier'
          ? t('localModels.warn.memory-tier', {
              tier: warning.tier,
              gb: warning.deviceMemoryGb,
            })
          : t(
              warning.kind === 'space-unreliable'
                ? 'localModels.warn.spaceUnreliable'
                : 'localModels.warn.persistenceDenied',
            );
    showToast(elements.toastContainer, message, 'warning');
  });

  // Hydrate persisted records (a previous Descarga parcial shows as such),
  // then attach click handlers so no click can race an uninitialized record.
  void engine.init().then(() => {
    renderAll();
    for (const button of elements.root.querySelectorAll<HTMLButtonElement>(
      '[data-model-download]',
    )) {
      button.addEventListener('click', () => {
        const modelId = button.dataset.modelDownload;
        if (!modelId) return;
        void engine.requestDownload(modelId).then((outcome) => {
          if (outcome.ok) return;
          if (outcome.reason === 'busy') {
            showToast(elements.toastContainer, t('toast.localModel.busy'), 'warning');
          }
        });
      });
    }
    for (const button of elements.root.querySelectorAll<HTMLButtonElement>('[data-model-cancel]')) {
      button.addEventListener('click', () => {
        const modelId = button.dataset.modelCancel;
        if (!modelId) return;
        pendingFocusModel = modelId;
        engine.cancelDownload(modelId);
      });
    }
  });

  return { engine, renderAll };
}

/** Wires the provider `<select>`: manual activation of the active backend. */
function wireProviderSelect(
  elements: AppElements,
  getProvider: () => TranscriptionProviderId,
  onChange: (provider: TranscriptionProviderId) => void,
): void {
  elements.providerSelect.addEventListener('change', () => {
    const next = elements.providerSelect.value as TranscriptionProviderId;
    if (next !== getProvider()) onChange(next);
  });
}

/** Wires the Método de transcripción `<select>`. */
function wireMethodSelect(
  elements: AppElements,
  getMethod: () => TranscriptionMethod,
  onChange: (method: TranscriptionMethod) => void,
): void {
  elements.methodSelect.addEventListener('change', () => {
    const next = elements.methodSelect.value as TranscriptionMethod;
    if (next !== getMethod()) onChange(next);
  });
}

/**
 * Reflects the Método de transcripción in the transcription controls.
 *
 * Under the local method the Proveedor remoto selector and the remote-only
 * knobs are disabled and the Modelo activo selector takes over; under the
 * remote method the existing provider constraints apply. The Modelo activo
 * options themselves are owned by the download engine (see
 * `refreshLocalModelOptions`) — this only locks the selector under remote.
 */
function applyMethodConstraints(
  elements: AppElements,
  method: TranscriptionMethod,
  provider: TranscriptionProviderId,
  hasWorkerToken: boolean,
): void {
  const isLocal = method === 'local';
  elements.methodSelect.value = method;
  elements.providerSelect.disabled = isLocal;
  // Options/data come from the engine; only enable when a downloaded model
  // exists (the engine refresh keeps this in sync).
  elements.localModelSelect.disabled = isLocal
    ? elements.localModelSelect.options.length <= 1
    : true;
  if (!isLocal) elements.localModelSelect.value = 'none';
  if (isLocal) {
    elements.modelSelect.disabled = true;
    const translateOption = elements.operationModeSelect.querySelector<HTMLOptionElement>(
      'option[value="translate"]',
    );
    if (translateOption) translateOption.disabled = true;
    // A disabled option must not stay selected (mirrors the worker branch).
    elements.operationModeSelect.value = 'transcribe';
    elements.promptInput.disabled = true;
    elements.temperatureSlider.disabled = true;
    elements.responseFormatSelect.disabled = true;
    elements.timestampToggle.disabled = true;
  } else {
    applyProviderConstraints(elements, provider, hasWorkerToken);
  }
}

/**
 * Reflects the active provider in the transcription controls.
 *
 * While Cloudflare Whisper is active the worker's fixed model applies and the
 * Groq-only knobs (model, translation, prompt, temperature, response format,
 * timestamps) are disabled. The language selector keeps every option
 * including 'auto' ('auto' omits `lang` — the worker then uses its default).
 */
function applyProviderConstraints(
  elements: AppElements,
  provider: TranscriptionProviderId,
  hasWorkerToken: boolean,
): void {
  const isWorker = remoteKnobsLocked('remote', provider);
  elements.providerSelect.value = provider;
  const workerOption = elements.providerSelect.querySelector<HTMLOptionElement>(
    'option[value="cloudflare-whisper"]',
  );
  if (workerOption) workerOption.disabled = !hasWorkerToken;
  elements.modelSelect.disabled = isWorker;
  const translateOption = elements.operationModeSelect.querySelector<HTMLOptionElement>(
    'option[value="translate"]',
  );
  if (translateOption) translateOption.disabled = isWorker;
  if (isWorker) elements.operationModeSelect.value = 'transcribe';
  elements.promptInput.disabled = isWorker;
  elements.temperatureSlider.disabled = isWorker;
  elements.responseFormatSelect.disabled = isWorker;
  elements.timestampToggle.disabled =
    isWorker || elements.responseFormatSelect.value !== 'verbose_json';
}

/** Reflects the current key state in the status badge, save button, and Dictar gate visibility. */
function updateApiKeyState(elements: AppElements, apiKey: string, canDictate: boolean): void {
  const configured = apiKey.length > 0;
  elements.apiKeyStatus.textContent = configured ? 'Configurada' : 'Sin configurar';
  elements.apiKeyStatus.classList.toggle('is-configured', configured);
  elements.apiKeyDeleteButton.disabled = !configured;
  elements.dictationKeyGate.hidden = canDictate;
  elements.dictationWorkspace.hidden = !canDictate;
}

/** Mirrors {@link updateApiKeyState} for the worker token badge. */
function updateWorkerTokenState(elements: AppElements, workerToken: string): void {
  const configured = workerToken.length > 0;
  elements.workerTokenStatus.textContent = configured ? 'Configurada' : 'Sin configurar';
  elements.workerTokenStatus.classList.toggle('is-configured', configured);
  elements.workerTokenDeleteButton.disabled = !configured;
}

/** Renders the Inicio stat badges (words, transcriptions, audio minutes) from history. */
function renderHistoryStats(elements: AppElements, entries: HistoryEntry[]): void {
  const stats = calculateHistoryStats(entries);
  elements.wordsMetric.textContent = stats.words.toLocaleString('es-MX');
  elements.transcriptionsMetric.textContent = stats.transcriptions.toLocaleString('es-MX');
  const minutes = stats.audioSeconds / 60;
  elements.audioMinutesMetric.textContent =
    minutes === 0
      ? '0'
      : minutes < 10
        ? minutes.toFixed(1)
        : Math.round(minutes).toLocaleString('es-MX');
}

// ===========================================================================
// Live controls
// ===========================================================================

/** Wire non-persisting UI state: temperature readout, verbose-format toggle, word counter. */
function wireLiveControls(elements: AppElements): void {
  elements.temperatureSlider.addEventListener('input', () => {
    elements.temperatureValue.textContent = elements.temperatureSlider.value;
  });

  elements.responseFormatSelect.addEventListener('change', () => {
    const isVerbose = elements.responseFormatSelect.value === 'verbose_json';
    elements.timestampToggle.disabled = !isVerbose;
    if (!isVerbose) elements.timestampToggle.checked = false;
  });

  elements.timestampToggle.disabled = elements.responseFormatSelect.value !== 'verbose_json';

  elements.outputArea.addEventListener('input', () => {
    updateWordCount(elements);
  });
}

// ===========================================================================
// Quality settings persistence
// ===========================================================================

/**
 * Persist the transcription-quality controls whenever they change.
 *
 * Reads the quality controls into a partial patch, merges it over the current
 * config, persists the full snapshot via the platform seam, and emits
 * `settings:change` so the live pipeline picks up the new values.
 */
function wireQualitySettings(
  elements: AppElements,
  bus: EventBus<EventMap>,
  platform: Platform,
  getConfig: () => AppSettings,
  setConfig: (next: AppSettings) => void,
): void {
  const persist = (): void => {
    const patch = readQualitySettings(elements);
    const next: AppSettings = { ...getConfig(), ...patch };
    setConfig(next);
    void platform.saveSettings(next);
    bus.emit('settings:change', patch);
  };

  // Live readout for the correction-threshold slider.
  elements.wordCorrectionThresholdSlider.addEventListener('input', () => {
    elements.wordCorrectionThresholdValue.textContent =
      elements.wordCorrectionThresholdSlider.value;
  });

  const fields: Array<HTMLElement> = [
    elements.customWordsInput,
    elements.wordCorrectionThresholdSlider,
    elements.customFillerWordsInput,
    elements.silenceTrimToggle,
    elements.llmToggle,
    elements.llmModelInput,
    elements.llmInstructionsInput,
  ];
  for (const field of fields) {
    field.addEventListener('change', persist);
  }
}

// ===========================================================================
// Recording handlers
// ===========================================================================

/**
 * Subscribes the visualizer, analyzer, timer, and status bar to
 * `recording:*` events. Skipped when the dictation target is Pluma —
 * that view has its own controller and must not pulse the Dictar UI.
 */
function wireRecordingHandlers(
  bus: EventBus<EventMap>,
  elements: AppElements,
  analyzer: AudioAnalyzer,
  timer: RecordingTimer,
  visualizer: WaveformVisualizer,
  recorder: Recorder,
  getDictationTarget: () => 'output' | 'pluma',
): void {
  bus.on('recording:start', () => {
    if (getDictationTarget() === 'pluma') return;
    analyzer.start();
    timer.start();
    visualizer.setRecording(true);
    visualizer.start();
    elements.waveformContainer.classList.add('recording-active');
    setStatus(elements, { message: t('status.listening'), level: 'recording' });
  });

  bus.on('recording:stop', () => {
    if (getDictationTarget() === 'pluma') return;
    analyzer.stop();
    timer.stop();
    visualizer.stop();
    visualizer.setRecording(false);
    elements.waveformContainer.classList.remove('recording-active');
    visualizer.drawIdle();
  });

  bus.on('recording:timer', (elapsed) => {
    elements.timerDisplay.textContent = formatDuration(elapsed);
  });

  bus.on('recording:silence', () => {
    if (getDictationTarget() === 'pluma') return;
    if (timer.getElapsed() > 1) {
      recorder.stop();
      showToast(elements.toastContainer, t('toast.silence'), 'info');
    }
  });
}

// ===========================================================================
// Transcription pipeline
// ===========================================================================

/**
 * End-to-end transcription pipeline.
 *
 * Flow: `audio:blob-ready` → optional silence trim → Whisper call →
 * `transcription:success` → text post-process → optional LLM polish →
 * route (Pluma append OR output-area append + history + clipboard) →
 * `transcription:error` for failures. State machine: {@link TranscriptionSession}.
 */
function wireTranscriptionPipeline(
  bus: EventBus<EventMap>,
  getClient: () => TranscriptionProvider,
  elements: AppElements,
  getConfig: () => AppSettings,
  getApiKey: () => string,
  refreshHistory: () => Promise<void>,
  getDictationTarget: () => 'output' | 'pluma',
): void {
  // Named pipeline state — replaces the former `lastBlob` closure so a failed
  // take can never leak into a later success, and a rapid re-record surfaces
  // the overwritten buffer instead of silently dropping it.
  const session = new TranscriptionSession();

  bus.on('recording:start', () => session.startRecording());

  bus.on('audio:blob-ready', async (blob) => {
    const config = getConfig();
    session.submit(blob, blob.type);

    // Optionally strip leading/trailing silence before transcription. Fail-open:
    // if decoding is unavailable or the clip is silent, trimSilence returns the
    // original blob so transcription still proceeds.
    const audio = config.enableSilenceTrim
      ? await trimSilence(blob, {
          thresholdDb: config.silenceThresholdDb,
          paddingMs: config.silencePaddingMs,
        })
      : blob;

    const base = readTranscriptionOptions(elements);
    const options: TranscriptionOptions =
      base.prompt === undefined && config.customWords.length === 0
        ? base
        : { ...base, prompt: buildPrompt(config.customWords, base.prompt) };

    const mode = readOperationMode(elements);
    const request = { ...options, mode };
    const client = getClient();
    void client.transcribe(audio, request).catch(() => {
      // Error already emitted on the bus via transcription:error
    });
    const localEntry =
      config.transcriptionMethod === 'local'
        ? LOCAL_MODEL_CATALOG.find((entry) => entry.id === config.localModelId)
        : undefined;
    setStatus(
      elements,
      localEntry
        ? { message: `Procesando con ${localEntry.name} (local)…`, level: 'processing' }
        : config.transcriptionProvider === 'cloudflare-whisper'
          ? { message: 'Procesando con Cloudflare Whisper…', level: 'processing' }
          : { message: `Procesando con ${options.model}...`, level: 'processing' },
    );
  });

  bus.on('transcription:success', async (result) => {
    renderMetadata(elements.metadataPanel, result);

    if (!result.text) {
      session.complete();
      showToast(elements.toastContainer, t('toast.noText'), 'warning');
      setStatus(elements, { message: 'No se detectó texto.', level: 'idle' });
      return;
    }

    // Text post-processing: custom-word fuzzy correction + filler/stutter cleanup,
    // then an optional LLM polish pass. Both fail safe — the raw text is kept on
    // any issue. Filler language follows the detected/source language.
    const config = getConfig();
    const lang = result.language ?? (config.language === 'auto' ? 'en' : config.language);
    let text = postProcessText(result.text, toPostProcessConfig(config), lang);

    if (config.enableLlmPostProcess && text.trim()) {
      setStatus(elements, { message: 'Refinando con LLM…', level: 'processing' });
      text = await postProcessWithLlm(text, getApiKey(), {
        model: config.llmModel,
        instructions: config.llmInstructions,
      });
    }

    if (!text.trim()) {
      session.complete();
      showToast(elements.toastContainer, t('toast.noText'), 'warning');
      setStatus(elements, { message: 'No se detectó texto.', level: 'idle' });
      return;
    }

    // Pluma dictation: post-processed text goes to the editor via the bus;
    // skip the Dictar-view append, history record, and clipboard copy so the
    // grabación history stays about real Dictar sessions (T4 out-of-scope note).
    if (getDictationTarget() === 'pluma') {
      bus.emit('text:append', text);
      session.complete();
      setStatus(elements, { message: t('pluma.dictation.appended'), level: 'success' });
      return;
    }

    const output = elements.outputArea;
    output.value += (output.value ? ' ' : '') + text;
    output.scrollTop = output.scrollHeight;
    output.dispatchEvent(new Event('input'));

    bus.emit('text:append', text);

    // Save to history
    const options = readTranscriptionOptions(elements);
    const mode = readOperationMode(elements);
    const entry = buildHistoryEntry({
      config,
      options,
      result,
      text,
      mode,
      now: Date.now(),
    });
    const pending = session.complete();
    const blob = pending?.blob ?? new Blob([], { type: 'audio/webm' });
    const mimeType = pending?.mimeType ?? 'audio/webm';
    void store
      .saveGrabacion(entry, blob, mimeType)
      .then(() => store.requestPersistentStorage())
      .then(() => refreshHistory())
      .catch((err: unknown) => {
        console.warn('[App] Failed to save grabación:', err);
        showToast(elements.toastContainer, t('toast.saveFail'), 'error');
        void refreshHistory();
      });

    const copied = await copyToClipboard(text);
    if (copied) {
      showToast(elements.toastContainer, t('toast.copied'), 'success');
      setStatus(elements, { message: 'Transcripción copiada.', level: 'success' });
    } else {
      setStatus(elements, { message: 'Listo.', level: 'idle' });
    }
  });

  bus.on('transcription:error', (error) => {
    session.fail();
    console.error('[App] Transcription error:', error);
    showToast(elements.toastContainer, error.message, 'error');
    setStatus(elements, { message: `Error: ${error.message}`, level: 'error' });
  });

  bus.on('status:change', (update) => {
    setStatus(elements, update);
  });
}

// ===========================================================================
// History events
// ===========================================================================

/** Restore / delete / clear handlers for the Inicio history list. */
function wireHistoryEvents(
  bus: EventBus<EventMap>,
  elements: AppElements,
  navigate: (view: AppView) => void,
  refreshHistory: () => Promise<void>,
): void {
  bus.on('history:restore', async (id) => {
    const entry = await store.getGrabacion(id);
    if (!entry) return;

    elements.outputArea.value = entry.text;
    elements.outputArea.dispatchEvent(new Event('input'));
    navigate('dictation');
    showToast(elements.toastContainer, t('toast.restored'), 'success');
    setStatus(elements, { message: t('status.restored'), level: 'success' });
  });

  bus.on('history:delete', async (id) => {
    await store.removeGrabacion(id);
    void refreshHistory();
    showToast(elements.toastContainer, t('toast.deleted'), 'info');
  });

  bus.on('history:clear', async () => {
    await store.clearGrabaciones();
    void refreshHistory();
    showToast(elements.toastContainer, t('toast.historyCleared'), 'info');
  });
}

// ===========================================================================
// Output toolbar
// ===========================================================================

/** Output-area toolbar: copy all, clear, download as `.txt`. */
function wireOutputToolbar(elements: AppElements): void {
  elements.copyAllBtn.addEventListener('click', async () => {
    const text = elements.outputArea.value;
    if (!text) {
      showToast(elements.toastContainer, t('toast.nothingToCopy'), 'warning');
      return;
    }
    const ok = await copyToClipboard(text);
    showToast(
      elements.toastContainer,
      ok ? t('toast.allCopied') : t('toast.copyFail'),
      ok ? 'success' : 'error',
    );
  });

  elements.clearBtn.addEventListener('click', () => {
    if (!elements.outputArea.value) return;
    elements.outputArea.value = '';
    elements.outputArea.dispatchEvent(new Event('input'));
    showToast(elements.toastContainer, t('toast.textCleared'), 'info');
  });

  elements.downloadBtn.addEventListener('click', () => {
    const text = elements.outputArea.value;
    if (!text) {
      showToast(elements.toastContainer, t('toast.nothingToDownload'), 'warning');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(elements.toastContainer, t('toast.downloaded'), 'success');
  });
}

// ===========================================================================
// Transcript summaries
// ===========================================================================

/**
 * Summary feature: generate, persist (max 10 per source text), copy, delete.
 *
 * The source-of-truth key is the exact text in the output area at generation
 * time; if the user edits it before the request returns, the result is still
 * saved but the panel only re-renders when the original text is visible again.
 */
function wireSummaryFeature(elements: AppElements, getApiKey: () => string): void {
  let generating = false;

  const renderForVisibleText = async (): Promise<void> => {
    const history = await store.getSummaryHistoryBySource(elements.outputArea.value);
    elements.summarySection.hidden = history === undefined;
    renderSummaryHistory(elements.summaryPanel, history, {
      onCopy: (summary) => {
        void copyToClipboard(summaryToText(summary)).then((copied) => {
          showToast(
            elements.toastContainer,
            copied ? 'Resumen copiado' : 'No se pudo copiar',
            copied ? 'success' : 'error',
          );
        });
      },
      onDelete: async (historyId, summaryId) => {
        await store.removeSummary(historyId, summaryId);
        void renderForVisibleText();
        showToast(elements.toastContainer, t('toast.summaryDeleted'), 'info');
      },
    });
  };

  const updateButton = (): void => {
    elements.summaryBtn.disabled = generating || !elements.outputArea.value.trim();
    const label = elements.summaryBtn.querySelector('span');
    if (label) label.textContent = generating ? 'Generando...' : 'Generar resumen';
  };

  elements.outputArea.addEventListener('input', () => {
    updateButton();
    void renderForVisibleText();
  });

  elements.summaryBtn.addEventListener('click', () => {
    if (generating) return;
    const sourceText = elements.outputArea.value;
    if (!sourceText.trim()) return;

    generating = true;
    updateButton();
    setStatus(elements, { message: 'Generando resumen...', level: 'processing' });

    void generateSummary(sourceText, getApiKey())
      .then(async (result) => {
        await store.addSummary(sourceText, {
          id: crypto.randomUUID(),
          summary: result.summary,
          keyPoints: result.keyPoints,
          model: SUMMARY_MODEL,
          createdAt: Date.now(),
        });
        const sourceIsStillVisible = elements.outputArea.value === sourceText;
        if (sourceIsStillVisible) void renderForVisibleText();
        showToast(
          elements.toastContainer,
          sourceIsStillVisible ? 'Resumen generado' : 'Resumen guardado para el texto anterior',
          'success',
        );
        setStatus(elements, {
          message: sourceIsStillVisible
            ? 'Resumen generado.'
            : 'Resumen guardado para el texto anterior.',
          level: 'success',
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t('toast.summaryFail');
        showToast(elements.toastContainer, message, 'error', 5000);
        setStatus(elements, { message: `Error: ${message}`, level: 'error' });
      })
      .finally(() => {
        generating = false;
        updateButton();
      });
  });

  updateButton();
  void renderForVisibleText();
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Reads the design-token colors used by the waveform (theme-aware). */
function resolveWaveformStyle(canvas: HTMLCanvasElement): WaveformStyle {
  const styles = getComputedStyle(canvas);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    orbGradient: [
      [0, read('--color-waveform-active', '#1f2328')],
      [1, read('--color-waveform-active-muted', '#59636e')],
    ],
    idleColor: read('--color-waveform-idle', '#8c959f'),
    recordingShadowColor: read('--color-waveform-active-muted', '#59636e'),
  };
}

const STATUS_STYLES: Record<StatusUpdate['level'], string> = {
  idle: 'text-[var(--color-text-secondary)]',
  recording: 'text-[var(--color-text-primary)]',
  processing: 'text-[var(--color-text-secondary)]',
  success: 'text-[var(--color-text-primary)]',
  error: 'text-[var(--color-text-primary)]',
  warning: 'text-[var(--color-text-secondary)]',
};

const STATUS_DOT: Record<StatusUpdate['level'], string> = {
  idle: 'bg-[var(--color-text-muted)]',
  recording: 'bg-[var(--color-text-primary)]',
  processing: 'bg-[var(--color-text-muted)]',
  success: 'bg-[var(--color-text-primary)]',
  error: 'bg-[var(--color-text-primary)]',
  warning: 'bg-[var(--color-text-muted)]',
};

/** Replaces the status bar (dot + halo + message) with a fresh {@link StatusUpdate}. */
function setStatus(elements: AppElements, update: StatusUpdate): void {
  elements.statusDiv.replaceChildren();
  elements.statusDiv.className = `flex items-center justify-center gap-2 text-center text-[15px] font-medium mb-4 min-h-[2em] transition-colors duration-[var(--transition-fast)] ${STATUS_STYLES[update.level]}`;

  // Status dot with optional halo when recording.
  const dotWrap = document.createElement('span');
  dotWrap.className = 'relative inline-flex w-2 h-2 shrink-0';
  const dot = document.createElement('span');
  dot.className = `relative inline-flex w-2 h-2 rounded-full ${STATUS_DOT[update.level]}`;
  dotWrap.appendChild(dot);
  if (update.level === 'recording') {
    const halo = document.createElement('span');
    halo.className = `absolute inline-flex w-2 h-2 rounded-full ${STATUS_DOT[update.level]} animate-pulse-ring`;
    dotWrap.appendChild(halo);
  }

  const label = document.createElement('span');
  label.textContent = update.message;

  elements.statusDiv.appendChild(dotWrap);
  elements.statusDiv.appendChild(label);
}

/** Recomputes the word count badge from the output textarea. */
function updateWordCount(elements: AppElements): void {
  const text = elements.outputArea.value.trim();
  const count = text ? text.split(/\s+/).length : 0;
  elements.wordCount.textContent = String(count);
}

/** Formats an elapsed-seconds counter as `MM:SS` for the timer badge. */
function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ===========================================================================
// Start
// ===========================================================================

window.addEventListener('error', (e) => {
  console.error('[window error]', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason);
});

void main();
