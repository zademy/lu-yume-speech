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
import { createSidebar, populateEntries, prependEntry, removeCard, clearCards } from './ui/sidebar';
import type { SidebarElements } from './ui/sidebar';
import * as historyRepo from './utils/history-repo';
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

// ===========================================================================
// API Key Modal
// ===========================================================================

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

async function promptApiKey(platform: Platform): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)';

    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="apikey-title" style="background:var(--color-surface,#151b23);border-radius:16px;padding:2rem;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--color-border,#3d444d)">
        <h2 id="apikey-title" style="color:var(--color-text-primary,#f0f6fc);font-family:Inter,sans-serif;font-size:1.25rem;font-weight:700;margin:0 0 0.5rem">
          <span style="filter:grayscale(1)">🔑</span> Groq API Key
        </h2>
        <p style="color:var(--color-text-muted,#9198a1);font-family:Inter,sans-serif;font-size:0.875rem;margin:0 0 1.5rem">
          Obtén tu key gratis en <a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="color:var(--color-text-primary,#f0f6fc)">console.groq.com/keys</a>
        </p>
        <input
          type="password"
          id="apikey-input"
          placeholder="gsk_..."
          autocomplete="off"
          spellcheck="false"
          style="width:100%;box-sizing:border-box;padding:0.75rem 1rem;border-radius:8px;border:1px solid var(--color-border,#3d444d);background:var(--color-surface-sunken,#0d1117);color:var(--color-text-primary,#f0f6fc);font-family:'JetBrains Mono',monospace;font-size:0.875rem;outline:none;margin-bottom:0.5rem"
        />
        <p id="apikey-error" style="color:var(--color-text-primary,#f0f6fc);font-family:Inter,sans-serif;font-size:0.75rem;font-weight:600;margin:0 0 1rem;min-height:1rem"></p>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end">
          <button id="apikey-cancel" style="padding:0.6rem 1.25rem;border-radius:8px;border:1px solid var(--color-border,#3d444d);background:transparent;color:var(--color-text-muted,#9198a1);font-family:Inter,sans-serif;font-size:0.875rem;cursor:pointer">
            Cancelar
          </button>
          <button id="apikey-save" style="padding:0.6rem 1.25rem;border-radius:8px;border:none;background:var(--color-control-emphasis,#f0f6fc);color:var(--color-text-inverse,#0d1117);font-family:Inter,sans-serif;font-size:0.875rem;font-weight:600;cursor:pointer">
            Guardar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = getRequiredElement(overlay, '#apikey-input', HTMLInputElement);
    const error = getRequiredElement(overlay, '#apikey-error', HTMLParagraphElement);
    const saveBtn = getRequiredElement(overlay, '#apikey-save', HTMLButtonElement);
    const cancelBtn = getRequiredElement(overlay, '#apikey-cancel', HTMLButtonElement);

    input.focus();

    const close = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const submit = async () => {
      const key = input.value.trim();
      if (!key) {
        error.textContent = 'Pega tu API key aquí.';
        return;
      }
      const result = apiKeySchema.safeParse(key);
      if (!result.success) {
        error.textContent =
          'Formato inválido. Debe empezar con gsk_ y tener al menos 44 caracteres.';
        return;
      }
      saveBtn.textContent = 'Guardando...';
      saveBtn.disabled = true;
      await platform.setApiKey(key);
      close(key);
    };

    saveBtn.addEventListener('click', () => void submit());
    cancelBtn.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
      if (e.key === 'Escape') close(null);
    });
  });
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
  let apiKey = await platform.getApiKey();
  if (!apiKey) {
    apiKey = await promptApiKey(platform);
    if (apiKey) {
      console.warn('[App] API key saved.');
    }
  }

  const elements = renderApp();

  // Sidebar
  const sidebar = createSidebar(
    (id) => {
      bus.emit('history:restore', id);
    },
    (id) => {
      bus.emit('history:delete', id);
    },
    () => {
      bus.emit('history:clear', undefined);
    },
  );

  // Load existing history into sidebar
  populateEntries(sidebar, historyRepo.getAll());

  // Compose layout: centered container with sidebar + app side by side
  const appDiv = getRequiredElement(document, '#app', HTMLDivElement);
  appDiv.className = 'flex items-start justify-center gap-4 p-4 md:p-6 min-h-screen';

  // Wrapper for sidebar + main content — wider to comfortably host the sidebar.
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-start gap-4 md:gap-6 w-full max-w-6xl';

  wrapper.appendChild(sidebar.root);

  const mainEl = document.createElement('main');
  mainEl.className =
    'flex-1 min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] overflow-hidden animate-slide-up-fade';
  mainEl.appendChild(elements.root);
  wrapper.appendChild(mainEl);

  appDiv.appendChild(wrapper);

  // Insert sidebar toggle button into the app header (before theme toggle)
  elements.headerActions.insertBefore(sidebar.toggleBtn, elements.themeToggle);

  // Theme — initialize before first paint to avoid flash
  const theme = new ThemeManager(elements.themeToggle);
  theme.init();

  // Wire live UI interactions
  wireLiveControls(elements);
  wireOutputToolbar(elements);
  wireSummaryFeature(elements, apiKey ?? '');

  // Settings modal open/close
  const openSettings = () => elements.settingsModal.classList.remove('hidden');
  const closeSettings = () => elements.settingsModal.classList.add('hidden');
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.settingsCloseBtn.addEventListener('click', closeSettings);
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) closeSettings();
  });
  elements.settingsModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

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
  const client = new GroqClient(bus, apiKey ?? '');
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

  // Microphone access — process through audio enhancement chain before recording
  try {
    const rawStream = await recorder.init();
    const processed = await audioProcessor.process(rawStream, 'dsp');
    recorder.setRecordingStream(processed.stream);
    analyzer.connectAnalyser(processed.analyser);
    visualizer.connectAnalyser(processed.analyser);
  } catch (error) {
    console.error('[App] Microphone access denied:', error);
    showToast(elements.toastContainer, 'No se pudo acceder al micrófono', 'error');
    return;
  }

  // Canvas sizing
  visualizer.syncSize();
  visualizer.drawIdle();
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
  wireTranscriptionPipeline(bus, client, elements, sidebar, getConfig, apiKey ?? '');
  wireRecordingHandlers(bus, elements, analyzer, timer, visualizer, recorder);
  wireHistoryEvents(bus, sidebar, elements);

  // Keyboard shortcuts
  const cleanup = registerKeyboardShortcuts({
    onRecordStart: () => {
      recorder.start();
    },
    onRecordStop: () => {
      recorder.stop();
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
  sidebar: SidebarElements,
  getConfig: () => AppSettings,
  apiKey: string,
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
      text = await postProcessWithLlm(text, apiKey, {
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
    prependEntry(sidebar, entry);

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
      showToast(elements.toastContainer, 'Texto copiado al portapapeles', 'success');
      setStatus(elements, { message: 'Texto copiado al portapapeles.', level: 'success' });
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
  sidebar: SidebarElements,
  elements: AppElements,
): void {
  bus.on('history:restore', (id) => {
    const entry = historyRepo.getById(id);
    if (!entry) return;

    elements.outputArea.value = entry.text;
    elements.outputArea.dispatchEvent(new Event('input'));
    showToast(elements.toastContainer, 'Transcripción restaurada', 'success');
    setStatus(elements, { message: 'Transcripción restaurada.', level: 'success' });
  });

  bus.on('history:delete', (id) => {
    historyRepo.removeEntry(id);
    void audioStore.remove(id);
    removeCard(sidebar, id);
    showToast(elements.toastContainer, 'Entrada eliminada', 'info');
  });

  bus.on('history:clear', () => {
    historyRepo.clearAll();
    void audioStore.clearAll();
    clearCards(sidebar);
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

function wireSummaryFeature(elements: AppElements, apiKey: string): void {
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

    void generateSummary(sourceText, apiKey)
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
