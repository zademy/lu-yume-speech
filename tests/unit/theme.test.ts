import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEY, ThemeManager } from '../../src/utils/theme';
import { save } from '../../src/utils/storage';

function createToggleBtn(): HTMLButtonElement {
  return document.createElement('button');
}

function setMatchMediaDark(isDark: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: isDark,
    media: '',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

describe('theme storage key', () => {
  beforeEach(() => localStorage.clear());

  it('STORAGE_KEY is "theme" (storage layer adds stt_ prefix)', () => {
    expect(STORAGE_KEY).toBe('theme');
  });

  it('persisted value lands at stt_theme (matches index.html no-flash script)', () => {
    save(STORAGE_KEY, 'dark');
    expect(localStorage.getItem('stt_theme')).toBe('"dark"');
    expect(localStorage.getItem('theme')).toBeNull();
  });
});

describe('ThemeManager', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('init applies stored dark theme', () => {
    save(STORAGE_KEY, 'dark');
    setMatchMediaDark(false);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('init applies stored light theme', () => {
    save(STORAGE_KEY, 'light');
    setMatchMediaDark(true);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('init falls back to system preference when no stored value', () => {
    setMatchMediaDark(true);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('toggle switches dark to light and persists', () => {
    save(STORAGE_KEY, 'dark');
    setMatchMediaDark(false);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    manager.toggle();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('stt_theme')).toBe('"light"');
  });

  it('toggle switches light to dark and persists', () => {
    save(STORAGE_KEY, 'light');
    setMatchMediaDark(false);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    manager.toggle();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('stt_theme')).toBe('"dark"');
  });

  it('toggle resolves system→dark when system is dark, then toggles to light', () => {
    setMatchMediaDark(true);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    // system=dark → resolved=dark → toggle to light
    manager.toggle();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('stt_theme')).toBe('"light"');
  });

  it('toggle resolves system→light when system is light, then toggles to dark', () => {
    setMatchMediaDark(false);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    // system=light → resolved=light → toggle to dark
    manager.toggle();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('stt_theme')).toBe('"dark"');
  });

  it('button click triggers toggle', () => {
    save(STORAGE_KEY, 'dark');
    setMatchMediaDark(false);

    const btn = createToggleBtn();
    const manager = new ThemeManager(btn);
    manager.init();

    btn.click();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('constructor builds sun and moon icon elements in button', () => {
    setMatchMediaDark(false);

    const btn = createToggleBtn();
    new ThemeManager(btn);

    const spans = btn.querySelectorAll('span');
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const svgs = btn.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });
});
