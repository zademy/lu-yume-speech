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
import * as audioStore from './audio/audio-store';
import { GroqClient } from './api/groq-client';
import { postProcessWithLlm } from './api/llm-postprocessor';
import { generateSummary, SUMMARY_MODEL } from './api/summary-client';
import { renderApp } from './ui/renderer';
import type { AppElements } from './ui/renderer';
import { renderMetadata } from './ui/metadata-panel';
import { showToast } from './ui/toast';
import { renderSummaryHistory, summaryToText } from './ui/summary-panel';
import { ThemeManager } from './utils/theme';
import { createSidebar, populateEntries } from './ui/sidebar';
import * as historyRepo from './utils/history-repo';
import { calculateHistoryStats } from './utils/history-stats';
import * as summaryRepo from './utils/summary-repo';
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

async function main(): Promise<void> {
  try {
    await bootstrap();
  } catch (err) {
    console.error('[App] Fatal error during initialization:', err);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="alert" style="position:fixed;bottom:1rem;right:1rem;background:var(--color-surface-sunken,#0d1117);color:var(--color-text-primary,#f0f6fc);border:2px solid var(--color-border-strong,#6e7681);padding:1rem;border-radius:8px;z-index:9999;font-family:sans-serif">No se pudo iniciar la app. Revisa la consola.</div>',
    );
  }
}

async function bootstrap(): Promise<void> {
  const bus = new EventBus<EventMap>();

  // Platform bridge — browser storage (localStorage)
  const platform = detectPlatform();
  let apiKey = (await platform.getApiKey()) ?? '';
  const getApiKey = (): string => apiKey;

  const elements = renderApp();

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
    (id) => {
      const entry = historyRepo.getById(id);
      if (!entry) return;
      void copyToClipboard(entry.text).then((copied) => {
        showToast(
          elements.toastContainer,
          copied ? 'Transcripción copiada' : 'No se pudo copiar',
          copied ? 'success' : 'error',
        );
      });
    },
    () => {
      bus.emit('history:clear', undefined);
    },
  );

  const appDiv = getRequiredElement(document, '#app', HTMLDivElement);
  appDiv.replaceChildren(elements.root);

  const renderHistory = (): void => {
    const entries = historyRepo.getAll();
    populateEntries(sidebar, entries);
    renderHistoryStats(elements, entries);
  };
  renderHistory();

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
        showToast(elements.toastContainer, 'No se pudo acceder al micrófono', 'error');
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

  // Live configuration: loaded once, refreshed on settings:change.
  let config: AppSettings = { ...DEFAULT_SETTINGS, ...((await platform.loadSettings()) ?? {}) };
  const getConfig = (): AppSettings => config;
  const setConfig = (next: AppSettings): void => {
    config = next;
  };
  bus.on('settings:change', (patch) => {
    config = { ...config, ...patch };
  });

  // Reflect persisted quality settings in the modal and persist any change.
  populateQualitySettings(elements, config);
  wireQualitySettings(elements, bus, platform, getConfig, setConfig);

  // Wire everything through the event bus
  const navigate = wireNavigation(elements, () => getApiKey(), ensureAudioReady);
  wireApiKeySettings(elements, platform, getApiKey, (next) => {
    apiKey = next;
    updateApiKeyState(elements, next);
  });
  updateApiKeyState(elements, apiKey);

  wireTranscriptionPipeline(bus, client, elements, getConfig, getApiKey, renderHistory);
  wireRecordingHandlers(bus, elements, analyzer, timer, visualizer, recorder);
  wireHistoryEvents(bus, elements, navigate, renderHistory);

  // Keyboard shortcuts
  const cleanup = registerKeyboardShortcuts({
    onRecordStart: () => {
      if (!getApiKey()) {
        navigate('settings');
        showToast(elements.toastContainer, 'Configura tu API key para dictar', 'warning');
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

type AppView = 'home' | 'dictation' | 'settings';

function wireNavigation(
  elements: AppElements,
  getApiKey: () => string,
  ensureAudioReady: () => Promise<boolean>,
): (view: AppView) => void {
  const views: Record<AppView, HTMLElement> = {
    home: elements.homeView,
    dictation: elements.dictationView,
    settings: elements.settingsView,
  };
  const buttons: Record<AppView, HTMLButtonElement> = {
    home: elements.homeNavButton,
    dictation: elements.dictationNavButton,
    settings: elements.settingsNavButton,
  };
  const titles: Record<AppView, string> = {
    home: 'Inicio',
    dictation: 'Dictar',
    settings: 'Ajustes',
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
    elements.pageTitle.textContent = titles[view];
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
      if (view === 'home' || view === 'dictation' || view === 'settings') navigate(view);
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
        showToast(elements.toastContainer, 'API key guardada y activa', 'success');
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
      showToast(elements.toastContainer, 'API key eliminada', 'info');
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
): void {
  bus.on('recording:start', () => {
    analyzer.start();
    timer.start();
    visualizer.setRecording(true);
    visualizer.start();
    elements.waveformContainer.classList.add('recording-active');
    setStatus(elements, { message: 'Escuchando...', level: 'recording' });
  });

  bus.on('recording:stop', () => {
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
    if (timer.getElapsed() > 1) {
      recorder.stop();
      showToast(elements.toastContainer, 'Silencio detectado — procesando...', 'info');
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
  refreshHistory: () => void,
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
      showToast(elements.toastContainer, 'No se detectó texto', 'warning');
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
      showToast(elements.toastContainer, 'No se detectó texto', 'warning');
      setStatus(elements, { message: 'No se detectó texto.', level: 'idle' });
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
    const evictedIds = historyRepo.addEntry(entry);
    refreshHistory();

    // Save the recorded audio clip that matches this transcription.
    const pending = session.complete();
    if (pending) {
      void audioStore.save(entry.id, pending.blob, pending.mimeType).catch((err: unknown) => {
        console.warn('[App] Failed to save audio clip:', err);
      });
    }

    // Clean up audio for evicted history entries
    if (evictedIds.length > 0) {
      void audioStore.removeMany(evictedIds).catch((err: unknown) => {
        console.warn('[App] Failed to clean up evicted audio:', err);
      });
    }

    const copied = await copyToClipboard(text);
    if (copied) {
      showToast(elements.toastContainer, 'Transcripción copiada', 'success');
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
  refreshHistory: () => void,
): void {
  bus.on('history:restore', (id) => {
    const entry = historyRepo.getById(id);
    if (!entry) return;

    elements.outputArea.value = entry.text;
    elements.outputArea.dispatchEvent(new Event('input'));
    navigate('dictation');
    showToast(elements.toastContainer, 'Transcripción restaurada', 'success');
    setStatus(elements, { message: 'Transcripción restaurada.', level: 'success' });
  });

  bus.on('history:delete', (id) => {
    historyRepo.removeEntry(id);
    void audioStore.remove(id);
    refreshHistory();
    showToast(elements.toastContainer, 'Entrada eliminada', 'info');
  });

  bus.on('history:clear', () => {
    historyRepo.clearAll();
    void audioStore.clearAll();
    refreshHistory();
    showToast(elements.toastContainer, 'Historial limpiado', 'info');
  });
}

// ===========================================================================
// Output toolbar
// ===========================================================================

function wireOutputToolbar(elements: AppElements): void {
  elements.copyAllBtn.addEventListener('click', async () => {
    const text = elements.outputArea.value;
    if (!text) {
      showToast(elements.toastContainer, 'No hay texto para copiar', 'warning');
      return;
    }
    const ok = await copyToClipboard(text);
    showToast(
      elements.toastContainer,
      ok ? 'Todo copiado' : 'No se pudo copiar',
      ok ? 'success' : 'error',
    );
  });

  elements.clearBtn.addEventListener('click', () => {
    if (!elements.outputArea.value) return;
    elements.outputArea.value = '';
    elements.outputArea.dispatchEvent(new Event('input'));
    showToast(elements.toastContainer, 'Texto limpiado', 'info');
  });

  elements.downloadBtn.addEventListener('click', () => {
    const text = elements.outputArea.value;
    if (!text) {
      showToast(elements.toastContainer, 'No hay texto para descargar', 'warning');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(elements.toastContainer, 'Archivo descargado', 'success');
  });
}

// ===========================================================================
// Transcript summaries
// ===========================================================================

function wireSummaryFeature(elements: AppElements, getApiKey: () => string): void {
  let generating = false;

  const renderForVisibleText = (): void => {
    const history = summaryRepo.getSummaryHistoryBySource(elements.outputArea.value);
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
      onDelete: (historyId, summaryId) => {
        summaryRepo.removeSummary(historyId, summaryId);
        renderForVisibleText();
        showToast(elements.toastContainer, 'Resumen eliminado', 'info');
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
    renderForVisibleText();
  });

  elements.summaryBtn.addEventListener('click', () => {
    if (generating) return;
    const sourceText = elements.outputArea.value;
    if (!sourceText.trim()) return;

    generating = true;
    updateButton();
    setStatus(elements, { message: 'Generando resumen...', level: 'processing' });

    void generateSummary(sourceText, getApiKey())
      .then((result) => {
        summaryRepo.addSummary(sourceText, {
          id: crypto.randomUUID(),
          summary: result.summary,
          keyPoints: result.keyPoints,
          model: SUMMARY_MODEL,
          createdAt: Date.now(),
        });
        const sourceIsStillVisible = elements.outputArea.value === sourceText;
        if (sourceIsStillVisible) renderForVisibleText();
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
        const message = error instanceof Error ? error.message : 'No se pudo generar el resumen.';
        showToast(elements.toastContainer, message, 'error', 5000);
        setStatus(elements, { message: `Error: ${message}`, level: 'error' });
      })
      .finally(() => {
        generating = false;
        updateButton();
      });
  });

  updateButton();
  renderForVisibleText();
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
