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
} from './types';
import { DEFAULT_SETTINGS } from './types';

import { Recorder } from './audio/recorder';
import { AudioAnalyzer } from './audio/audio-analyzer';
import { RecordingTimer } from './audio/recording-timer';
import { WaveformVisualizer, type WaveformStyle } from './audio/waveform-visualizer';
import { AudioProcessor } from './audio/audio-processor';
import type { NoiseReductionMode } from './audio/audio-processor';
import { trimSilence } from './audio/silence-trimmer';
import * as store from './db/recordings-db';
import { GroqClient } from './api/groq-client';
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

function t(key: string, params?: Record<string, string | number>): string {
  return translate(activeLang, key, params);
}

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

async function bootstrap(): Promise<void> {
  const bus = new EventBus<EventMap>();

  // Platform bridge — browser storage (localStorage)
  const platform = detectPlatform();
  let apiKey = (await platform.getApiKey()) ?? '';
  const getApiKey = (): string => apiKey;

  // Live configuration: loaded once, refreshed on settings:change.
  let config: AppSettings = { ...DEFAULT_SETTINGS, ...((await platform.loadSettings()) ?? {}) };
  const getConfig = (): AppSettings => config;
  const setConfig = (next: AppSettings): void => {
    config = next;
  };
  bus.on('settings:change', (patch) => {
    config = { ...config, ...patch };
  });
  activeLang = config.appLanguage;

  const elements = renderApp();
  translateTree(elements.root, config.appLanguage);

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
        const escrito = await escritos.getEscrito(id);
        const panel = plumaHolder.panel;
        if (!escrito || !panel) return;
        // Lazy-load the editor (Crepe/ProseMirror) so it stays out of the
        // initial bundle — only Pluma users pay for it, and only on first open.
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

  void refreshEscritos();
  elements.plumaView
    .querySelector<HTMLButtonElement>('#plumaNewButton')
    ?.addEventListener('click', async () => {
      const escrito = await escritos.createEscrito(t('pluma.untitled'));
      await refreshEscritos();
      plumaPanel.preview(escrito);
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
  const client = new GroqClient(bus, getApiKey);
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
    () => getApiKey(),
    ensureAudioReady,
    () => config.appLanguage,
    activeView,
  );
  wireApiKeySettings(elements, platform, getApiKey, (next) => {
    apiKey = next;
    updateApiKeyState(elements, next);
  });
  updateApiKeyState(elements, apiKey);

  wireTranscriptionPipeline(
    bus,
    client,
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
      if (!getApiKey()) {
        navigate('settings');
        showToast(elements.toastContainer, t('toast.needApiKey'), 'warning');
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

type AppView = 'home' | 'dictation' | 'settings' | 'metrics' | 'pluma';

function wireNavigation(
  elements: AppElements,
  getApiKey: () => string,
  ensureAudioReady: () => Promise<boolean>,
  getLang: () => AppLanguage,
  holder: { view: AppView },
): (view: AppView) => void {
  const views: Record<AppView, HTMLElement> = {
    home: elements.homeView,
    dictation: elements.dictationView,
    settings: elements.settingsView,
    metrics: elements.metricsView,
    pluma: elements.plumaView,
  };
  const buttons: Record<AppView, HTMLButtonElement> = {
    home: elements.homeNavButton,
    dictation: elements.dictationNavButton,
    settings: elements.settingsNavButton,
    metrics: elements.metricsNavButton,
    pluma: elements.plumaNavButton,
  };
  const titles: Record<AppView, string> = {
    home: 'home.title',
    dictation: 'dictation.title',
    settings: 'settings.title',
    metrics: 'metrics.title',
    pluma: 'pluma.title',
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
      .setApiKey(key)
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
    void platform.deleteApiKey().then(() => {
      setApiKey('');
      elements.apiKeyInput.value = '';
      elements.apiKeyError.textContent = '';
      showToast(elements.toastContainer, t('toast.apiKeyDeleted'), 'info');
    });
  });
}

function updateApiKeyState(elements: AppElements, apiKey: string): void {
  const configured = apiKey.length > 0;
  elements.apiKeyStatus.textContent = configured ? 'Configurada' : 'Sin configurar';
  elements.apiKeyStatus.classList.toggle('is-configured', configured);
  elements.apiKeyDeleteButton.disabled = !configured;
  elements.dictationKeyGate.hidden = configured;
  elements.dictationWorkspace.hidden = !configured;
}

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

function wireTranscriptionPipeline(
  bus: EventBus<EventMap>,
  client: GroqClient,
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
    const endpoint = mode === 'translate' ? 'translations' : 'transcriptions';
    void client.transcribe(audio, options, endpoint).catch(() => {
      // Error already emitted on the bus via transcription:error
    });
    setStatus(elements, { message: `Procesando con ${options.model}...`, level: 'processing' });
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
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      text,
      language: result.language,
      model: options.model,
      duration: result.duration,
      createdAt: Date.now(),
      operationMode: mode,
    };
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

function updateWordCount(elements: AppElements): void {
  const text = elements.outputArea.value.trim();
  const count = text ? text.split(/\s+/).length : 0;
  elements.wordCount.textContent = String(count);
}

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
