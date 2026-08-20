import { afterEach, describe, expect, it } from 'vitest';

import { renderApp } from '../../src/ui/renderer';
import { translateTree } from '../../src/i18n/translations';

describe('renderApp application shell', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders Inicio, Dictar and Ajustes as application views', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);
    translateTree(elements.root, 'es');

    expect(elements.navigation.getAttribute('aria-label')).toBe('Navegación principal');
    expect(elements.homeNavButton.textContent).toContain('Inicio');
    expect(elements.dictationNavButton.textContent).toContain('Dictar');
    expect(elements.settingsNavButton.textContent).toContain('Ajustes');
    expect(elements.metricsNavButton.textContent).toContain('Métricas');
    expect(elements.plumaNavButton.textContent).toContain('Pluma');
    expect(elements.homeView.hidden).toBe(false);
    expect(elements.dictationView.hidden).toBe(true);
    expect(elements.settingsView.hidden).toBe(true);
    expect(elements.plumaView.hidden).toBe(true);
  });

  it('places history and activity metrics in Inicio', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    expect(elements.homeView.contains(elements.historyList)).toBe(true);
    expect(elements.homeView.contains(elements.wordsMetric)).toBe(true);
    expect(elements.homeView.contains(elements.transcriptionsMetric)).toBe(true);
    expect(elements.homeView.contains(elements.audioMinutesMetric)).toBe(true);
  });

  it('renders API key management as an accessible settings form', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    expect(elements.apiKeyInput.type).toBe('password');
    expect(elements.apiKeyInput.getAttribute('aria-describedby')).toBe('apiKeyHelp apiKeyError');
    expect(elements.apiKeyToggle.getAttribute('aria-pressed')).toBe('false');
    expect(elements.settingsView.contains(elements.apiKeyInput)).toBe(true);
    expect(elements.settingsView.contains(elements.gatePhraseForm)).toBe(true);
  });

  it('renders the transcription method hierarchy with local defaults', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    // Método de transcripción: remote selected by default, local offered.
    expect(elements.methodSelect.value).toBe('remote');
    expect(
      elements.methodSelect.querySelector<HTMLOptionElement>('option[value="local"]'),
    ).not.toBeNull();

    // Proveedor remoto keeps its Groq default under the remote method.
    expect(elements.providerSelect.value).toBe('groq');

    // Modelo activo ships as a single "no active model" placeholder.
    expect(elements.localModelSelect.value).toBe('none');
    expect(elements.localModelSelect.options.length).toBe(1);

    // All three selectors live in the transcription settings card.
    expect(elements.settingsView.contains(elements.methodSelect)).toBe(true);
    expect(elements.settingsView.contains(elements.providerSelect)).toBe(true);
    expect(elements.settingsView.contains(elements.localModelSelect)).toBe(true);
  });

  it('renders the local-model dictation gate hidden by default', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    expect(elements.dictationView.contains(elements.dictationLocalGate)).toBe(true);
    expect(elements.dictationLocalGate.hidden).toBe(true);
    expect(elements.dictationLocalGateButton.localName).toBe('button');
  });

  it('renders the local recovery panel hidden, accessible and action-driven (T7)', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    // Lives in the Dictar view next to the output area, hidden until a
    // local failure offers manual actions.
    expect(elements.localRecovery.hidden).toBe(true);
    expect(elements.localRecovery.getAttribute('role')).toBe('alert');
    expect(elements.localRecovery.getAttribute('aria-labelledby')).toBe('localRecoveryTitle');
    // Dismiss and copy-report controls are real buttons (focusable, named).
    expect(elements.localRecoveryDismiss.localName).toBe('button');
    expect(elements.localRecoveryCopy.localName).toBe('button');
    // The technical report never ships inside the visible message.
    expect(elements.localRecoveryActions.children.length).toBe(0);
    expect(elements.localRecoveryDetail.textContent).toBe('');
  });

  it('renders the local LLM authorization row hidden by default (T7 privacy)', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    expect(elements.localLlmAuthRow.classList.contains('hidden')).toBe(true);
    expect(elements.localLlmAuth.type).toBe('checkbox');
    expect(elements.localLlmAuth.checked).toBe(false);
  });

  it('renders the local-models settings section read-only', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);
    translateTree(elements.root, 'es');

    // Device summary exists and starts empty (filled async at runtime).
    expect(elements.settingsView.contains(elements.localModelsDevice)).toBe(true);
    expect(elements.localModelsDevice.getAttribute('aria-live')).toBe('polite');

    // Advanced controls (T5): backend policy, idle release, manual free and
    // the resident-model line (aria-live, text-first).
    expect(elements.localBackendSelect.value).toBe('auto');
    expect(
      elements.localBackendSelect.querySelector<HTMLOptionElement>('option[value="wasm"]'),
    ).not.toBeNull();
    expect(elements.localIdleMinutes.localName).toBe('input');
    expect(elements.localReleaseBtn.classList.contains('hidden')).toBe(true);
    expect(elements.localResidentLine.getAttribute('aria-live')).toBe('polite');

    // Stage 1-3 catalog cards, in catalog order.
    const cards = [...elements.root.querySelectorAll<HTMLElement>('.local-model-card')];
    expect(cards.map((c) => c.dataset.modelId)).toEqual([
      'whisper-base',
      'whisper-small',
      'whisper-large-v3-turbo',
      'whisper-tiny',
      'whisper-medium',
      'whisper-large-v3',
      'whisper-large-v3-turbo-lite-fast',
      'whisper-large-v3-turbo-lite-accurate',
      'whisper-large-v3-lite-fast',
      'whisper-large-v3-lite-accurate',
    ]);

    // Mobile note (T9) exists but stays hidden on desktop-class contexts.
    expect(elements.localModelsMobileNote.classList.contains('hidden')).toBe(true);
    expect(elements.localModelsMobileNote.textContent).toContain('móviles');

    // Every card: localized state text (not color-only) keyed for dynamic
    // updates, an enabled Download control, a hidden Cancel and a hidden
    // aria-live progress region (T3 download engine controls), plus the T6
    // lifecycle actions (activate/update/delete/clear-perf) hidden until the
    // engine reveals them, and the unique Active badge hidden by default.
    for (const card of cards) {
      const state = card.querySelector<HTMLElement>('.local-model-state');
      expect(state?.textContent).toBe('No descargado');
      expect(state?.dataset.modelState).toBe(card.dataset.modelId);
      const download = card.querySelector<HTMLButtonElement>('[data-model-download]');
      expect(download?.disabled).toBe(false);
      expect(download?.textContent).toBe('Descargar');
      const cancel = card.querySelector<HTMLButtonElement>('[data-model-cancel]');
      expect(cancel?.classList.contains('hidden')).toBe(true);
      const activate = card.querySelector<HTMLButtonElement>('[data-model-activate]');
      expect(activate?.classList.contains('hidden')).toBe(true);
      const update = card.querySelector<HTMLButtonElement>('[data-model-update]');
      expect(update?.classList.contains('hidden')).toBe(true);
      const del = card.querySelector<HTMLButtonElement>('[data-model-delete]');
      expect(del?.classList.contains('hidden')).toBe(true);
      const perfClear = card.querySelector<HTMLButtonElement>('[data-model-perf-clear]');
      expect(perfClear?.classList.contains('hidden')).toBe(true);
      const activeBadge = card.querySelector<HTMLElement>('[data-model-active-badge]');
      expect(activeBadge?.classList.contains('hidden')).toBe(true);
      const progressText = card.querySelector<HTMLElement>('[data-model-progresstext]');
      expect(progressText?.getAttribute('aria-live')).toBe('polite');
      const progressWrap = card.querySelector<HTMLElement>('[data-model-progress]');
      expect(progressWrap?.classList.contains('hidden')).toBe(true);
    }

    // Metadata: size line + license link to the pinned repo page.
    const base = cards[0];
    expect(base?.textContent).toContain('138.4 MiB');
    const license = base?.querySelector<HTMLAnchorElement>('dl a');
    expect(license?.href).toBe('https://huggingface.co/onnx-community/whisper-base');

    // Turbo declares its WebGPU requirement in text.
    const turbo = cards[2];
    expect(turbo?.textContent).toContain('Requiere WebGPU');

    // Experimental semantics (T9): ONLY the four Lite cards carry the
    // visible badge; every card's Benchmark row defaults to the localized
    // Estimación marker (main.ts swaps in published numbers at runtime).
    for (const card of cards) {
      const badge = card.querySelector<HTMLElement>('[data-model-experimental]');
      const isLite = card.dataset.modelId?.includes('-lite-') ?? false;
      expect(!!badge).toBe(isLite);
      if (badge) expect(badge.textContent).toBe('Experimental');
      const measured = card.querySelector<HTMLElement>('[data-model-measured]');
      expect(measured?.getAttribute('data-i18n')).toBe('localModels.estimate');
    }
    // After translateTree('es'), unmeasured rows read Estimación.
    expect(cards[3]?.querySelector('[data-model-measured]')?.textContent).toBe('Estimación');
    expect(cards[0]?.querySelector('[data-model-measured]')?.textContent).toBe('Estimación');

    // First-download guidance (story 25): exactly one Recommended chip
    // (Whisper Small) and one For-modest-hardware chip (Whisper Base).
    for (const card of cards) {
      const recommended = card.querySelector<HTMLElement>('[data-model-recommended]');
      const modest = card.querySelector<HTMLElement>('[data-model-modest]');
      expect(!!recommended).toBe(card.dataset.modelId === 'whisper-small');
      expect(!!modest).toBe(card.dataset.modelId === 'whisper-base');
      if (recommended) expect(recommended.textContent).toBe('Recomendado');
      if (modest) expect(modest.textContent).toBe('Para hardware modesto');
    }
  });

  it('renders the Puerta de acceso visible with the shell inert by default', () => {
    const elements = renderApp();
    document.body.appendChild(elements.root);

    expect(elements.gateOverlay.hidden).toBe(false);
    expect(elements.gateOverlay.getAttribute('role')).toBe('dialog');
    expect(elements.gateOverlay.getAttribute('aria-modal')).toBe('true');
    expect(elements.gateOverlay.dataset.mode).toBe('locked');
    expect(elements.navigation.hasAttribute('inert')).toBe(true);
    expect(elements.navBackdrop.hasAttribute('inert')).toBe(true);
    expect(elements.appWorkspace.hasAttribute('inert')).toBe(true);
    expect(elements.gateLockedInput.type).toBe('password');
    expect(elements.gateSetupInput.type).toBe('password');
    expect(elements.gateSetupConfirmInput.type).toBe('password');
  });
});
