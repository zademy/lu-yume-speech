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
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
