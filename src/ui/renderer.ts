/**
 * Application UI renderer.
 *
 * Builds the responsive product shell and its Home, Dictate, Metrics and
 * Settings views using the semantic design tokens from style.css. Visible
 * strings carry `data-i18n` (and `-placeholder` / `-aria-label` / `-title`)
 * attributes; `i18n/translations.translateTree` fills them in place so a
 * language change never rebuilds the DOM.
 */

import { detectOS } from '../utils/os-detect';
import {
  APP_LANGUAGES,
  DEFAULT_SETTINGS,
  LANGUAGES,
  OPERATION_MODES,
  RECORD_MODES,
  RESPONSE_FORMATS,
  TRANSCRIPTION_PROVIDERS,
  WHISPER_MODELS,
} from '../types';
import { TRANSCRIPTION_METHODS } from '../utils/transcription-method';
import { LOCAL_MODEL_CATALOG, formatDownloadSize } from '../utils/local-model-catalog';

/**
 * Replaces the children of {@link el} with nodes parsed from {@link html}.
 *
 * Uses `Range.createContextualFragment` so the template string is treated as
 * markup (not text), matching `Element.innerHTML` semantics without the
 * reflow churn of assigning `innerHTML` directly on the host element.
 */
function setTrustedHTML(el: HTMLElement, html: string): void {
  const range = document.createRange();
  const fragment = range.createContextualFragment(html);
  el.replaceChildren(fragment);
}

/**
 * Looks up an element by {@link selector} and asserts it is of the expected
 * {@link elementType}.
 *
 * Throws synchronously if the selector misses or matches the wrong tag, so a
 * broken template surfaces at boot rather than as a `null` runtime error in
 * an unrelated module.
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

/**
 * Strongly-typed handles to every interactive element in the product shell.
 *
 * `main.ts` consumes this map to wire EventBus listeners and platform
 * adapters; the narrow element types (e.g. `HTMLSelectElement` vs.
 * `HTMLInputElement`) are what let those bindings compile under strict mode
 * without runtime casts.
 */
export interface AppElements {
  root: HTMLDivElement;
  navigation: HTMLElement;
  navBackdrop: HTMLButtonElement;
  appWorkspace: HTMLDivElement;
  mobileMenuButton: HTMLButtonElement;
  homeNavButton: HTMLButtonElement;
  dictationNavButton: HTMLButtonElement;
  metricsNavButton: HTMLButtonElement;
  plumaNavButton: HTMLButtonElement;
  settingsNavButton: HTMLButtonElement;
  aboutNavButton: HTMLButtonElement;
  pageTitle: HTMLHeadingElement;
  homeView: HTMLElement;
  dictationView: HTMLElement;
  metricsView: HTMLElement;
  plumaView: HTMLElement;
  settingsView: HTMLElement;
  aboutView: HTMLElement;
  historyList: HTMLDivElement;
  historyEmptyState: HTMLElement;
  historyClearButton: HTMLButtonElement;
  historyCount: HTMLSpanElement;
  wordsMetric: HTMLSpanElement;
  transcriptionsMetric: HTMLSpanElement;
  audioMinutesMetric: HTMLSpanElement;
  dictationKeyGate: HTMLElement;
  dictationKeyGateButton: HTMLButtonElement;
  dictationLocalGate: HTMLElement;
  dictationLocalGateButton: HTMLButtonElement;
  dictationWorkspace: HTMLDivElement;
  appLanguageSelect: HTMLSelectElement;
  apiKeyForm: HTMLFormElement;
  apiKeyInput: HTMLInputElement;
  apiKeyToggle: HTMLButtonElement;
  apiKeySaveButton: HTMLButtonElement;
  apiKeyDeleteButton: HTMLButtonElement;
  apiKeyError: HTMLParagraphElement;
  apiKeyStatus: HTMLSpanElement;
  methodSelect: HTMLSelectElement;
  providerSelect: HTMLSelectElement;
  localModelSelect: HTMLSelectElement;
  localModelsDevice: HTMLParagraphElement;
  localModelsMobileNote: HTMLParagraphElement;
  localBackendSelect: HTMLSelectElement;
  localIdleMinutes: HTMLInputElement;
  localReleaseBtn: HTMLButtonElement;
  localResidentLine: HTMLParagraphElement;
  workerTokenForm: HTMLFormElement;
  workerTokenInput: HTMLInputElement;
  workerTokenToggle: HTMLButtonElement;
  workerTokenSaveButton: HTMLButtonElement;
  workerTokenDeleteButton: HTMLButtonElement;
  workerTokenError: HTMLParagraphElement;
  workerTokenStatus: HTMLSpanElement;
  workerBaseUrlInput: HTMLInputElement;
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
  localLlmAuth: HTMLInputElement;
  localLlmAuthRow: HTMLElement;
  localRecovery: HTMLElement;
  localRecoveryDismiss: HTMLButtonElement;
  localRecoveryMessage: HTMLElement;
  localRecoveryActions: HTMLElement;
  localRecoveryDetail: HTMLElement;
  localRecoveryCopy: HTMLButtonElement;
  gateOverlay: HTMLDivElement;
  gateLockedForm: HTMLFormElement;
  gateLockedInput: HTMLInputElement;
  gateLockedError: HTMLParagraphElement;
  gateSetupForm: HTMLFormElement;
  gateSetupInput: HTMLInputElement;
  gateSetupConfirmInput: HTMLInputElement;
  gateSetupError: HTMLParagraphElement;
  gatePhraseForm: HTMLFormElement;
  gatePhraseCurrentInput: HTMLInputElement;
  gatePhraseNewInput: HTMLInputElement;
  gatePhraseConfirmInput: HTMLInputElement;
  gatePhraseError: HTMLParagraphElement;
}

/**
 * Builds the entire application DOM in one pass and returns typed handles.
 *
 * The shell is assembled from the `render*` helpers below (each returns an
 * HTML fragment string), injected through `setTrustedHTML`, and then resolved
 * to concrete elements via `getRequiredElement`. Keeping this synchronous and
 * single-shot means the rest of the app can assume the DOM exists by the time
 * `main.ts` runs.
 */
export function renderApp(): AppElements {
  const root = document.createElement('div');
  root.id = 'app-shell';
  root.className = 'app-shell';

  setTrustedHTML(
    root,
    `
      ${renderNavigation()}
      <button id="navBackdrop" type="button" class="nav-backdrop" data-i18n-aria-label="nav.close.aria" tabindex="-1" inert></button>
      <div id="appWorkspace" class="app-workspace" inert>
        ${renderMobileHeader()}
        <main id="mainContent" class="app-content" tabindex="-1">
          ${renderHomeView()}
          ${renderDictationView(detectOS().modifierLabel)}
          ${renderMetricsView()}
          ${renderPlumaView()}
          ${renderSettingsView()}
          ${renderAboutView(icons.github, icons.arrowUpRight)}
        </main>
      </div>
      ${renderToastContainer()}
      ${renderGateOverlay()}
    `,
  );

  return {
    root,
    navigation: getRequiredElement(root, '#primaryNavigation', HTMLElement),
    navBackdrop: getRequiredElement(root, '#navBackdrop', HTMLButtonElement),
    appWorkspace: getRequiredElement(root, '#appWorkspace', HTMLDivElement),
    mobileMenuButton: getRequiredElement(root, '#mobileMenuButton', HTMLButtonElement),
    homeNavButton: getRequiredElement(root, '#homeNavButton', HTMLButtonElement),
    dictationNavButton: getRequiredElement(root, '#dictationNavButton', HTMLButtonElement),
    metricsNavButton: getRequiredElement(root, '#metricsNavButton', HTMLButtonElement),
    plumaNavButton: getRequiredElement(root, '#plumaNavButton', HTMLButtonElement),
    settingsNavButton: getRequiredElement(root, '#settingsNavButton', HTMLButtonElement),
    aboutNavButton: getRequiredElement(root, '#aboutNavButton', HTMLButtonElement),
    pageTitle: getRequiredElement(root, '#mobilePageTitle', HTMLHeadingElement),
    homeView: getRequiredElement(root, '#homeView', HTMLElement),
    dictationView: getRequiredElement(root, '#dictationView', HTMLElement),
    metricsView: getRequiredElement(root, '#metricsView', HTMLElement),
    plumaView: getRequiredElement(root, '#plumaView', HTMLElement),
    settingsView: getRequiredElement(root, '#settingsView', HTMLElement),
    aboutView: getRequiredElement(root, '#aboutView', HTMLElement),
    historyList: getRequiredElement(root, '#historyList', HTMLDivElement),
    historyEmptyState: getRequiredElement(root, '#historyEmptyState', HTMLElement),
    historyClearButton: getRequiredElement(root, '#historyClearButton', HTMLButtonElement),
    historyCount: getRequiredElement(root, '#historyCount', HTMLSpanElement),
    wordsMetric: getRequiredElement(root, '#wordsMetric', HTMLSpanElement),
    transcriptionsMetric: getRequiredElement(root, '#transcriptionsMetric', HTMLSpanElement),
    audioMinutesMetric: getRequiredElement(root, '#audioMinutesMetric', HTMLSpanElement),
    dictationKeyGate: getRequiredElement(root, '#dictationKeyGate', HTMLElement),
    dictationKeyGateButton: getRequiredElement(root, '#dictationKeyGateButton', HTMLButtonElement),
    dictationLocalGate: getRequiredElement(root, '#dictationLocalGate', HTMLElement),
    dictationLocalGateButton: getRequiredElement(
      root,
      '#dictationLocalGateButton',
      HTMLButtonElement,
    ),
    dictationWorkspace: getRequiredElement(root, '#dictationWorkspace', HTMLDivElement),
    appLanguageSelect: getRequiredElement(root, '#appLanguageSelect', HTMLSelectElement),
    apiKeyForm: getRequiredElement(root, '#apiKeyForm', HTMLFormElement),
    apiKeyInput: getRequiredElement(root, '#apiKeyInput', HTMLInputElement),
    apiKeyToggle: getRequiredElement(root, '#apiKeyToggle', HTMLButtonElement),
    apiKeySaveButton: getRequiredElement(root, '#apiKeySaveButton', HTMLButtonElement),
    apiKeyDeleteButton: getRequiredElement(root, '#apiKeyDeleteButton', HTMLButtonElement),
    apiKeyError: getRequiredElement(root, '#apiKeyError', HTMLParagraphElement),
    apiKeyStatus: getRequiredElement(root, '#apiKeyStatus', HTMLSpanElement),
    methodSelect: getRequiredElement(root, '#methodSelect', HTMLSelectElement),
    providerSelect: getRequiredElement(root, '#providerSelect', HTMLSelectElement),
    localModelSelect: getRequiredElement(root, '#localModelSelect', HTMLSelectElement),
    localModelsDevice: getRequiredElement(root, '#localModelsDevice', HTMLParagraphElement),
    localModelsMobileNote: getRequiredElement(root, '#localModelsMobileNote', HTMLParagraphElement),
    localBackendSelect: getRequiredElement(root, '#localBackendSelect', HTMLSelectElement),
    localIdleMinutes: getRequiredElement(root, '#localIdleMinutes', HTMLInputElement),
    localReleaseBtn: getRequiredElement(root, '#localReleaseBtn', HTMLButtonElement),
    localResidentLine: getRequiredElement(root, '#localResidentLine', HTMLParagraphElement),
    workerTokenForm: getRequiredElement(root, '#workerTokenForm', HTMLFormElement),
    workerTokenInput: getRequiredElement(root, '#workerTokenInput', HTMLInputElement),
    workerTokenToggle: getRequiredElement(root, '#workerTokenToggle', HTMLButtonElement),
    workerTokenSaveButton: getRequiredElement(root, '#workerTokenSaveButton', HTMLButtonElement),
    workerTokenDeleteButton: getRequiredElement(
      root,
      '#workerTokenDeleteButton',
      HTMLButtonElement,
    ),
    workerTokenError: getRequiredElement(root, '#workerTokenError', HTMLParagraphElement),
    workerTokenStatus: getRequiredElement(root, '#workerTokenStatus', HTMLSpanElement),
    workerBaseUrlInput: getRequiredElement(root, '#workerBaseUrlInput', HTMLInputElement),
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
    localLlmAuth: getRequiredElement(root, '#localLlmAuth', HTMLInputElement),
    localLlmAuthRow: getRequiredElement(root, '#localLlmAuthRow', HTMLElement),
    localRecovery: getRequiredElement(root, '#localRecovery', HTMLElement),
    localRecoveryDismiss: getRequiredElement(root, '#localRecoveryDismiss', HTMLButtonElement),
    localRecoveryMessage: getRequiredElement(root, '#localRecoveryMessage', HTMLElement),
    localRecoveryActions: getRequiredElement(root, '#localRecoveryActions', HTMLElement),
    localRecoveryDetail: getRequiredElement(root, '#localRecoveryDetail', HTMLElement),
    localRecoveryCopy: getRequiredElement(root, '#localRecoveryCopy', HTMLButtonElement),
    gateOverlay: getRequiredElement(root, '#gateOverlay', HTMLDivElement),
    gateLockedForm: getRequiredElement(root, '#gateLockedForm', HTMLFormElement),
    gateLockedInput: getRequiredElement(root, '#gateLockedInput', HTMLInputElement),
    gateLockedError: getRequiredElement(root, '#gateLockedError', HTMLParagraphElement),
    gateSetupForm: getRequiredElement(root, '#gateSetupForm', HTMLFormElement),
    gateSetupInput: getRequiredElement(root, '#gateSetupInput', HTMLInputElement),
    gateSetupConfirmInput: getRequiredElement(root, '#gateSetupConfirmInput', HTMLInputElement),
    gateSetupError: getRequiredElement(root, '#gateSetupError', HTMLParagraphElement),
    gatePhraseForm: getRequiredElement(root, '#gatePhraseForm', HTMLFormElement),
    gatePhraseCurrentInput: getRequiredElement(root, '#gatePhraseCurrentInput', HTMLInputElement),
    gatePhraseNewInput: getRequiredElement(root, '#gatePhraseNewInput', HTMLInputElement),
    gatePhraseConfirmInput: getRequiredElement(root, '#gatePhraseConfirmInput', HTMLInputElement),
    gatePhraseError: getRequiredElement(root, '#gatePhraseError', HTMLParagraphElement),
  };
}

// ---------------------------------------------------------------------------
// Navigation & mobile shell
// ---------------------------------------------------------------------------

/** Desktop sidebar + footer nav (Settings / About pinned at the bottom). */
function renderNavigation(): string {
  return `
    <aside id="primaryNavigation" class="app-sidebar" aria-label="Navegación principal" data-open="false" inert>
      <div class="flex items-center gap-3 px-3 py-2 mb-7">
        <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-control-emphasis)] text-[var(--color-text-inverse)]">${icons.mic}</span>
        <span class="min-w-0">
          <strong class="block text-sm tracking-tight text-[var(--color-text-primary)]">LU YUME</strong>
          <span class="block text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)]" data-i18n="brand.subtitle">Espacio de voz</span>
        </span>
        <button id="themeToggle" type="button" class="icon-button ml-auto shrink-0" data-i18n-aria-label="nav.theme.aria"></button>
      </div>
      <nav class="flex flex-col gap-1" aria-label="Secciones">
        ${renderNavButton('homeNavButton', 'home', 'nav.home', icons.home, true)}
        ${renderNavButton('dictationNavButton', 'dictation', 'nav.dictation', icons.mic, false)}
        ${renderNavButton('metricsNavButton', 'metrics', 'nav.metrics', icons.chart, false)}
        ${renderNavButton('plumaNavButton', 'pluma', 'nav.pluma', icons.feather, false)}
      </nav>
      <div class="mt-auto border-t border-[var(--color-border-subtle)] pt-3 flex flex-col gap-1">
        ${renderNavButton('settingsNavButton', 'settings', 'nav.settings', icons.settings, false)}
        ${renderNavButton('aboutNavButton', 'about', 'nav.about', icons.info, false)}
      </div>
    </aside>`;
}

/** Single nav entry: icon + i18n label, with `is-active` styling when active. */
function renderNavButton(
  id: string,
  view: string,
  i18nKey: string,
  icon: string,
  active: boolean,
): string {
  return `<button id="${id}" type="button" class="nav-item${active ? ' is-active' : ''}" data-view="${view}" aria-current="${active ? 'page' : 'false'}">${icon}<span data-i18n="${i18nKey}"></span></button>`;
}

/** Sticky top header shown only on mobile — hamburger, page title, spacer. */
function renderMobileHeader(): string {
  return `
    <header class="mobile-header">
      <button id="mobileMenuButton" type="button" class="icon-button" data-i18n-aria-label="nav.menu.aria" aria-controls="primaryNavigation" aria-expanded="false">${icons.menu}</button>
      <h1 id="mobilePageTitle" class="text-sm font-semibold tracking-tight" data-i18n="home.title">Home</h1>
      <span class="h-10 w-10" aria-hidden="true"></span>
    </header>`;
}

// ---------------------------------------------------------------------------
// Top-level views (one per sidebar entry)
// ---------------------------------------------------------------------------

/** Home view: history list on the left, accumulated stats aside. */
function renderHomeView(): string {
  return `
    <section id="homeView" class="view-panel" aria-labelledby="homeTitle">
      <div class="view-heading">
        <div>
          <p class="eyebrow" data-i18n="home.eyebrow">Workspace</p>
          <h2 id="homeTitle" data-i18n="home.title">Home</h2>
          <p data-i18n="home.description"></p>
        </div>
        <button type="button" class="primary-action" data-open-view="dictation">${icons.mic}<span data-i18n="home.newTranscription"></span></button>
      </div>
      <div class="home-grid">
        <section class="history-panel" aria-labelledby="historyTitle">
          <header class="panel-heading">
            <div>
              <p class="eyebrow" data-i18n="history.eyebrow">Recent activity</p>
              <h3 id="historyTitle" data-i18n="history.title">History</h3>
            </div>
            <div class="flex items-center gap-2">
              <span id="historyCount" class="count-badge">0</span>
              <button id="historyClearButton" type="button" class="icon-button compact" data-i18n-aria-label="history.clear.aria" data-i18n-title="history.clear.aria">${icons.trash}</button>
            </div>
          </header>
          <div id="historyList" class="history-list" role="list">
            <div id="historyEmptyState" class="empty-state">
              <span class="empty-state-icon">${icons.document}</span>
              <h4 data-i18n="history.empty.title"></h4>
              <p data-i18n="history.empty.body"></p>
              <button type="button" class="secondary-action" data-open-view="dictation"><span data-i18n="history.empty.cta"></span></button>
            </div>
          </div>
        </section>
        <aside class="stats-panel" aria-labelledby="statsTitle">
          <div class="panel-heading">
            <div>
              <p class="eyebrow" data-i18n="stats.eyebrow">Accumulated activity</p>
              <h3 id="statsTitle" data-i18n="stats.title">Recent activity</h3>
            </div>
          </div>
          ${renderMetric('wordsMetric', 'stats.words', 'stats.wordsHint', '0')}
          ${renderMetric('transcriptionsMetric', 'stats.transcriptions', 'stats.transcriptionsHint', '0')}
          ${renderMetric('audioMinutesMetric', 'stats.audioMinutes', 'stats.audioMinutesHint', '0')}
          <p class="stats-note" data-i18n="stats.note"></p>
        </aside>
      </div>
    </section>`;
}

/** Stat row: localized label + hint + numeric value badge. */
function renderMetric(id: string, labelKey: string, hintKey: string, value: string): string {
  return `
    <div class="metric-row">
      <div><span class="metric-label" data-i18n="${labelKey}"></span><span class="metric-hint" data-i18n="${hintKey}"></span></div>
      <span id="${id}" class="metric-value">${value}</span>
    </div>`;
}

/**
 * Dictate view: credential gate + workspace (status bar, visualizer, output).
 *
 * `modifierLabel` is the OS-aware shortcut token (`⌘` on macOS, `Ctrl` elsewhere)
 * surfaced in the status hint. The workspace stays `hidden` until a Groq key
 * is configured (see the `dictationKeyGate` section).
 */
function renderDictationView(modifierLabel: string): string {
  return `
    <section id="dictationView" class="view-panel" aria-labelledby="dictationTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow" data-i18n="dictation.eyebrow">Voice capture</p>
          <h2 id="dictationTitle" data-i18n="dictation.title">Dictate</h2>
          <p data-i18n="dictation.description"></p>
        </div>
      </div>
      <section id="dictationKeyGate" class="credential-gate" aria-labelledby="credentialGateTitle">
        <span class="credential-gate-icon">${icons.key}</span>
        <div>
          <p class="eyebrow" data-i18n="dictation.gate.eyebrow">Setup required</p>
          <h3 id="credentialGateTitle" data-i18n="dictation.gate.title">Connect your Groq account</h3>
          <p data-i18n="dictation.gate.body"></p>
        </div>
        <button id="dictationKeyGateButton" type="button" class="primary-action"><span data-i18n="dictation.gate.cta"></span></button>
      </section>
      <section id="dictationLocalGate" class="credential-gate" aria-labelledby="localGateTitle" hidden>
        <span class="credential-gate-icon">${icons.sliders}</span>
        <div>
          <p class="eyebrow" data-i18n="dictation.localGate.eyebrow">Local model required</p>
          <h3 id="localGateTitle" data-i18n="dictation.localGate.title">Download a local model</h3>
          <p data-i18n="dictation.localGate.body"></p>
        </div>
        <button id="dictationLocalGateButton" type="button" class="primary-action"><span data-i18n="dictation.localGate.cta"></span></button>
      </section>
      <div id="dictationWorkspace" class="dictation-workspace" hidden>
        ${renderStatusBar(modifierLabel)}
        ${renderVisualizerArea()}
        ${renderOutputSection()}
        ${renderDictationFooter()}
      </div>
    </section>`;
}

/** Metrics view shell. Charts are mounted into `#metricsView` at runtime. */
function renderMetricsView(): string {
  return `
    <section id="metricsView" class="view-panel" aria-labelledby="metricsTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow" data-i18n="metrics.eyebrow">Performance</p>
          <h2 id="metricsTitle" data-i18n="metrics.title">Metrics</h2>
          <p data-i18n="metrics.description"></p>
        </div>
      </div>
    </section>`;
}

/** Pluma view shell — document list + editor are mounted at runtime. */
function renderPlumaView(): string {
  return `
    <section id="plumaView" class="view-panel" aria-labelledby="plumaTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow" data-i18n="pluma.eyebrow">Writer</p>
          <h2 id="plumaTitle" data-i18n="pluma.title">Pluma</h2>
          <p data-i18n="pluma.description"></p>
        </div>
        <button id="plumaNewButton" type="button" class="primary-action"><span data-i18n="pluma.new"></span></button>
      </div>
      <div id="plumaWorkspace" class="pluma-workspace"></div>
    </section>`;
}

/**
 * Settings view: stack of cards — Interface language, API key, Transcription,
 * Quality, Rate limits. The cards are independent sections; each renders its
 * own field primitives below.
 */
function renderSettingsView(): string {
  return `
    <section id="settingsView" class="view-panel" aria-labelledby="settingsTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow" data-i18n="settings.eyebrow">Preferences</p>
          <h2 id="settingsTitle" data-i18n="settings.title">Settings</h2>
          <p data-i18n="settings.description"></p>
        </div>
      </div>
      <div class="settings-stack">
        ${renderInterfaceSection()}
        ${renderApiKeySection()}
        ${renderWorkerTokenSection()}
        ${renderGateSection()}
        <section class="settings-card" aria-labelledby="transcriptionSettingsTitle">
          <div class="settings-card-heading">
            <span class="settings-icon">${icons.sliders}</span>
            <div><h3 id="transcriptionSettingsTitle" data-i18n="settings.transcription.title">Transcription</h3><p data-i18n="settings.transcription.description"></p></div>
          </div>
          <div class="settings-grid">
            ${renderMethodField()}
            ${renderSelectField(
              'providerSelect',
              'field.provider',
              TRANSCRIPTION_PROVIDERS.map((provider) => ({
                value: provider.value,
                label: provider.label,
                selected: provider.value === DEFAULT_SETTINGS.transcriptionProvider,
              })),
            )}
            ${renderLocalModelField()}
            ${renderSelectField(
              'modelSelect',
              'field.model',
              WHISPER_MODELS.map((model) => ({
                value: model,
                label: model,
                selected: model === DEFAULT_SETTINGS.model,
              })),
            )}
            ${renderSelectField(
              'operationModeSelect',
              'field.mode',
              OPERATION_MODES.map((mode) => ({
                value: mode.value,
                label: `${mode.label} - ${mode.description}`,
                selected: mode.value === DEFAULT_SETTINGS.operationMode,
              })),
            )}
            ${renderSelectField(
              'recordModeSelect',
              'field.recordMode',
              RECORD_MODES.map((mode) => ({
                value: mode.value,
                label: `${mode.label} - ${mode.description}`,
                selected: mode.value === DEFAULT_SETTINGS.recordMode,
              })),
            )}
            ${renderNoiseReductionField()}
            ${renderSelectField(
              'languageSelect',
              'field.language',
              LANGUAGES.map((language) => ({
                value: language.code,
                label: language.label,
                selected: language.code === DEFAULT_SETTINGS.language,
              })),
            )}
            ${renderResponseFormatControl()}
            <div class="settings-grid-span">${renderTextareaField('promptInput', 'field.context', 'field.context.placeholder', 2)}</div>
            <div class="settings-grid-span">${renderTemperatureControl()}</div>
          </div>
        </section>
        <section class="settings-card" aria-labelledby="localModelsTitle">
          <div class="settings-card-heading">
            <span class="settings-icon">${icons.sliders}</span>
            <div><h3 id="localModelsTitle" data-i18n="settings.localModels.title">Local models</h3><p data-i18n="settings.localModels.description"></p></div>
          </div>
          <p id="localModelsDevice" class="text-[11px] text-[var(--color-text-muted)]" aria-live="polite">&nbsp;</p>
          <p id="localModelsMobileNote" class="mt-1 hidden text-[11px] font-semibold" data-i18n="localModels.mobileNote"></p>
          <div class="mt-2 flex flex-wrap items-end gap-3 text-[11px]">
            <div>
              <label for="localBackendSelect" class="field-label" data-i18n="localModels.backendMode"></label>
              <select id="localBackendSelect" class="form-control">
                <option value="auto" data-i18n="localModels.backend.auto"></option>
                <option value="wasm" data-i18n="localModels.backend.wasm"></option>
              </select>
            </div>
            <div>
              <label for="localIdleMinutes" class="field-label" data-i18n="localModels.idleRelease"></label>
              <input id="localIdleMinutes" type="number" min="0" step="5" class="form-control w-24" aria-describedby="localIdleHelp" />
              <p id="localIdleHelp" class="mt-1 text-[10.5px] text-[var(--color-text-muted)]" data-i18n="localModels.idleRelease.hint"></p>
            </div>
            <button type="button" id="localReleaseBtn" class="secondary-action hidden" data-i18n="localModels.release"></button>
          </div>
          <p id="localResidentLine" class="mt-2 text-[11px] text-[var(--color-text-muted)]" aria-live="polite" data-i18n="localModels.resident.none"></p>
          <ul id="localModelsList" class="mt-2 flex flex-col gap-3">
            ${LOCAL_MODEL_CATALOG.map((entry) => renderLocalModelCard(entry)).join('')}
          </ul>
        </section>
        <section class="settings-card" aria-labelledby="qualitySettingsTitle">
          <div class="settings-card-heading">
            <span class="settings-icon">${icons.sparkle}</span>
            <div><h3 id="qualitySettingsTitle" data-i18n="settings.quality.title">Quality</h3><p data-i18n="settings.quality.description"></p></div>
          </div>
          ${renderQualitySection()}
        </section>
        ${renderRateLimits()}
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Settings cards
// ---------------------------------------------------------------------------

/** Interface-language selector (English default, Spanish available). */
function renderInterfaceSection(): string {
  return `
    <section class="settings-card" aria-labelledby="interfaceSettingsTitle">
      <div class="settings-card-heading">
        <span class="settings-icon">${icons.globe}</span>
        <div><h3 id="interfaceSettingsTitle" data-i18n="settings.appLanguage">App language</h3><p data-i18n="settings.appLanguageHint"></p></div>
      </div>
      <div class="settings-grid">
        ${renderSelectField(
          'appLanguageSelect',
          'field.appLanguage',
          APP_LANGUAGES.map((lang) => ({
            value: lang.value,
            label: lang.label,
            selected: lang.value === DEFAULT_SETTINGS.appLanguage,
          })),
        )}
      </div>
    </section>`;
}

/** API-key form: password input with show/hide toggle, save, and delete. */
function renderApiKeySection(): string {
  return `
    <section class="settings-card" aria-labelledby="apiKeyTitle">
      <div class="settings-card-heading">
        <span class="settings-icon">${icons.key}</span>
        <div class="flex-1"><h3 id="apiKeyTitle" data-i18n="settings.api.title">Groq connection</h3><p data-i18n="settings.api.subtitle"></p></div>
        <span id="apiKeyStatus" class="status-badge" data-i18n="settings.api.statusUnset">Not set</span>
      </div>
      <form id="apiKeyForm" novalidate>
        <label for="apiKeyInput" class="field-label" data-i18n="settings.api.label">Groq API key</label>
        <div class="password-field">
          <input id="apiKeyInput" type="password" class="form-control font-mono" data-i18n-placeholder="settings.api.placeholder" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="apiKeyHelp apiKeyError" />
          <button id="apiKeyToggle" type="button" class="password-toggle" data-i18n-aria-label="settings.api.toggleAria" aria-pressed="false">${icons.eye}</button>
        </div>
        <p id="apiKeyHelp" class="field-help" data-i18n="settings.api.help"></p>
        <p id="apiKeyError" class="field-error" aria-live="polite"></p>
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <button id="apiKeyDeleteButton" type="button" class="secondary-action"><span data-i18n="settings.api.delete"></span></button>
          <button id="apiKeySaveButton" type="submit" class="primary-action"><span data-i18n="settings.api.save"></span></button>
        </div>
      </form>
    </section>`;
}

/**
 * Worker-token form (Cloudflare Whisper): password input with show/hide
 * toggle, save, delete, and a configurable base URL.
 */
function renderWorkerTokenSection(): string {
  return `
    <section class="settings-card" aria-labelledby="workerTokenTitle">
      <div class="settings-card-heading">
        <span class="settings-icon">${icons.globe}</span>
        <div class="flex-1"><h3 id="workerTokenTitle" data-i18n="settings.worker.title">Cloudflare Whisper</h3><p data-i18n="settings.worker.subtitle"></p></div>
        <span id="workerTokenStatus" class="status-badge" data-i18n="settings.api.statusUnset">Not set</span>
      </div>
      <form id="workerTokenForm" novalidate>
        <label for="workerTokenInput" class="field-label" data-i18n="settings.worker.label">Worker token</label>
        <div class="password-field">
          <input id="workerTokenInput" type="password" class="form-control font-mono" data-i18n-placeholder="settings.worker.placeholder" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="workerTokenHelp workerTokenError" />
          <button id="workerTokenToggle" type="button" class="password-toggle" data-i18n-aria-label="settings.worker.toggleAria" aria-pressed="false">${icons.eye}</button>
        </div>
        <p id="workerTokenHelp" class="field-help" data-i18n="settings.worker.help"></p>
        <p id="workerTokenError" class="field-error" aria-live="polite"></p>
        <div>
          <label for="workerBaseUrlInput" class="field-label" data-i18n="settings.worker.baseUrlLabel">Worker base URL</label>
          <input id="workerBaseUrlInput" type="url" class="form-control font-mono" value="${DEFAULT_SETTINGS.workerBaseUrl}" autocapitalize="none" spellcheck="false" aria-describedby="workerBaseUrlHelp" />
          <p id="workerBaseUrlHelp" class="field-help" data-i18n="settings.worker.baseUrlHelp"></p>
        </div>
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <button id="workerTokenDeleteButton" type="button" class="secondary-action"><span data-i18n="settings.api.delete"></span></button>
          <button id="workerTokenSaveButton" type="submit" class="primary-action"><span data-i18n="settings.worker.save"></span></button>
        </div>
      </form>
    </section>`;
}

/**
 * Puerta de acceso — fullscreen overlay.
 *
 * Rendered visible and inert-locking the shell by default; `main.ts`
 * reveals the app only on `gate:change → open`. The `data-mode` attribute
 * switches between the locked form and the first-run setup form.
 */
function renderGateOverlay(): string {
  return `
    <div id="gateOverlay" class="gate-overlay" role="dialog" aria-modal="true" aria-labelledby="gateTitle" data-mode="locked">
      <div class="gate-card">
        <span class="gate-icon">${icons.lock}</span>
        <h2 id="gateTitle" data-i18n="gate.title">Puerta de acceso</h2>
        <p class="gate-subtitle" data-i18n="gate.subtitle"></p>
        <form id="gateLockedForm" class="gate-form gate-form-locked" novalidate>
          <label for="gateLockedInput" class="field-label" data-i18n="gate.label"></label>
          <input id="gateLockedInput" type="password" class="form-control" data-i18n-placeholder="gate.placeholder" autocomplete="current-password" aria-describedby="gateLockedError" />
          <p id="gateLockedError" class="field-error" aria-live="polite"></p>
          <button id="gateLockedSubmit" type="submit" class="primary-action"><span data-i18n="gate.submit"></span></button>
        </form>
        <form id="gateSetupForm" class="gate-form gate-form-setup" novalidate>
          <p class="gate-subtitle" data-i18n="gate.setup.subtitle"></p>
          <label for="gateSetupInput" class="field-label" data-i18n="gate.setup.label"></label>
          <input id="gateSetupInput" type="password" class="form-control" data-i18n-placeholder="gate.placeholder" autocomplete="new-password" aria-describedby="gateSetupError" />
          <label for="gateSetupConfirmInput" class="field-label" data-i18n="gate.setup.confirmLabel"></label>
          <input id="gateSetupConfirmInput" type="password" class="form-control" data-i18n-placeholder="gate.placeholder" autocomplete="new-password" aria-describedby="gateSetupError" />
          <p id="gateSetupError" class="field-error" aria-live="polite"></p>
          <button id="gateSetupSubmit" type="submit" class="primary-action"><span data-i18n="gate.setup.submit"></span></button>
        </form>
      </div>
    </div>`;
}

/**
 * Frase de acceso section in Settings: current phrase + new phrase ×2.
 * Only reachable while the gate is open, so the credential always exists.
 */
function renderGateSection(): string {
  return `
    <section class="settings-card" aria-labelledby="gateSettingsTitle">
      <div class="settings-card-heading">
        <span class="settings-icon">${icons.lock}</span>
        <div class="flex-1"><h3 id="gateSettingsTitle" data-i18n="settings.gate.title">Frase de acceso</h3><p data-i18n="settings.gate.subtitle"></p></div>
        <span class="status-badge" data-i18n="settings.gate.statusSet"></span>
      </div>
      <form id="gatePhraseForm" novalidate>
        <label for="gatePhraseCurrentInput" class="field-label" data-i18n="settings.gate.current"></label>
        <input id="gatePhraseCurrentInput" type="password" class="form-control" autocomplete="current-password" aria-describedby="gatePhraseError" />
        <label for="gatePhraseNewInput" class="field-label" data-i18n="settings.gate.new"></label>
        <input id="gatePhraseNewInput" type="password" class="form-control" autocomplete="new-password" />
        <label for="gatePhraseConfirmInput" class="field-label" data-i18n="settings.gate.confirm"></label>
        <input id="gatePhraseConfirmInput" type="password" class="form-control" autocomplete="new-password" />
        <p id="gatePhraseError" class="field-error" aria-live="polite"></p>
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <button id="gatePhraseSaveButton" type="submit" class="primary-action"><span data-i18n="settings.gate.save"></span></button>
        </div>
      </form>
    </section>`;
}

/** About view: app card, author card, GitHub link. Content is fully i18n'd. */
function renderAboutView(githubIcon: string, arrowIcon: string): string {
  return `
    <section id="aboutView" class="view-panel about-view" aria-labelledby="aboutTitle" hidden>
      <div class="view-heading">
        <div>
          <p class="eyebrow" data-i18n="about.eyebrow"></p>
          <h2 id="aboutTitle" data-i18n="about.title"></h2>
          <p data-i18n="about.description"></p>
        </div>
      </div>
      <div class="about-content">
        <div class="about-card about-app">
          <div class="about-app-header">
            <span class="about-app-icon">🎤</span>
            <div>
              <h3 data-i18n="about.appName"></h3>
              <span class="about-version"></span>
            </div>
          </div>
          <p class="about-app-desc" data-i18n="about.appDesc"></p>
          <div class="about-tech-stack" data-i18n="about.techStack"></div>
        </div>

        <div class="about-card about-author">
          <div class="about-author-header">
            <h3 data-i18n="about.author"></h3>
            <a href="https://zademy.com" target="_blank" rel="noopener noreferrer" class="about-website-link">
              <span data-i18n="about.website"></span> ${arrowIcon}
            </a>
          </div>
          <p class="about-author-bio" data-i18n="about.authorBio"></p>
        </div>

        <a href="https://github.com/zademy/lu-yume-speech" target="_blank" rel="noopener noreferrer" class="about-github-link">
          ${githubIcon}
          <span data-i18n="about.github"></span>
          ${arrowIcon}
        </a>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Dictation workspace sub-sections
// ---------------------------------------------------------------------------

/** Status bar above the visualizer — shows the OS-aware push-to-talk hint. */
function renderStatusBar(modifierLabel: string): string {
  return `
    <div id="status" class="mb-4 flex min-h-[2em] items-center justify-center gap-2 text-center text-[15px] font-medium text-[var(--color-text-secondary)]">
      <span data-i18n="dictation.status.prefix">Press</span><kbd class="shortcut-key">${modifierLabel}</kbd><span class="text-[var(--color-text-muted)]">+</span><kbd class="shortcut-key">Space</kbd><span data-i18n="dictation.status.suffix">to talk</span>
    </div>`;
}

/** Visualizer container: canvas + REC indicator + elapsed-time badge. */
function renderVisualizerArea(): string {
  return `
    <div id="waveformContainer" class="waveform-container relative mb-4 min-h-40 overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-card)]">
      <canvas id="waveformCanvas" aria-hidden="true" class="block h-40 w-full"></canvas>
      <span id="timerDisplay" class="glass absolute right-3 top-2.5 rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">00:00</span>
      <span id="recIndicator" class="rec-indicator glass absolute left-3 top-2.5 flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 opacity-0"><span class="rec-dot h-2 w-2 rounded-full bg-[var(--color-text-primary)]"></span><span class="text-[10px] font-bold tracking-wider">REC</span></span>
    </div>`;
}

/** Output area: word count, copy/download/clear toolbar, textarea, metadata, summary. */
function renderOutputSection(): string {
  return `
    <div class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <span class="eyebrow"><span id="wordCount" class="font-semibold text-[var(--color-text-secondary)]">0</span> <span data-i18n="output.wordsSuffix">words</span></span>
        <div class="flex items-center gap-0.5">
          ${renderToolbarButton('copyAllBtn', icons.copy, 'output.copyAll')}
          ${renderToolbarButton('downloadBtn', icons.download, 'output.download')}
          ${renderToolbarButton('clearBtn', icons.trash, 'output.clear')}
        </div>
      </div>
      <div id="localRecovery" hidden role="alert" aria-labelledby="localRecoveryTitle" class="rounded-xl border border-[var(--color-status-error)] bg-[var(--color-surface-muted)] p-3">
        <div class="flex items-start justify-between gap-2">
          <h3 id="localRecoveryTitle" class="text-sm font-bold text-[var(--color-status-error)]" data-i18n="recovery.title"></h3>
          <button type="button" id="localRecoveryDismiss" class="secondary-action shrink-0" data-i18n="recovery.dismiss"></button>
        </div>
        <p id="localRecoveryMessage" class="mt-1 text-[12px] leading-4 text-[var(--color-text-secondary)]"></p>
        <div id="localRecoveryActions" class="mt-2 flex flex-wrap items-center gap-2"></div>
        <details class="mt-2">
          <summary class="cursor-pointer text-[11px] text-[var(--color-text-muted)]" data-i18n="recovery.technical"></summary>
          <pre id="localRecoveryDetail" class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-subtle)] p-2 font-mono text-[10.5px] text-[var(--color-text-secondary)]"></pre>
          <button type="button" id="localRecoveryCopy" class="secondary-action mt-1" data-i18n="recovery.copyTechnical"></button>
        </details>
      </div>
      <textarea id="output" class="output-area" data-i18n-placeholder="output.placeholder" spellcheck="true"></textarea>
      <div id="metadataPanel" class="hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]"></div>
      <div class="flex items-center justify-between gap-3 pt-2">
        <p class="text-[11px] leading-4 text-[var(--color-text-muted)]" data-i18n="output.summaryHint"></p>
        <button id="summaryBtn" type="button" disabled class="primary-action shrink-0">${icons.sparkle}<span data-i18n="output.summaryBtn"></span></button>
      </div>
      <section id="summarySection" hidden aria-labelledby="summaryTitle" class="pt-4">
        <div class="mb-3 px-1"><p class="eyebrow" data-i18n="output.summary.eyebrow"></p><h3 id="summaryTitle" class="text-base font-bold tracking-tight" data-i18n="output.summary.title"></h3></div>
        <div id="summaryPanel" hidden class="space-y-2" aria-live="polite"></div>
      </section>
    </div>`;
}

/** Footnote with shortcut + processor info, shown below the output. */
function renderDictationFooter(): string {
  return `<div class="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-4 text-[10.5px] text-[var(--color-text-muted)]"><span data-i18n="dictation.footer.shortcut"></span><span data-i18n="dictation.footer.processor"></span></div>`;
}

// ---------------------------------------------------------------------------
// Reusable field primitives (used by Settings cards)
// ---------------------------------------------------------------------------

/** Generic `<select>` row with localized label and pre-selected option. */
function renderSelectField(
  id: string,
  labelKey: string,
  options: Array<{ value: string; label: string; selected: boolean }>,
): string {
  const renderedOptions = options
    .map(
      (option) =>
        `<option value="${option.value}" ${option.selected ? 'selected' : ''}>${option.label}</option>`,
    )
    .join('');
  return `<div><label for="${id}" class="field-label" data-i18n="${labelKey}"></label><select id="${id}" class="form-control">${renderedOptions}</select></div>`;
}

/** Método de transcripción selector — options are i18n-keyed (remote / local). */
function renderMethodField(): string {
  const renderedOptions = TRANSCRIPTION_METHODS.map(
    (o) =>
      `<option value="${o.value}" data-i18n="${o.labelKey}" ${o.value === DEFAULT_SETTINGS.transcriptionMethod ? 'selected' : ''}></option>`,
  ).join('');
  return `<div><label for="methodSelect" class="field-label" data-i18n="field.method"></label><select id="methodSelect" class="form-control">${renderedOptions}</select></div>`;
}

/**
 * Modelo activo selector. Ships with a single "no active model" option —
 * downloaded models populate it once the local engine lands.
 */
function renderLocalModelField(): string {
  return `<div><label for="localModelSelect" class="field-label" data-i18n="field.localModel"></label><select id="localModelSelect" class="form-control"><option value="none" data-i18n="localModel.none" selected></option></select></div>`;
}

/**
 * One Modelo del catálogo card: metadata plus the download controls driven
 * by the Motor local (T3). Download starts the engine message; Cancel aborts
 * it; progress is exposed as text with bytes and phase on an aria-live
 * region (states are text-first — never color-only). Precision/speed labels
 * and the Benchmark row derive from the published manifest (T8) — run the
 * on-device diagnostics to reproduce them on your hardware.
 */
function renderLocalModelCard(entry: (typeof LOCAL_MODEL_CATALOG)[number]): string {
  return `
    <li class="local-model-card rounded-lg border border-[var(--color-border-subtle)] p-4" data-model-id="${entry.id}">
      <div class="flex items-center justify-between gap-2">
        <div>
          <h4 class="text-[13px] font-semibold">${entry.name} <span class="text-[var(--color-text-muted)]">(${entry.dtype})</span></h4>
          <p class="text-[10.5px] text-[var(--color-text-muted)]">${formatDownloadSize(entry.downloadBytes)} · <span data-i18n="localModels.languages.${entry.autoDetectLanguage ? 'auto' : 'manual'}"></span></p>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="hidden rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[10.5px] font-semibold" data-model-active-badge="${entry.id}" data-i18n="localModels.activeBadge"></span>
          ${entry.recommended ? `<span class="rounded-full border border-[var(--color-accent-strong,#1f6feb)] px-2 py-0.5 text-[10.5px] font-semibold" data-model-recommended="${entry.id}" data-i18n="localModels.recommended"></span>` : ''}
          ${entry.modestHardware ? `<span class="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[10.5px] font-semibold" data-model-modest="${entry.id}" data-i18n="localModels.modestHardware"></span>` : ''}
          ${entry.experimental ? `<span class="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[10.5px] font-semibold" data-model-experimental="${entry.id}" data-i18n="localModels.experimental"></span>` : ''}
          <span class="local-model-state rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10.5px]" data-state="not-downloaded" data-model-state="${entry.id}" data-i18n="localModels.state.notDownloaded"></span>
        </div>
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-3">
        <div><dt class="text-[var(--color-text-muted)]" data-i18n="localModels.precision"></dt><dd data-i18n="localModels.precision.${entry.precision}"></dd></div>
        <div><dt class="text-[var(--color-text-muted)]" data-i18n="localModels.speed"></dt><dd data-i18n="localModels.speed.${entry.speed}"></dd></div>
        <div><dt class="text-[var(--color-text-muted)]" data-i18n="localModels.memory"></dt><dd data-i18n="localModels.memory.${entry.memoryTier}"></dd></div>
        <div><dt class="text-[var(--color-text-muted)]" data-i18n="localModels.backend"></dt><dd data-i18n="localModels.backend.${entry.backend}"></dd></div>
        <div><dt class="text-[var(--color-text-muted)]" data-i18n="localModels.measuredTag"></dt><dd data-model-measured="${entry.id}" data-i18n="localModels.estimate"></dd></div>
        <div><dt class="text-[var(--color-text-muted)]" data-i18n="localModels.license"></dt><dd><a class="underline" href="${entry.licenseUrl}" target="_blank" rel="noopener noreferrer">${entry.license}</a></dd></div>
      </dl>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" class="primary-action" data-model-download="${entry.id}" data-i18n="localModels.download"></button>
        <button type="button" class="secondary-action hidden" data-model-cancel="${entry.id}" data-i18n="localModels.cancel"></button>
        <button type="button" class="secondary-action hidden" data-model-activate="${entry.id}" data-i18n="localModels.activate"></button>
        <button type="button" class="secondary-action hidden" data-model-update="${entry.id}" data-i18n="localModels.update"></button>
        <button type="button" class="secondary-action hidden" data-model-delete="${entry.id}" data-i18n="localModels.delete"></button>
        <button type="button" class="secondary-action hidden" data-model-diagnose="${entry.id}" data-i18n="localModels.diagnose"></button>
        <button type="button" class="secondary-action hidden" data-model-perf-export="${entry.id}" data-i18n="localModels.exportPerf"></button>
        <button type="button" class="secondary-action hidden" data-model-perf-clear="${entry.id}" data-i18n="localModels.clearPerf"></button>
      </div>
      <div class="mt-2 hidden" data-model-progress="${entry.id}">
        <progress class="h-1.5 w-full" max="100" value="0" data-model-progressbar="${entry.id}"></progress>
        <p class="mt-1 text-[10.5px] text-[var(--color-text-muted)]" role="status" aria-live="polite" data-model-progresstext="${entry.id}"></p>
      </div>
    </li>`;
}

/** Noise-reduction selector — options are i18n-keyed (off / DSP / RNNoise). */
function renderNoiseReductionField(): string {
  const options = [
    { value: 'off', label: '', labelKey: 'noise.off', selected: false },
    { value: 'dsp', label: '', labelKey: 'noise.dsp', selected: true },
    { value: 'rnnoise', label: '', labelKey: 'noise.rnnoise', selected: false },
  ];
  const renderedOptions = options
    .map(
      (o) =>
        `<option value="${o.value}" data-i18n="${o.labelKey}" ${o.selected ? 'selected' : ''}></option>`,
    )
    .join('');
  return `<div><label for="noiseReductionSelect" class="field-label" data-i18n="field.noiseReduction"></label><select id="noiseReductionSelect" class="form-control">${renderedOptions}</select></div>`;
}

/** Multi-row textarea with localized label + placeholder. */
function renderTextareaField(
  id: string,
  labelKey: string,
  placeholderKey: string,
  rows: number,
): string {
  return `<div><label for="${id}" class="field-label" data-i18n="${labelKey}"></label><textarea id="${id}" rows="${rows}" class="form-control resize-none" data-i18n-placeholder="${placeholderKey}"></textarea></div>`;
}

/** Single-line text input with localized label + placeholder. */
function renderTextField(id: string, labelKey: string, placeholderKey: string): string {
  return `<div><label for="${id}" class="field-label" data-i18n="${labelKey}"></label><input id="${id}" type="text" class="form-control" data-i18n-placeholder="${placeholderKey}" /></div>`;
}

/** Whisper temperature slider with a live numeric readout next to the label. */
function renderTemperatureControl(): string {
  return `<div><div class="flex items-center justify-between"><label for="temperatureSlider" class="field-label" data-i18n="field.temperature"></label><span id="temperatureValue" class="range-value">${DEFAULT_SETTINGS.temperature}</span></div><input id="temperatureSlider" type="range" min="0" max="1" step="0.1" value="${DEFAULT_SETTINGS.temperature}" class="range-control" /></div>`;
}

/** Response-format selector with optional timestamps toggle. */
function renderResponseFormatControl(): string {
  const options = RESPONSE_FORMATS.map(
    (format) =>
      `<option value="${format.value}" ${format.value === DEFAULT_SETTINGS.responseFormat ? 'selected' : ''}>${format.label}</option>`,
  ).join('');
  return `<div><label for="responseFormatSelect" class="field-label" data-i18n="field.format"></label><select id="responseFormatSelect" class="form-control">${options}</select><label class="mt-2 flex min-h-10 items-center gap-2 text-xs text-[var(--color-text-muted)]"><input id="timestampToggle" type="checkbox" class="accent-[var(--color-control-emphasis)]" /> <span data-i18n="field.timestamps"></span></label></div>`;
}

/** Quality card body: vocabulary, correction threshold, filler words, silence trim, LLM polish. */
function renderQualitySection(): string {
  return `
    <div class="settings-grid">
      <div class="settings-grid-span">${renderTextareaField('customWordsInput', 'field.vocab', 'field.vocab.placeholder', 2)}</div>
      <div class="settings-grid-span">${renderRangeField('wordCorrectionThresholdSlider', 'wordCorrectionThresholdValue', 'field.threshold', String(DEFAULT_SETTINGS.wordCorrectionThreshold), '0.1', '1', '0.05')}</div>
      <div class="settings-grid-span">${renderTextField('customFillerWordsInput', 'field.fillerWords', 'field.fillerWords.placeholder')}</div>
      ${renderToggleField('silenceTrimToggle', 'field.silenceTrim', 'field.silenceTrim.hint', DEFAULT_SETTINGS.enableSilenceTrim)}
      ${renderToggleField('llmToggle', 'field.llmToggle', 'field.llmToggle.hint', DEFAULT_SETTINGS.enableLlmPostProcess)}
      <div id="localLlmAuthRow" class="settings-grid-span hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        <label class="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
          <input id="localLlmAuth" type="checkbox" class="mt-0.5 accent-[var(--color-control-emphasis)]" />
          <span data-i18n="field.localLlmAuth"></span>
        </label>
        <p class="mt-1.5 text-[11px] leading-4 text-[var(--color-text-muted)]" data-i18n="field.localLlmAuth.explain"></p>
      </div>
      ${renderTextField('llmModelInput', 'field.llmModel', 'field.llmModel')}
      <div class="settings-grid-span">${renderTextareaField('llmInstructionsInput', 'field.llmInstructions', 'field.llmInstructions.placeholder', 2)}</div>
    </div>`;
}

/** Generic range slider with a live numeric readout next to the label. */
function renderRangeField(
  id: string,
  valueId: string,
  labelKey: string,
  value: string,
  min: string,
  max: string,
  step: string,
): string {
  return `<div><div class="flex items-center justify-between"><label for="${id}" class="field-label" data-i18n="${labelKey}"></label><span id="${valueId}" class="range-value">${value}</span></div><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" class="range-control" /></div>`;
}

/** Checkbox toggle row with a strong label + small hint below it. */
function renderToggleField(
  id: string,
  labelKey: string,
  hintKey: string,
  checked: boolean,
): string {
  return `<label for="${id}" class="toggle-field"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} class="mt-1 accent-[var(--color-control-emphasis)]" /><span><strong data-i18n="${labelKey}"></strong><small data-i18n="${hintKey}"></small></span></label>`;
}

/** Compact rate-limits card — Groq free-tier reference + link to settings. */
function renderRateLimits(): string {
  return `<section class="settings-card compact-card" aria-labelledby="limitsTitle"><div><p class="eyebrow" data-i18n="limits.eyebrow"></p><h3 id="limitsTitle" data-i18n="limits.title"></h3></div><div class="limits-grid"><span>20 req/min</span><span>2,000 req/día</span><span>~8 hrs/día</span></div><a href="https://console.groq.com/settings/limits" target="_blank" rel="noopener noreferrer" class="text-sm font-semibold"><span data-i18n="limits.link"></span> ${icons.arrowUpRight}</a></section>`;
}

/** Icon-only toolbar button (copy, download, clear) with i18n aria-label + title. */
function renderToolbarButton(id: string, icon: string, labelKey: string): string {
  return `<button id="${id}" type="button" class="icon-button compact" data-i18n-aria-label="${labelKey}" data-i18n-title="${labelKey}">${icon}</button>`;
}

/** Fixed bottom-right container where `toast.ts` mounts non-blocking notifications. */
function renderToastContainer(): string {
  return `<div id="toastContainer" class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"></div>`;
}

/**
 * Inline SVG icon set.
 *
 * Each value is a complete `<svg>` markup string (no external sprite sheet),
 * `aria-hidden`, and consumed by the render helpers above. Kept at module
 * scope so the strings are interned once.
 */
const icons = {
  home: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  mic: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="6" height="11" x="9" y="2" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',
  chart:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16V9"/><path d="M12 16v-5"/><path d="M17 16V6"/></svg>',
  feather:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" x2="2" y1="8" y2="22"/><line x1="17.5" x2="9" y1="15" y2="15"/></svg>',
  globe:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  menu: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  settings:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  key: '<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15 8l3 3M18 5l3 3"/></svg>',
  lock: '<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
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
  info: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  github:
    '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.95 10.95 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>',
};
