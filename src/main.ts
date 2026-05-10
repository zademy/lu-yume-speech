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
import type { EventMap, TranscriptionOptions, StatusUpdate, HistoryEntry } from './types';

import { Recorder } from './audio/recorder';
import { AudioAnalyzer } from './audio/audio-analyzer';
import { RecordingTimer } from './audio/recording-timer';
import { WaveformVisualizer } from './audio/waveform-visualizer';
import { GroqClient } from './api/groq-client';
import { renderApp } from './ui/renderer';
import type { AppElements } from './ui/renderer';
import { renderMetadata } from './ui/metadata-panel';
import { showToast } from './ui/toast';
import { ThemeManager } from './utils/theme';
import { createSidebar, populateEntries, prependEntry, removeCard, clearCards } from './ui/sidebar';
import type { SidebarElements } from './ui/sidebar';
import * as historyRepo from './utils/history-repo';

import { registerKeyboardShortcuts } from './utils/keyboard';
import { readTranscriptionOptions, readOperationMode } from './utils/settings';
import { copyToClipboard } from './utils/clipboard';

// ===========================================================================
// Bootstrap
// ===========================================================================

async function main(): Promise<void> {
  const bus = new EventBus<EventMap>();

  const elements = renderApp();

  // Sidebar
  const sidebar = createSidebar(
    (id) => bus.emit('history:restore', id),
    (id) => bus.emit('history:delete', id),
    () => bus.emit('history:clear', undefined),
  );

  // Load existing history into sidebar
  populateEntries(sidebar, historyRepo.getAll());

  // Compose layout: centered container with sidebar + app side by side
  const appDiv = document.querySelector<HTMLDivElement>('#app')!;
  appDiv.className = 'flex items-start justify-center gap-4 p-4 min-h-screen';

  // Wrapper for sidebar + main content
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-start gap-4 w-full max-w-5xl';

  wrapper.appendChild(sidebar.root);

  const mainEl = document.createElement('main');
  mainEl.className =
    'flex-1 min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] overflow-hidden';
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

  // Service modules (DIP: they receive the bus, not each other)
  const recorder = new Recorder(bus);
  const analyzer = new AudioAnalyzer(bus);
  const timer = new RecordingTimer(bus);
  const client = new GroqClient(bus);
  const visualizer = new WaveformVisualizer(elements.waveformCanvas);

  // Microphone access
  let stream: MediaStream;
  try {
    await recorder.init();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    analyzer.connect(stream);
  } catch (error) {
    console.error('[App] Microphone access denied:', error);
    showToast(elements.toastContainer, 'No se pudo acceder al micrófono', 'error');
    return;
  }

  // Canvas sizing
  visualizer.syncSize();
  visualizer.drawIdle();
  window.addEventListener('resize', () => visualizer.syncSize());

  // Wire everything through the event bus
  wireTranscriptionPipeline(bus, client, elements, sidebar);
  wireRecordingHandlers(bus, elements, analyzer, timer, visualizer, recorder);
  wireOutputToolbar(elements);
  wireHistoryEvents(bus, sidebar, elements);

  // Keyboard shortcuts
  const cleanup = registerKeyboardShortcuts({
    onRecordStart: () => recorder.start(),
    onRecordStop: () => recorder.stop(),
    getMode: () => elements.recordModeSelect.value as 'push-to-talk' | 'toggle',
  });

  window.addEventListener('unload', () => {
    cleanup();
    analyzer.dispose();
    recorder.dispose();
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
    setStatus(elements, { message: 'Escuchando...', level: 'recording' });
  });

  bus.on('recording:stop', () => {
    analyzer.stop();
    timer.stop();
    visualizer.drawIdle();
  });

  bus.on('recording:level', (level) => {
    const data = analyzer.getWaveformData();
    if (data) visualizer.drawFrame(data);

    const bars = Math.round(level * 10);
    const barStr = '|'.repeat(bars) + '.'.repeat(10 - bars);
    elements.statusDiv.textContent = `Escuchando  [${barStr}]`;
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
): void {
  bus.on('audio:blob-ready', (blob) => {
    const options: TranscriptionOptions = readTranscriptionOptions(elements);
    const mode = readOperationMode(elements);
    const endpoint = mode === 'translate' ? 'translations' : 'transcriptions';
    client.transcribe(blob, options, endpoint);
    setStatus(elements, { message: `Procesando con ${options.model}...`, level: 'processing' });
  });

  bus.on('transcription:success', async (result) => {
    renderMetadata(elements.metadataPanel, result);

    if (!result.text) {
      showToast(elements.toastContainer, 'No se detectó texto', 'warning');
      setStatus(elements, { message: 'No se detectó texto.', level: 'idle' });
      return;
    }

    const output = elements.outputArea;
    output.value += (output.value ? ' ' : '') + result.text;
    output.scrollTop = output.scrollHeight;
    updateWordCount(elements);

    bus.emit('text:append', result.text);

    // Save to history
    const options = readTranscriptionOptions(elements);
    const mode = readOperationMode(elements);
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      text: result.text,
      language: result.language,
      model: options.model,
      duration: result.duration,
      createdAt: Date.now(),
      operationMode: mode,
    };
    historyRepo.addEntry(entry);
    prependEntry(sidebar, entry);

    const copied = await copyToClipboard(result.text);
    if (copied) {
      showToast(elements.toastContainer, 'Texto copiado al portapapeles', 'success');
      setStatus(elements, { message: 'Texto copiado al portapapeles.', level: 'success' });
    } else {
      setStatus(elements, { message: 'Listo.', level: 'idle' });
    }
  });

  bus.on('transcription:error', (error) => {
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
    updateWordCount(elements);
    showToast(elements.toastContainer, 'Transcripción restaurada', 'success');
    setStatus(elements, { message: 'Transcripción restaurada.', level: 'success' });
  });

  bus.on('history:delete', (id) => {
    historyRepo.removeEntry(id);
    removeCard(sidebar, id);
    showToast(elements.toastContainer, 'Entrada eliminada', 'info');
  });

  bus.on('history:clear', () => {
    historyRepo.clearAll();
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
    updateWordCount(elements);
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
// Helpers
// ===========================================================================

const STATUS_STYLES: Record<StatusUpdate['level'], string> = {
  idle: 'text-[var(--color-text-secondary)]',
  recording: 'text-[var(--color-status-recording)] animate-pulse',
  processing: 'text-[var(--color-status-processing)]',
  success: 'text-[var(--color-status-success)]',
  error: 'text-[var(--color-status-error)]',
  warning: 'text-[var(--color-status-warning)]',
};

function setStatus(elements: AppElements, update: StatusUpdate): void {
  elements.statusDiv.textContent = update.message;
  elements.statusDiv.className = `text-center text-base font-medium mb-4 min-h-[1.75em] transition-colors duration-[var(--transition-fast)] ${STATUS_STYLES[update.level]}`;
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

main().catch((error) => {
  console.error('[App] Fatal error during initialization:', error);
});
