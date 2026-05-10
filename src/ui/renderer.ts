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
  languageSelect: HTMLSelectElement;
  promptInput: HTMLTextAreaElement;
  temperatureSlider: HTMLInputElement;
  temperatureValue: HTMLSpanElement;
  responseFormatSelect: HTMLSelectElement;
  timestampToggle: HTMLInputElement;
  statusDiv: HTMLDivElement;
  waveformCanvas: HTMLCanvasElement;
  timerDisplay: HTMLSpanElement;
  outputArea: HTMLTextAreaElement;
  wordCount: HTMLSpanElement;
  metadataPanel: HTMLDivElement;
  toastContainer: HTMLDivElement;
  themeToggle: HTMLButtonElement;
  copyAllBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  headerActions: HTMLDivElement;
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
        ${renderSettingsPanel()}
        ${renderStatusBar(os.modifierLabel)}
        ${renderVisualizerArea()}
        ${renderOutputSection()}
      </div>
    </div>
    ${renderAppFooter()}
    ${renderToastContainer()}
  `,
  );

  return {
    root,
    modelSelect: root.querySelector('#modelSelect')!,
    operationModeSelect: root.querySelector('#operationModeSelect')!,
    recordModeSelect: root.querySelector('#recordModeSelect')!,
    languageSelect: root.querySelector('#languageSelect')!,
    promptInput: root.querySelector('#promptInput')!,
    temperatureSlider: root.querySelector('#temperatureSlider')!,
    temperatureValue: root.querySelector('#temperatureValue')!,
    responseFormatSelect: root.querySelector('#responseFormatSelect')!,
    timestampToggle: root.querySelector('#timestampToggle')!,
    statusDiv: root.querySelector('#status')!,
    waveformCanvas: root.querySelector('#waveformCanvas')!,
    timerDisplay: root.querySelector('#timerDisplay')!,
    outputArea: root.querySelector('#output') as HTMLTextAreaElement,
    wordCount: root.querySelector('#wordCount')!,
    metadataPanel: root.querySelector('#metadataPanel')!,
    toastContainer: root.querySelector('#toastContainer')!,
    themeToggle: root.querySelector('#themeToggle')!,
    copyAllBtn: root.querySelector('#copyAllBtn')!,
    clearBtn: root.querySelector('#clearBtn')!,
    downloadBtn: root.querySelector('#downloadBtn')!,
    headerActions: root.querySelector('#headerActions')!,
  };
}

// -----------------------------------------------------------------------
// App Header — LU YUME branding
// -----------------------------------------------------------------------

function renderAppHeader(): string {
  return `
    <header class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white flex items-center justify-center shadow-sm">
          ${icons.mic}
        </div>
        <div class="text-left">
          <h1 class="text-base font-bold text-[var(--color-text-primary)] leading-tight tracking-tight">
            LU YUME
          </h1>
          <p class="text-[10px] text-[var(--color-text-muted)] leading-none">Dictado por voz</p>
        </div>
      </div>
      <div id="headerActions" class="flex items-center gap-1">
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

function renderAppFooter(): string {
  return `
    <footer class="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <div class="max-w-xl mx-auto flex items-center justify-between">
        <p class="text-[10px] text-[var(--color-text-muted)]">
          ⌥/Ctrl + Space para grabar
        </p>
        <p class="text-[10px] text-[var(--color-text-muted)]">
          Powered by <span class="font-medium text-[var(--color-text-secondary)]">Groq Whisper</span>
        </p>
      </div>
    </footer>
  `;
}

// -----------------------------------------------------------------------
// SVG Icons
// -----------------------------------------------------------------------

const icons = {
  mic: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 8-9.04 9.06a2.82 2.82 0 1 0 3.98 3.98L16 12"/><circle cx="17" cy="7" r="5"/></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  trash:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
  download:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  settings:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  chevronDown:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
};

// -----------------------------------------------------------------------
// Section renderers
// -----------------------------------------------------------------------

function renderSettingsPanel(): string {
  return `
    <details class="group mb-5 rounded-xl bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden border border-[var(--color-border)] transition-shadow duration-[var(--transition-normal)] hover:shadow-[var(--shadow-card-hover)]">
      <summary class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--transition-fast)]">
        <span class="flex items-center gap-2">
          ${icons.settings}
          Configuración
        </span>
        <span class="text-[var(--color-text-muted)] transition-transform duration-[var(--transition-fast)] group-open:rotate-180">
          ${icons.chevronDown}
        </span>
      </summary>
      <div class="px-4 pb-4 space-y-3 border-t border-[var(--color-border)]">
        <div class="pt-3">
          ${renderSelectField(
            'modelSelect',
            'Modelo',
            WHISPER_MODELS.map((m) => ({
              value: m,
              label: m,
              selected: m === DEFAULT_SETTINGS.model,
            })),
          )}
        </div>
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
        ${renderRateLimits()}
      </div>
    </details>
  `;
}

function renderStatusBar(modifierLabel: string): string {
  return `
    <div id="status" class="text-center text-base font-medium text-[var(--color-text-secondary)] mb-4 min-h-[1.75em] transition-colors duration-[var(--transition-fast)]">
      Presiona
      <kbd class="inline-flex items-center px-2 py-0.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] font-mono text-xs">${modifierLabel}</kbd>
      +
      <kbd class="inline-flex items-center px-2 py-0.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] font-mono text-xs">Space</kbd>
      para hablar
    </div>
  `;
}

function renderVisualizerArea(): string {
  return `
    <div class="relative mb-4 rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
      <canvas id="waveformCanvas" class="w-full h-16"></canvas>
      <span id="timerDisplay" class="absolute top-2 right-3 text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-surface)]/70 backdrop-blur-sm px-2 py-0.5 rounded-md">00:00</span>
    </div>
  `;
}

function renderOutputSection(): string {
  return `
    <div class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <span class="text-xs text-[var(--color-text-muted)]"><span id="wordCount">0</span> palabras</span>
        <div class="flex items-center gap-1">
          ${renderToolbarButton('copyAllBtn', icons.copy, 'Copiar todo')}
          ${renderToolbarButton('downloadBtn', icons.download, 'Descargar .txt')}
          ${renderToolbarButton('clearBtn', icons.trash, 'Limpiar')}
        </div>
      </div>
      <textarea id="output" class="w-full h-40 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-base leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-border-strong)] focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-text-muted)] shadow-[var(--shadow-card)] transition-all duration-[var(--transition-fast)]" placeholder="Tu texto aparecerá aquí..."></textarea>
      <div id="metadataPanel" class="hidden rounded-xl border border-[var(--color-border)] p-3 bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-card)]"></div>
    </div>
  `;
}

function renderToastContainer(): string {
  return `<div id="toastContainer" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"></div>`;
}

// -----------------------------------------------------------------------
// Field helpers
// -----------------------------------------------------------------------

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
      <select id="${id}" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent transition-all duration-[var(--transition-fast)] cursor-pointer">${opts}</select>
    </div>`;
}

function renderTextareaField(id: string, label: string, placeholder: string, rows: number): string {
  return `
    <div class="space-y-1">
      <label for="${id}" class="block text-xs font-medium text-[var(--color-text-muted)] text-left">${label}</label>
      <textarea id="${id}" rows="${rows}" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent transition-all duration-[var(--transition-fast)] placeholder:text-[var(--color-text-muted)]" placeholder="${placeholder}"></textarea>
    </div>`;
}

function renderTemperatureControl(): string {
  return `
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <label for="temperatureSlider" class="text-xs font-medium text-[var(--color-text-muted)]">Temperatura</label>
        <span id="temperatureValue" class="text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 rounded">${DEFAULT_SETTINGS.temperature}</span>
      </div>
      <input id="temperatureSlider" type="range" min="0" max="1" step="0.1" value="${DEFAULT_SETTINGS.temperature}" class="w-full h-1.5 rounded-full appearance-none bg-[var(--color-primary-200)] accent-[var(--color-accent-500)] cursor-pointer dark:bg-[var(--color-primary-800)]" />
    </div>`;
}

function renderResponseFormatControl(): string {
  const options = RESPONSE_FORMATS.map(
    (f) =>
      `<option value="${f.value}" ${f.value === DEFAULT_SETTINGS.responseFormat ? 'selected' : ''}>${f.label}</option>`,
  ).join('');
  return `
    <div class="flex items-end gap-3">
      <div class="flex-1 space-y-1">
        <label for="responseFormatSelect" class="block text-xs font-medium text-[var(--color-text-muted)] text-left">Formato</label>
        <select id="responseFormatSelect" class="w-full p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent transition-all duration-[var(--transition-fast)] cursor-pointer">${options}</select>
      </div>
      <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap cursor-pointer pb-2.5">
        <input id="timestampToggle" type="checkbox" class="accent-[var(--color-accent-500)] cursor-pointer" /> Por palabra
      </label>
    </div>`;
}

function renderRateLimits(): string {
  return `
    <div class="rounded-lg bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)] text-left">
      <div class="flex items-center justify-between">
        <span class="font-medium text-[var(--color-text-secondary)]">Límites (Free)</span>
        <a href="https://console.groq.com/settings/limits" target="_blank" class="text-[var(--color-accent-600)] hover:text-[var(--color-accent-700)] no-underline font-medium transition-colors duration-[var(--transition-fast)]">Ver &rarr;</a>
      </div>
      <div class="mt-1.5 flex gap-4 text-[10px]"><span>20 req/min</span><span>2,000 req/día</span><span>~8 hrs audio/día</span></div>
    </div>`;
}

function renderToolbarButton(id: string, iconSvg: string, ariaLabel: string): string {
  return `<button id="${id}" type="button" class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-all duration-[var(--transition-fast)] cursor-pointer" aria-label="${ariaLabel}">${iconSvg}</button>`;
}
