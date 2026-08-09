/**
 * Application UI renderer.
 *
 * Builds the complete DOM layout using the design system tokens defined
 * in style.css. Uses Lucide SVG icons (no emojis) and semantic color
 * classes that support light/dark mode automatically.
 *
 * SRP: This module's only job is DOM construction.
 * OCP: New UI sections can be added as new render functions.
 *
 * App name: LU YUME
 */

import { detectOS } from '../utils/os-detect';
import {
  WHISPER_MODELS,
  LANGUAGES,
  OPERATION_MODES,
  RESPONSE_FORMATS,
  RECORD_MODES,
  DEFAULT_SETTINGS,
} from '../types';

/**
 * Safely set inner HTML using a Range-created document fragment.
 * Avoids direct innerHTML assignment for better security.
 *
 * @param el   - Target element whose content will be replaced
 * @param html - HTML string to parse and insert
 */
function setTrustedHTML(el: HTMLElement, html: string): void {
  const range = document.createRange();
  const fragment = range.createContextualFragment(html);
  el.textContent = '';
  el.appendChild(fragment);
}

export interface AppElements {
  root: HTMLDivElement;
  modelSelect: HTMLSelectElement;
  operationModeSelect: HTMLSelectElement;
  recordModeSelect: HTMLSelectElement;
  noiseReductionSelect: HTMLSelectElement;
  languageSelect: HTMLSelectElement;
  promptInput: HTMLTextAreaElement;
  temperatureSlider: HTMLInputElement;
  temperatureValue: HTMLSpanElement;
  responseFormatSelect: HTMLSelectElement;
  timestampToggle: HTMLInputElement;
  statusDiv: HTMLDivElement;
  waveformCanvas: HTMLCanvasElement;
  waveformContainer: HTMLDivElement;
  timerDisplay: HTMLSpanElement;
  outputArea: HTMLTextAreaElement;
  wordCount: HTMLSpanElement;
  metadataPanel: HTMLDivElement;
  summaryBtn: HTMLButtonElement;
  summarySection: HTMLElement;
  summaryPanel: HTMLDivElement;
  toastContainer: HTMLDivElement;
  themeToggle: HTMLButtonElement;
  copyAllBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
  settingsModal: HTMLDivElement;
  settingsCloseBtn: HTMLButtonElement;
  headerActions: HTMLDivElement;
  customWordsInput: HTMLTextAreaElement;
  wordCorrectionThresholdSlider: HTMLInputElement;
  wordCorrectionThresholdValue: HTMLSpanElement;
  customFillerWordsInput: HTMLInputElement;
  silenceTrimToggle: HTMLInputElement;
  llmToggle: HTMLInputElement;
  llmModelInput: HTMLInputElement;
  llmInstructionsInput: HTMLTextAreaElement;
}

export function renderApp(): AppElements {
  const os = detectOS();

  const root = document.createElement('div');
  root.id = 'app-shell';
  root.className = 'flex flex-col h-full';

  setTrustedHTML(
    root,
    `
    ${renderAppHeader()}
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-xl mx-auto px-4 py-6">
        ${renderStatusBar(os.modifierLabel)}
        ${renderVisualizerArea()}
        ${renderOutputSection()}
      </div>
    </div>
    ${renderAppFooter()}
    ${renderToastContainer()}
  `,
  );

  // Modal rendered OUTSIDE root to escape any overflow/transform containment
  const settingsModal = document.createElement('div');
  setTrustedHTML(settingsModal, renderSettingsModal());
  document.body.appendChild(settingsModal);

  return {
    root,
    modelSelect: settingsModal.querySelector('#modelSelect')!,
    operationModeSelect: settingsModal.querySelector('#operationModeSelect')!,
    recordModeSelect: settingsModal.querySelector('#recordModeSelect')!,
    noiseReductionSelect: settingsModal.querySelector('#noiseReductionSelect')!,
    languageSelect: settingsModal.querySelector('#languageSelect')!,
    promptInput: settingsModal.querySelector('#promptInput')!,
    temperatureSlider: settingsModal.querySelector('#temperatureSlider')!,
    temperatureValue: settingsModal.querySelector('#temperatureValue')!,
    responseFormatSelect: settingsModal.querySelector('#responseFormatSelect')!,
    timestampToggle: settingsModal.querySelector('#timestampToggle')!,
    statusDiv: root.querySelector('#status')!,
    waveformCanvas: root.querySelector('#waveformCanvas')!,
    waveformContainer: root.querySelector('#waveformContainer')!,
    timerDisplay: root.querySelector('#timerDisplay')!,
    outputArea: root.querySelector('#output') as HTMLTextAreaElement,
    wordCount: root.querySelector('#wordCount')!,
    metadataPanel: root.querySelector('#metadataPanel')!,
    summaryBtn: root.querySelector('#summaryBtn')!,
    summarySection: root.querySelector('#summarySection')!,
    summaryPanel: root.querySelector('#summaryPanel')!,
    toastContainer: root.querySelector('#toastContainer')!,
    themeToggle: root.querySelector('#themeToggle')!,
    copyAllBtn: root.querySelector('#copyAllBtn')!,
    clearBtn: root.querySelector('#clearBtn')!,
    downloadBtn: root.querySelector('#downloadBtn')!,
    settingsBtn: root.querySelector('#settingsBtn')!,
    settingsModal: settingsModal.querySelector('#settingsModal')!,
    settingsCloseBtn: settingsModal.querySelector('#settingsCloseBtn')!,
    headerActions: root.querySelector('#headerActions')!,
    customWordsInput: settingsModal.querySelector('#customWordsInput')!,
    wordCorrectionThresholdSlider: settingsModal.querySelector('#wordCorrectionThresholdSlider')!,
    wordCorrectionThresholdValue: settingsModal.querySelector('#wordCorrectionThresholdValue')!,
    customFillerWordsInput: settingsModal.querySelector('#customFillerWordsInput')!,
    silenceTrimToggle: settingsModal.querySelector('#silenceTrimToggle')!,
    llmToggle: settingsModal.querySelector('#llmToggle')!,
    llmModelInput: settingsModal.querySelector('#llmModelInput')!,
    llmInstructionsInput: settingsModal.querySelector('#llmInstructionsInput')!,
  };
}

// -----------------------------------------------------------------------
// App Header — LU YUME branding
// -----------------------------------------------------------------------

/**
 * Render the application header with logo, title, and action buttons.
 * Includes the theme toggle button inside the #headerActions container.
 */
function renderAppHeader(): string {
  return `
    <header class="sticky top-0 z-20 glass-strong flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border-subtle)]">
      <div class="flex items-center gap-3">
        <div class="relative w-10 h-10 rounded-xl bg-[var(--color-control-emphasis)] text-[var(--color-text-inverse)] flex items-center justify-center shadow-[var(--shadow-glow-primary)]">
          ${icons.mic}
        </div>
        <div class="text-left leading-tight">
          <h1 class="text-[15px] font-bold tracking-tight text-brand-gradient">
            LU YUME
          </h1>
          <p class="text-[10.5px] text-[var(--color-text-muted)] font-medium tracking-wide uppercase">Dictado por voz</p>
        </div>
      </div>
      <div id="headerActions" class="flex items-center gap-1">
        <button
          id="settingsBtn"
          type="button"
          class="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
          aria-label="Abrir configuración"
          title="Configuración"
        >${icons.settings}</button>
        <button
          id="themeToggle"
          type="button"
          class="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
          aria-label="Toggle dark mode"
        ></button>
      </div>
    </header>
  `;
}

// -----------------------------------------------------------------------
// App Footer
// -----------------------------------------------------------------------

/**
 * Render the application footer with keyboard shortcut hint and credits.
 */
function renderAppFooter(): string {
  return `
    <footer class="px-5 py-3 border-t border-[var(--color-border-subtle)] glass">
      <div class="max-w-xl mx-auto flex items-center justify-between">
        <p class="text-[10.5px] text-[var(--color-text-muted)] flex items-center gap-1.5">
          <kbd class="inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] font-mono text-[10px] text-[var(--color-text-secondary)]">⌥ / Ctrl</kbd>
          <span>+</span>
          <kbd class="inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] font-mono text-[10px] text-[var(--color-text-secondary)]">Space</kbd>
        </p>
        <p class="text-[10.5px] text-[var(--color-text-muted)]">
          Powered by <span class="font-semibold text-brand-gradient">Groq Whisper</span>
        </p>
      </div>
    </footer>
  `;
}

// -----------------------------------------------------------------------
// SVG Icons
// -----------------------------------------------------------------------

/**
 * Lucide SVG icon strings used throughout the UI.
 * Each value is a complete inline SVG markup string.
 */
const icons = {
  mic: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="6" height="11" x="9" y="2" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  trash:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
  download:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  settings:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  chevronDown:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  sparkle:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
};

// -----------------------------------------------------------------------
// Section renderers
// -----------------------------------------------------------------------

/**
 * Render the collapsible settings panel with all configuration fields:
 * model, operation mode, recording mode, language, prompt, temperature,
 * response format, and rate limit info.
 */
function renderSettingsModal(): string {
  return `
    <div id="settingsModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)">
      <div role="dialog" aria-modal="true" aria-labelledby="settingsTitle" class="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)]">
        <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)] sticky top-0 bg-[var(--color-surface)] z-10">
          <h2 id="settingsTitle" class="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            <span class="text-[var(--color-text-secondary)]">${icons.settings}</span>
            Configuración
          </h2>
          <button id="settingsCloseBtn" type="button" class="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors duration-[var(--transition-fast)] cursor-pointer" aria-label="Cerrar configuración">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="px-5 py-4 space-y-3">
          ${renderSelectField(
            'modelSelect',
            'Modelo',
            WHISPER_MODELS.map((m) => ({
              value: m,
              label: m,
              selected: m === DEFAULT_SETTINGS.model,
            })),
          )}
          ${renderSelectField(
            'operationModeSelect',
            'Modo',
            OPERATION_MODES.map((m) => ({
              value: m.value,
              label: `${m.label} — ${m.description}`,
              selected: m.value === DEFAULT_SETTINGS.operationMode,
            })),
          )}
          ${renderSelectField(
            'recordModeSelect',
            'Grabación',
            RECORD_MODES.map((m) => ({
              value: m.value,
              label: `${m.label} — ${m.description}`,
              selected: m.value === DEFAULT_SETTINGS.recordMode,
            })),
          )}
          ${renderSelectField('noiseReductionSelect', 'Reducción de ruido', [
            { value: 'off', label: 'Desactivada', selected: false },
            { value: 'dsp', label: 'Básica (filtros)', selected: true },
            { value: 'rnnoise', label: 'AI (RNNoise)', selected: false },
          ])}
          ${renderSelectField(
            'languageSelect',
            'Idioma',
            LANGUAGES.map((l) => ({
              value: l.code,
              label: l.label,
              selected: l.code === DEFAULT_SETTINGS.language,
            })),
          )}
          ${renderTextareaField('promptInput', 'Contexto', 'Terminología técnica, nombres propios...', 2)}
          ${renderTemperatureControl()}
          ${renderResponseFormatControl()}
          ${renderQualitySection()}
          ${renderRateLimits()}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render the status bar area that shows recording instructions
 * and real-time status messages.
 *
 * @param modifierLabel - OS-specific modifier key label ("⌥" or "Ctrl")
 */
function renderStatusBar(modifierLabel: string): string {
  return `
    <div id="status" class="flex items-center justify-center gap-2 text-center text-[15px] font-medium text-[var(--color-text-secondary)] mb-4 min-h-[2em] transition-colors duration-[var(--transition-fast)]">
      <span>Presiona</span>
      <kbd class="inline-flex items-center px-2 py-0.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] font-mono text-xs shadow-sm">${modifierLabel}</kbd>
      <span class="text-[var(--color-text-muted)]">+</span>
      <kbd class="inline-flex items-center px-2 py-0.5 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] font-mono text-xs shadow-sm">Space</kbd>
      <span>para hablar</span>
    </div>
  `;
}

/**
 * Render the audio-orb canvas and recording overlays.
 * The canvas is decorative; text status and timer expose the same state.
 */
function renderVisualizerArea(): string {
  return `
    <div id="waveformContainer" class="waveform-container relative mb-4 min-h-36 sm:min-h-40 rounded-2xl overflow-hidden border border-[var(--color-border)] shadow-[var(--shadow-card)] transition-all duration-300">
      <canvas id="waveformCanvas" aria-hidden="true" class="block w-full h-36 sm:h-40"></canvas>
      <span id="timerDisplay" class="absolute top-2.5 right-3 text-[11px] font-mono font-medium text-[var(--color-text-secondary)] glass px-2.5 py-1 rounded-full border border-[var(--color-border-subtle)] shadow-sm">00:00</span>
      <span id="recIndicator" class="rec-indicator absolute top-2.5 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full glass border border-[var(--color-border-subtle)] shadow-sm opacity-0 transition-opacity duration-300">
        <span class="rec-dot w-2 h-2 rounded-full bg-[var(--color-text-primary)]"></span>
        <span class="text-[10px] font-bold tracking-wider text-[var(--color-text-primary)] uppercase">REC</span>
      </span>
    </div>
  `;
}

/**
 * Render the output section with text area, word count, and toolbar buttons.
 */
function renderOutputSection(): string {
  return `
    <div class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <span class="text-[11px] font-medium tracking-wide uppercase text-[var(--color-text-muted)]"><span id="wordCount" class="text-[var(--color-text-secondary)] font-semibold">0</span> palabras</span>
        <div class="flex items-center gap-0.5">
          ${renderToolbarButton('copyAllBtn', icons.copy, 'Copiar todo')}
          ${renderToolbarButton('downloadBtn', icons.download, 'Descargar .txt')}
          ${renderToolbarButton('clearBtn', icons.trash, 'Limpiar')}
        </div>
      </div>
      <textarea id="output" class="w-full h-52 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-[15px] leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent placeholder:text-[var(--color-text-muted)] shadow-[var(--shadow-card)] transition-all duration-[var(--transition-fast)] hover:shadow-[var(--shadow-card-hover)]" placeholder="Tu texto aparecerá aquí..." spellcheck="true"></textarea>
      <div id="metadataPanel" class="hidden rounded-2xl border border-[var(--color-border)] p-3 bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-card)]"></div>
      <div class="pt-2 flex items-center justify-between gap-3">
        <p class="text-[11px] leading-4 text-[var(--color-text-muted)]">Resume el texto visible. La transcripción no cambia.</p>
        <button id="summaryBtn" type="button" disabled class="shrink-0 inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-xl bg-[var(--color-control-emphasis)] text-[var(--color-text-inverse)] text-sm font-semibold shadow-[var(--shadow-glow-primary)] hover:bg-[var(--color-control-emphasis-hover)] active:scale-[0.98] disabled:opacity-45 disabled:shadow-none disabled:cursor-not-allowed transition-all duration-[var(--transition-fast)] cursor-pointer">${icons.sparkle}<span>Generar resumen</span></button>
      </div>
      <section id="summarySection" hidden aria-labelledby="summaryTitle" class="pt-4">
        <div class="flex items-end justify-between gap-3 mb-3 px-1">
          <div>
            <p class="text-[10px] font-bold tracking-[0.14em] uppercase text-[var(--color-text-secondary)]">Derivado del texto visible</p>
            <h2 id="summaryTitle" class="mt-0.5 text-base font-bold tracking-tight text-[var(--color-text-primary)]">Historial de resúmenes</h2>
          </div>
          <span class="hidden sm:inline text-[10px] text-[var(--color-text-muted)]">Hasta 10 generaciones</span>
        </div>
        <div id="summaryPanel" hidden class="space-y-2" aria-live="polite"></div>
      </section>
    </div>
  `;
}

/**
 * Render the fixed-position toast notification container.
 * Positioned in the bottom-right corner of the viewport.
 */
function renderToastContainer(): string {
  return `<div id="toastContainer" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"></div>`;
}

// -----------------------------------------------------------------------
// Field helpers
// -----------------------------------------------------------------------

/**
 * Render a labeled select dropdown with options.
 *
 * @param id      - DOM element ID
 * @param label   - Visible field label
 * @param options - Array of value/label/selected option objects
 */
function renderSelectField(
  id: string,
  label: string,
  options: Array<{ value: string; label: string; selected: boolean }>,
): string {
  const opts = options
    .map((o) => `<option value="${o.value}" ${o.selected ? 'selected' : ''}>${o.label}</option>`)
    .join('');
  return `
    <div class="space-y-1">
      <label for="${id}" class="block text-xs font-medium text-[var(--color-text-muted)] text-left">${label}</label>
      <select id="${id}" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all duration-[var(--transition-fast)] cursor-pointer">${opts}</select>
    </div>`;
}

/**
 * Render a labeled textarea input.
 *
 * @param id          - DOM element ID
 * @param label       - Visible field label
 * @param placeholder - Placeholder text
 * @param rows        - Number of visible text rows
 */
function renderTextareaField(id: string, label: string, placeholder: string, rows: number): string {
  return `
    <div class="space-y-1">
      <label for="${id}" class="block text-xs font-medium text-[var(--color-text-muted)] text-left">${label}</label>
      <textarea id="${id}" rows="${rows}" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)]" placeholder="${placeholder}"></textarea>
    </div>`;
}

/**
 * Render the temperature slider with live value display.
 * Controls the sampling temperature for the Whisper model (0–1).
 */
function renderTemperatureControl(): string {
  return `
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <label for="temperatureSlider" class="text-xs font-medium text-[var(--color-text-muted)]">Temperatura</label>
        <span id="temperatureValue" class="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 rounded">${DEFAULT_SETTINGS.temperature}</span>
      </div>
      <input id="temperatureSlider" type="range" min="0" max="1" step="0.1" value="${DEFAULT_SETTINGS.temperature}" class="w-full h-1.5 rounded-full appearance-none bg-[var(--color-surface-sunken)] accent-[var(--color-control-emphasis)] cursor-pointer" />
    </div>`;
}

/**
 * Render the response format selector with a word-level timestamp toggle.
 * The toggle is only active when verbose_json format is selected.
 */
function renderResponseFormatControl(): string {
  const options = RESPONSE_FORMATS.map(
    (f) =>
      `<option value="${f.value}" ${f.value === DEFAULT_SETTINGS.responseFormat ? 'selected' : ''}>${f.label}</option>`,
  ).join('');
  return `
    <div class="flex items-end gap-3">
      <div class="flex-1 space-y-1">
        <label for="responseFormatSelect" class="block text-xs font-medium text-[var(--color-text-muted)] text-left">Formato</label>
        <select id="responseFormatSelect" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all duration-[var(--transition-fast)] cursor-pointer">${options}</select>
      </div>
      <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap cursor-pointer pb-2.5">
        <input id="timestampToggle" type="checkbox" class="accent-[var(--color-control-emphasis)] cursor-pointer" /> Por palabra
      </label>
    </div>`;
}

/**
 * Render the "transcription quality" section: custom vocabulary, fuzzy-correction
 * threshold, filler-word overrides, silence trimming, and the optional LLM
 * polish pass. Controls are populated from DEFAULT_SETTINGS at first paint and
 * kept in sync with AppSettings by the composition root.
 */
function renderQualitySection(): string {
  return `
    <div class="pt-2 mt-1 border-t border-[var(--color-border-subtle)] space-y-3">
      <h3 class="text-[11px] font-semibold tracking-wide uppercase text-[var(--color-text-muted)] flex items-center gap-1.5">${icons.sparkle}Calidad de transcripción</h3>
      ${renderTextareaField(
        'customWordsInput',
        'Vocabulario personalizado',
        'Nombres propios, jerga, siglas (uno por línea o coma)...',
        2,
      )}
      ${renderRangeField(
        'wordCorrectionThresholdSlider',
        'wordCorrectionThresholdValue',
        'Tolerancia de corrección',
        String(DEFAULT_SETTINGS.wordCorrectionThreshold),
        '0.1',
        '1',
        '0.05',
      )}
      ${renderTextField(
        'customFillerWordsInput',
        'Muletillas personalizadas',
        'Vacío = predeterminadas por idioma · lista separada por comas',
      )}
      ${renderToggleField(
        'silenceTrimToggle',
        'Recortar silencios',
        'Elimina silencios inicial/final antes de transcribir (fail-open).',
        DEFAULT_SETTINGS.enableSilenceTrim,
      )}
      ${renderToggleField(
        'llmToggle',
        'Refinado con LLM',
        'Pule puntuación, mayúsculas y errores tras transcribir (Groq chat).',
        DEFAULT_SETTINGS.enableLlmPostProcess,
      )}
      ${renderTextField('llmModelInput', 'Modelo LLM', DEFAULT_SETTINGS.llmModel)}
      ${renderTextareaField(
        'llmInstructionsInput',
        'Instrucciones LLM (extra)',
        'Ej: tono formal, dominio médico, etc.',
        2,
      )}
    </div>`;
}

/**
 * Render a labeled single-line text input.
 */
function renderTextField(id: string, label: string, placeholder: string): string {
  return `
    <div class="space-y-1">
      <label for="${id}" class="block text-xs font-medium text-[var(--color-text-muted)] text-left">${label}</label>
      <input id="${id}" type="text" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)]" placeholder="${placeholder}" />
    </div>`;
}

/**
 * Render a labeled range slider with a live value readout.
 */
function renderRangeField(
  id: string,
  valueId: string,
  label: string,
  value: string,
  min: string,
  max: string,
  step: string,
): string {
  return `
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <label for="${id}" class="text-xs font-medium text-[var(--color-text-muted)]">${label}</label>
        <span id="${valueId}" class="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 rounded">${value}</span>
      </div>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" class="w-full h-1.5 rounded-full appearance-none bg-[var(--color-surface-sunken)] accent-[var(--color-control-emphasis)] cursor-pointer" />
    </div>`;
}

/**
 * Render a labeled toggle (checkbox) with a descriptive hint.
 */
function renderToggleField(id: string, label: string, hint: string, checked: boolean): string {
  return `
    <label for="${id}" class="flex items-start gap-2.5 cursor-pointer">
      <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} class="mt-0.5 h-4 w-4 rounded border-[var(--color-border-strong)] accent-[var(--color-control-emphasis)] cursor-pointer" />
      <span class="flex flex-col">
        <span class="text-xs font-medium text-[var(--color-text-muted)]">${label}</span>
        <span class="text-[11px] text-[var(--color-text-muted)] opacity-80">${hint}</span>
      </span>
    </label>`;
}

/**
 * Render the Groq free-tier rate limit information panel.
 */
function renderRateLimits(): string {
  return `
    <div class="rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border-subtle)] p-3 text-xs text-[var(--color-text-muted)] text-left">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-[var(--color-text-secondary)] flex items-center gap-1.5">${icons.sparkle}Límites (Free)</span>
        <a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener noreferrer" class="text-[var(--color-text-primary)] hover:text-[var(--color-text-secondary)] no-underline font-semibold transition-colors duration-[var(--transition-fast)]">Ver →</a>
      </div>
      <div class="mt-2 grid grid-cols-3 gap-2 text-[10px]">
        <span class="px-2 py-1 rounded-md bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">20 req/min</span>
        <span class="px-2 py-1 rounded-md bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">2,000 req/día</span>
        <span class="px-2 py-1 rounded-md bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">~8 hrs/día</span>
      </div>
    </div>`;
}

/**
 * Render a small icon-only toolbar button.
 *
 * @param id        - DOM element ID
 * @param iconSvg   - Inline SVG icon markup
 * @param ariaLabel - Accessible label for screen readers
 */
function renderToolbarButton(id: string, iconSvg: string, ariaLabel: string): string {
  return `<button id="${id}" type="button" class="group/btn relative p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] active:scale-[0.97] transition-all duration-[var(--transition-fast)] cursor-pointer" aria-label="${ariaLabel}" title="${ariaLabel}">${iconSvg}</button>`;
}
