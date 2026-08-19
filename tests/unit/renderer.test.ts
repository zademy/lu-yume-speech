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

    // Stage-1 catalog cards, in catalog order.
    const cards = [...elements.root.querySelectorAll<HTMLElement>('.local-model-card')];
    expect(cards.map((c) => c.dataset.modelId)).toEqual([
      'whisper-base',
      'whisper-small',
      'whisper-large-v3-turbo',
    ]);

    // Every card: localized state text (not color-only) keyed for dynamic
    // updates, an enabled Download control, a hidden Cancel and a hidden
    // aria-live progress region (T3 download engine controls).
    for (const card of cards) {
      const state = card.querySelector<HTMLElement>('.local-model-state');
      expect(state?.textContent).toBe('No descargado');
      expect(state?.dataset.modelState).toBe(card.dataset.modelId);
      const download = card.querySelector<HTMLButtonElement>('[data-model-download]');
      expect(download?.disabled).toBe(false);
      expect(download?.textContent).toBe('Descargar');
      const cancel = card.querySelector<HTMLButtonElement>('[data-model-cancel]');
      expect(cancel?.classList.contains('hidden')).toBe(true);
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
