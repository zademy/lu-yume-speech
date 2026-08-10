/**
 * Application UI renderer.
 *
 * Builds the responsive product shell and its Inicio, Dictar, and Ajustes
 * views using the semantic design tokens from style.css.
 */

import { detectOS } from '../utils/os-detect';
import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  OPERATION_MODES,
  RECORD_MODES,
  RESPONSE_FORMATS,
  WHISPER_MODELS,
} from '../types';

function setTrustedHTML(el: HTMLElement, html: string): void {
  const range = document.createRange();
  const fragment = range.createContextualFragment(html);
  el.replaceChildren(fragment);
}

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

export interface AppElements {
  root: HTMLDivElement;
  navigation: HTMLElement;
  navBackdrop: HTMLButtonElement;
  mobileMenuButton: HTMLButtonElement;
  homeNavButton: HTMLButtonElement;
  dictationNavButton: HTMLButtonElement;
  settingsNavButton: HTMLButtonElement;
  pageTitle: HTMLHeadingElement;
  homeView: HTMLElement;
  dictationView: HTMLElement;
  settingsView: HTMLElement;
  historyList: HTMLDivElement;
  historyEmptyState: HTMLElement;
  historyClearButton: HTMLButtonElement;
  historyCount: HTMLSpanElement;
  wordsMetric: HTMLSpanElement;
  transcriptionsMetric: HTMLSpanElement;
  audioMinutesMetric: HTMLSpanElement;
  dictationKeyGate: HTMLElement;
  dictationKeyGateButton: HTMLButtonElement;
  dictationWorkspace: HTMLDivElement;
  apiKeyForm: HTMLFormElement;
  apiKeyInput: HTMLInputElement;
  apiKeyToggle: HTMLButtonElement;
  apiKeySaveButton: HTMLButtonElement;
  apiKeyDeleteButton: HTMLButtonElement;
  apiKeyError: HTMLParagraphElement;
  apiKeyStatus: HTMLSpanElement;
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
  const root = document.createElement('div');
  root.id = 'app-shell';
  root.className = 'app-shell';

  setTrustedHTML(
    root,
    `
      ${renderNavigation()}
      <button id="navBackdrop" type="button" class="nav-backdrop" aria-label="Cerrar navegación" tabindex="-1"></button>
      <div class="app-workspace">
        ${renderMobileHeader()}
        <main id="mainContent" class="app-content" tabindex="-1">
          ${renderHomeView()}
          ${renderDictationView(detectOS().modifierLabel)}
          ${renderSettingsView()}
        </main>
      </div>
      ${renderToastContainer()}
    `,
  );

  return {
    root,
    navigation: getRequiredElement(root, '#primaryNavigation', HTMLElement),
    navBackdrop: getRequiredElement(root, '#navBackdrop', HTMLButtonElement),
    mobileMenuButton: getRequiredElement(root, '#mobileMenuButton', HTMLButtonElement),
    homeNavButton: getRequiredElement(root, '#homeNavButton', HTMLButtonElement),
    dictationNavButton: getRequiredElement(root, '#dictationNavButton', HTMLButtonElement),
    settingsNavButton: getRequiredElement(root, '#settingsNavButton', HTMLButtonElement),
    pageTitle: getRequiredElement(root, '#mobilePageTitle', HTMLHeadingElement),
    homeView: getRequiredElement(root, '#homeView', HTMLElement),
    dictationView: getRequiredElement(root, '#dictationView', HTMLElement),
    settingsView: getRequiredElement(root, '#settingsView', HTMLElement),
    historyList: getRequiredElement(root, '#historyList', HTMLDivElement),
    historyEmptyState: getRequiredElement(root, '#historyEmptyState', HTMLElement),
    historyClearButton: getRequiredElement(root, '#historyClearButton', HTMLButtonElement),
    historyCount: getRequiredElement(root, '#historyCount', HTMLSpanElement),
    wordsMetric: getRequiredElement(root, '#wordsMetric', HTMLSpanElement),
    transcriptionsMetric: getRequiredElement(root, '#transcriptionsMetric', HTMLSpanElement),
    audioMinutesMetric: getRequiredElement(root, '#audioMinutesMetric', HTMLSpanElement),
    dictationKeyGate: getRequiredElement(root, '#dictationKeyGate', HTMLElement),
    dictationKeyGateButton: getRequiredElement(root, '#dictationKeyGateButton', HTMLButtonElement),
    dictationWorkspace: getRequiredElement(root, '#dictationWorkspace', HTMLDivElement),
    apiKeyForm: getRequiredElement(root, '#apiKeyForm', HTMLFormElement),
    apiKeyInput: getRequiredElement(root, '#apiKeyInput', HTMLInputElement),
    apiKeyToggle: getRequiredElement(root, '#apiKeyToggle', HTMLButtonElement),
    apiKeySaveButton: getRequiredElement(root, '#apiKeySaveButton', HTMLButtonElement),
    apiKeyDeleteButton: getRequiredElement(root, '#apiKeyDeleteButton', HTMLButtonElement),
    apiKeyError: getRequiredElement(root, '#apiKeyError', HTMLParagraphElement),
    apiKeyStatus: getRequiredElement(root, '#apiKeyStatus', HTMLSpanElement),
    modelSelect: getRequiredElement(root, '#modelSelect', HTMLSelectElement),
    operationModeSelect: getRequiredElement(root, '#operationModeSelect', HTMLSelectElement),
    recordModeSelect: getRequiredElement(root, '#recordModeSelect', HTMLSelectElement),
    noiseReductionSelect: getRequiredElement(root, '#noiseReductionSelect', HTMLSelectElement),
    languageSelect: getRequiredElement(root, '#languageSelect', HTMLSelectElement),
    promptInput: getRequiredElement(root, '#promptInput', HTMLTextAreaElement),
    temperatureSlider: getRequiredElement(root, '#temperatureSlider', HTMLInputElement),
    temperatureValue: getRequiredElement(root, '#temperatureValue', HTMLSpanElement),
    responseFormatSelect: getRequiredElement(root, '#responseFormatSelect', HTMLSelectElement),
    timestampToggle: getRequiredElement(root, '#timestampToggle', HTMLInputElement),
    statusDiv: getRequiredElement(root, '#status', HTMLDivElement),
    waveformCanvas: getRequiredElement(root, '#waveformCanvas', HTMLCanvasElement),
    waveformContainer: getRequiredElement(root, '#waveformContainer', HTMLDivElement),
    timerDisplay: getRequiredElement(root, '#timerDisplay', HTMLSpanElement),
    outputArea: getRequiredElement(root, '#output', HTMLTextAreaElement),
    wordCount: getRequiredElement(root, '#wordCount', HTMLSpanElement),
    metadataPanel: getRequiredElement(root, '#metadataPanel', HTMLDivElement),
    summaryBtn: getRequiredElement(root, '#summaryBtn', HTMLButtonElement),
    summarySection: getRequiredElement(root, '#summarySection', HTMLElement),
    summaryPanel: getRequiredElement(root, '#summaryPanel', HTMLDivElement),
    toastContainer: getRequiredElement(root, '#toastContainer', HTMLDivElement),
    themeToggle: getRequiredElement(root, '#themeToggle', HTMLButtonElement),
    copyAllBtn: getRequiredElement(root, '#copyAllBtn', HTMLButtonElement),
    clearBtn: getRequiredElement(root, '#clearBtn', HTMLButtonElement),
    downloadBtn: getRequiredElement(root, '#downloadBtn', HTMLButtonElement),
    customWordsInput: getRequiredElement(root, '#customWordsInput', HTMLTextAreaElement),
    wordCorrectionThresholdSlider: getRequiredElement(
      root,
      '#wordCorrectionThresholdSlider',
      HTMLInputElement,
    ),
    wordCorrectionThresholdValue: getRequiredElement(
      root,
      '#wordCorrectionThresholdValue',
      HTMLSpanElement,
    ),
    customFillerWordsInput: getRequiredElement(root, '#customFillerWordsInput', HTMLInputElement),
    silenceTrimToggle: getRequiredElement(root, '#silenceTrimToggle', HTMLInputElement),
    llmToggle: getRequiredElement(root, '#llmToggle', HTMLInputElement),
    llmModelInput: getRequiredElement(root, '#llmModelInput', HTMLInputElement),
    llmInstructionsInput: getRequiredElement(root, '#llmInstructionsInput', HTMLTextAreaElement),
  };
}

function renderNavigation(): string {
  return `
    <aside id="primaryNavigation" class="app-sidebar" aria-label="Navegación principal" data-open="false">
      <div class="flex items-center gap-3 px-3 py-2 mb-7">
        <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-control-emphasis)] text-[var(--color-text-inverse)]">${icons.mic}</span>
        <span class="min-w-0">
          <strong class="block text-sm tracking-tight text-[var(--color-text-primary)]">LU YUME</strong>
          <span class="block text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Espacio de voz</span>
        </span>
      </div>
      <nav class="flex flex-col gap-1" aria-label="Secciones">
        ${renderNavButton('homeNavButton', 'home', 'Inicio', icons.home, true)}
        ${renderNavButton('dictationNavButton', 'dictation', 'Dictar', icons.mic, false)}
      </nav>
      <div class="mt-auto border-t border-[var(--color-border-subtle)] pt-3">
        ${renderNavButton('settingsNavButton', 'settings', 'Ajustes', icons.settings, false)}
        <button id="themeToggle" type="button" class="nav-item mt-1" aria-label="Cambiar tema"></button>
      </div>
    </aside>`;
}

function renderNavButton(
  id: string,
  view: string,
  label: string,
  icon: string,
  active: boolean,
): string {
  return `<button id="${id}" type="button" class="nav-item${active ? ' is-active' : ''}" data-view="${view}" aria-current="${active ? 'page' : 'false'}">${icon}<span>${label}</span></button>`;
}

function renderMobileHeader(): string {
  return `
    <header class="mobile-header">
      <button id="mobileMenuButton" type="button" class="icon-button" aria-label="Abrir navegación" aria-controls="primaryNavigation" aria-expanded="false">${icons.menu}</button>
      <h1 id="mobilePageTitle" class="text-sm font-semibold tracking-tight">Inicio</h1>
      <span class="h-10 w-10" aria-hidden="true"></span>
    </header>`;
}

function renderHomeView(): string {
  return `
    <section id="homeView" class="view-panel" aria-labelledby="homeTitle">
      <div class="view-heading">
        <div>
          <p class="eyebrow">Espacio de trabajo</p>
          <h2 id="homeTitle">Inicio</h2>
          <p>Revisa tus transcripciones recientes y el uso acumulado en este dispositivo.</p>
        </div>
        <button type="button" class="primary-action" data-open-view="dictation">${icons.mic}<span>Nueva transcripción</span></button>
      </div>
      <div class="home-grid">
        <section class="history-panel" aria-labelledby="historyTitle">
          <header class="panel-heading">
            <div>
              <p class="eyebrow">Actividad reciente</p>
              <h3 id="historyTitle">Historial</h3>
            </div>
            <div class="flex items-center gap-2">
              <span id="historyCount" class="count-badge">0</span>
              <button id="historyClearButton" type="button" class="icon-button compact" aria-label="Limpiar historial" title="Limpiar historial">${icons.trash}</button>
            </div>
          </header>
          <div id="historyList" class="history-list" role="list">
            <div id="historyEmptyState" class="empty-state">
              <span class="empty-state-icon">${icons.document}</span>
              <h4>Todavía no hay transcripciones</h4>
              <p>Tu actividad aparecerá aquí después del primer dictado.</p>
              <button type="button" class="secondary-action" data-open-view="dictation">Empezar a dictar</button>
            </div>
          </div>
        </section>
        <aside class="stats-panel" aria-labelledby="statsTitle">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Últimas 100 entradas</p>
              <h3 id="statsTitle">Actividad reciente</h3>
            </div>
          </div>
          ${renderMetric('wordsMetric', 'Palabras', '0', 'Texto transcrito')}
          ${renderMetric('transcriptionsMetric', 'Transcripciones', '0', 'Registros conservados')}
          ${renderMetric('audioMinutesMetric', 'Minutos de audio', '0', 'Duración procesada')}
          <p class="stats-note">Las cifras se calculan localmente con el historial guardado en este navegador.</p>
        </aside>
      </div>
    </section>`;
}

function renderMetric(id: string, label: string, value: string, hint: string): string {
  return `
    <div class="metric-row">
      <div><span class="metric-label">${label}</span><span class="metric-hint">${hint}</span></div>
      <span id="${id}" class="metric-value">${value}</span>
    </div>`;
}

function renderDictationView(modifierLabel: string): string {
  return `
    <section id="dictationView" class="view-panel" aria-labelledby="dictationTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow">Captura de voz</p>
          <h2 id="dictationTitle">Dictar</h2>
          <p>Graba, transcribe y trabaja con el texto sin salir de tu espacio.</p>
        </div>
      </div>
      <section id="dictationKeyGate" class="credential-gate" aria-labelledby="credentialGateTitle">
        <span class="credential-gate-icon">${icons.key}</span>
        <div>
          <p class="eyebrow">Configuración requerida</p>
          <h3 id="credentialGateTitle">Conecta tu cuenta de Groq</h3>
          <p>Agrega una API key para habilitar la grabación y la transcripción.</p>
        </div>
        <button id="dictationKeyGateButton" type="button" class="primary-action">Configurar API key</button>
      </section>
      <div id="dictationWorkspace" class="dictation-workspace" hidden>
        ${renderStatusBar(modifierLabel)}
        ${renderVisualizerArea()}
        ${renderOutputSection()}
        ${renderDictationFooter()}
      </div>
    </section>`;
}

function renderSettingsView(): string {
  return `
    <section id="settingsView" class="view-panel" aria-labelledby="settingsTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow">Preferencias</p>
          <h2 id="settingsTitle">Ajustes</h2>
          <p>Administra tu acceso a Groq y la calidad de cada transcripción.</p>
        </div>
      </div>
      <div class="settings-stack">
        ${renderApiKeySection()}
        <section class="settings-card" aria-labelledby="transcriptionSettingsTitle">
          <div class="settings-card-heading">
            <span class="settings-icon">${icons.sliders}</span>
            <div><h3 id="transcriptionSettingsTitle">Transcripción</h3><p>Modelo, idioma, captura y formato de respuesta.</p></div>
          </div>
          <div class="settings-grid">
            ${renderSelectField(
              'modelSelect',
              'Modelo',
              WHISPER_MODELS.map((model) => ({
                value: model,
                label: model,
                selected: model === DEFAULT_SETTINGS.model,
              })),
            )}
            ${renderSelectField(
              'operationModeSelect',
              'Modo',
              OPERATION_MODES.map((mode) => ({
                value: mode.value,
                label: `${mode.label} - ${mode.description}`,
                selected: mode.value === DEFAULT_SETTINGS.operationMode,
              })),
            )}
            ${renderSelectField(
              'recordModeSelect',
              'Grabación',
              RECORD_MODES.map((mode) => ({
                value: mode.value,
                label: `${mode.label} - ${mode.description}`,
                selected: mode.value === DEFAULT_SETTINGS.recordMode,
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
              LANGUAGES.map((language) => ({
                value: language.code,
                label: language.label,
                selected: language.code === DEFAULT_SETTINGS.language,
              })),
            )}
            ${renderResponseFormatControl()}
            <div class="settings-grid-span">${renderTextareaField('promptInput', 'Contexto', 'Terminología técnica, nombres propios...', 2)}</div>
            <div class="settings-grid-span">${renderTemperatureControl()}</div>
          </div>
        </section>
        <section class="settings-card" aria-labelledby="qualitySettingsTitle">
          <div class="settings-card-heading">
            <span class="settings-icon">${icons.sparkle}</span>
            <div><h3 id="qualitySettingsTitle">Calidad</h3><p>Vocabulario, limpieza y refinado opcional.</p></div>
          </div>
          ${renderQualitySection()}
        </section>
        ${renderRateLimits()}
      </div>
    </section>`;
}

function renderApiKeySection(): string {
  return `
    <section class="settings-card" aria-labelledby="apiKeyTitle">
      <div class="settings-card-heading">
        <span class="settings-icon">${icons.key}</span>
        <div class="flex-1"><h3 id="apiKeyTitle">Conexión con Groq</h3><p>La credencial se guarda únicamente en este navegador.</p></div>
        <span id="apiKeyStatus" class="status-badge">Sin configurar</span>
      </div>
      <form id="apiKeyForm" novalidate>
        <label for="apiKeyInput" class="field-label">Groq API key</label>
        <div class="password-field">
          <input id="apiKeyInput" type="password" class="form-control font-mono" placeholder="gsk_..." autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="apiKeyHelp apiKeyError" />
          <button id="apiKeyToggle" type="button" class="password-toggle" aria-label="Mostrar API key" aria-pressed="false">${icons.eye}</button>
        </div>
        <p id="apiKeyHelp" class="field-help">Puedes crear una key gratuita en <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys</a>.</p>
        <p id="apiKeyError" class="field-error" aria-live="polite"></p>
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <button id="apiKeyDeleteButton" type="button" class="secondary-action">Eliminar key</button>
          <button id="apiKeySaveButton" type="submit" class="primary-action">Guardar key</button>
        </div>
      </form>
    </section>`;
}

function renderStatusBar(modifierLabel: string): string {
  return `
    <div id="status" class="mb-4 flex min-h-[2em] items-center justify-center gap-2 text-center text-[15px] font-medium text-[var(--color-text-secondary)]">
      <span>Presiona</span><kbd class="shortcut-key">${modifierLabel}</kbd><span class="text-[var(--color-text-muted)]">+</span><kbd class="shortcut-key">Space</kbd><span>para hablar</span>
    </div>`;
}

function renderVisualizerArea(): string {
  return `
    <div id="waveformContainer" class="waveform-container relative mb-4 min-h-40 overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-card)]">
      <canvas id="waveformCanvas" aria-hidden="true" class="block h-40 w-full"></canvas>
      <span id="timerDisplay" class="glass absolute right-3 top-2.5 rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">00:00</span>
      <span id="recIndicator" class="rec-indicator glass absolute left-3 top-2.5 flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 opacity-0"><span class="rec-dot h-2 w-2 rounded-full bg-[var(--color-text-primary)]"></span><span class="text-[10px] font-bold tracking-wider">REC</span></span>
    </div>`;
}

function renderOutputSection(): string {
  return `
    <div class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <span class="eyebrow"><span id="wordCount" class="font-semibold text-[var(--color-text-secondary)]">0</span> palabras</span>
        <div class="flex items-center gap-0.5">
          ${renderToolbarButton('copyAllBtn', icons.copy, 'Copiar todo')}
          ${renderToolbarButton('downloadBtn', icons.download, 'Descargar .txt')}
          ${renderToolbarButton('clearBtn', icons.trash, 'Limpiar')}
        </div>
      </div>
      <textarea id="output" class="output-area" placeholder="Tu texto aparecerá aquí..." spellcheck="true"></textarea>
      <div id="metadataPanel" class="hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]"></div>
      <div class="flex items-center justify-between gap-3 pt-2">
        <p class="text-[11px] leading-4 text-[var(--color-text-muted)]">Resume el texto visible sin cambiar la transcripción.</p>
        <button id="summaryBtn" type="button" disabled class="primary-action shrink-0">${icons.sparkle}<span>Generar resumen</span></button>
      </div>
      <section id="summarySection" hidden aria-labelledby="summaryTitle" class="pt-4">
        <div class="mb-3 px-1"><p class="eyebrow">Derivado del texto visible</p><h3 id="summaryTitle" class="text-base font-bold tracking-tight">Historial de resúmenes</h3></div>
        <div id="summaryPanel" hidden class="space-y-2" aria-live="polite"></div>
      </section>
    </div>`;
}

function renderDictationFooter(): string {
  return `<div class="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-4 text-[10.5px] text-[var(--color-text-muted)]"><span>Atajo: Alt / Ctrl + Space</span><span>Procesado por Groq Whisper</span></div>`;
}

function renderSelectField(
  id: string,
  label: string,
  options: Array<{ value: string; label: string; selected: boolean }>,
): string {
  const renderedOptions = options
    .map(
      (option) =>
        `<option value="${option.value}" ${option.selected ? 'selected' : ''}>${option.label}</option>`,
    )
    .join('');
  return `<div><label for="${id}" class="field-label">${label}</label><select id="${id}" class="form-control">${renderedOptions}</select></div>`;
}

function renderTextareaField(id: string, label: string, placeholder: string, rows: number): string {
  return `<div><label for="${id}" class="field-label">${label}</label><textarea id="${id}" rows="${rows}" class="form-control resize-none" placeholder="${placeholder}"></textarea></div>`;
}

function renderTextField(id: string, label: string, placeholder: string): string {
  return `<div><label for="${id}" class="field-label">${label}</label><input id="${id}" type="text" class="form-control" placeholder="${placeholder}" /></div>`;
}

function renderTemperatureControl(): string {
  return `<div><div class="flex items-center justify-between"><label for="temperatureSlider" class="field-label">Temperatura</label><span id="temperatureValue" class="range-value">${DEFAULT_SETTINGS.temperature}</span></div><input id="temperatureSlider" type="range" min="0" max="1" step="0.1" value="${DEFAULT_SETTINGS.temperature}" class="range-control" /></div>`;
}

function renderResponseFormatControl(): string {
  const options = RESPONSE_FORMATS.map(
    (format) =>
      `<option value="${format.value}" ${format.value === DEFAULT_SETTINGS.responseFormat ? 'selected' : ''}>${format.label}</option>`,
  ).join('');
  return `<div><label for="responseFormatSelect" class="field-label">Formato</label><select id="responseFormatSelect" class="form-control">${options}</select><label class="mt-2 flex min-h-10 items-center gap-2 text-xs text-[var(--color-text-muted)]"><input id="timestampToggle" type="checkbox" class="accent-[var(--color-control-emphasis)]" /> Timestamps por palabra</label></div>`;
}

function renderQualitySection(): string {
  return `
    <div class="settings-grid">
      <div class="settings-grid-span">${renderTextareaField('customWordsInput', 'Vocabulario personalizado', 'Nombres propios, jerga y siglas...', 2)}</div>
      <div class="settings-grid-span">${renderRangeField('wordCorrectionThresholdSlider', 'wordCorrectionThresholdValue', 'Tolerancia de corrección', String(DEFAULT_SETTINGS.wordCorrectionThreshold), '0.1', '1', '0.05')}</div>
      <div class="settings-grid-span">${renderTextField('customFillerWordsInput', 'Muletillas personalizadas', 'Vacío = predeterminadas por idioma')}</div>
      ${renderToggleField('silenceTrimToggle', 'Recortar silencios', 'Elimina silencios iniciales y finales.', DEFAULT_SETTINGS.enableSilenceTrim)}
      ${renderToggleField('llmToggle', 'Refinado con LLM', 'Pule puntuación, mayúsculas y errores.', DEFAULT_SETTINGS.enableLlmPostProcess)}
      ${renderTextField('llmModelInput', 'Modelo LLM', DEFAULT_SETTINGS.llmModel)}
      ${renderTextareaField('llmInstructionsInput', 'Instrucciones LLM', 'Ej: tono formal, dominio médico...', 2)}
    </div>`;
}

function renderRangeField(
  id: string,
  valueId: string,
  label: string,
  value: string,
  min: string,
  max: string,
  step: string,
): string {
  return `<div><div class="flex items-center justify-between"><label for="${id}" class="field-label">${label}</label><span id="${valueId}" class="range-value">${value}</span></div><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" class="range-control" /></div>`;
}

function renderToggleField(id: string, label: string, hint: string, checked: boolean): string {
  return `<label for="${id}" class="toggle-field"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} class="mt-1 accent-[var(--color-control-emphasis)]" /><span><strong>${label}</strong><small>${hint}</small></span></label>`;
}

function renderRateLimits(): string {
  return `<section class="settings-card compact-card" aria-labelledby="limitsTitle"><div><p class="eyebrow">Referencia</p><h3 id="limitsTitle">Límites del plan gratuito</h3></div><div class="limits-grid"><span>20 req/min</span><span>2,000 req/día</span><span>~8 hrs/día</span></div><a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener noreferrer" class="text-sm font-semibold">Consultar límites ${icons.arrowUpRight}</a></section>`;
}

function renderToolbarButton(id: string, icon: string, label: string): string {
  return `<button id="${id}" type="button" class="icon-button compact" aria-label="${label}" title="${label}">${icon}</button>`;
}

function renderToastContainer(): string {
  return `<div id="toastContainer" class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"></div>`;
}

const icons = {
  home: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  mic: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="6" height="11" x="9" y="2" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  menu: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  settings:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  key: '<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15 8l3 3M18 5l3 3"/></svg>',
  eye: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.1 12a10.5 10.5 0 0 1 19.8 0 10.5 10.5 0 0 1-19.8 0"/><circle cx="12" cy="12" r="3"/></svg>',
  sliders:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></svg>',
  document:
    '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h5"/></svg>',
  copy: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  trash:
    '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  download:
    '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  sparkle:
    '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 15.5A2 2 0 0 0 8.5 14l-6.1-1.5a.5.5 0 0 1 0-1L8.5 10A2 2 0 0 0 10 8.5l1.5-6.1a.5.5 0 0 1 1 0L14 8.5a2 2 0 0 0 1.5 1.5l6.1 1.5a.5.5 0 0 1 0 1L15.5 14a2 2 0 0 0-1.5 1.5l-1.5 6.1a.5.5 0 0 1-1 0z"/></svg>',
  arrowUpRight:
    '<svg aria-hidden="true" class="inline" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17 17 7M7 7h10v10"/></svg>',
};
