/**
 * Theme manager — light/dark mode with system preference detection.
 *
 * Persists the user's choice to localStorage and applies the 'dark' class
 * to the <html> element. Falls back to the system's prefers-color-scheme
 * when no stored preference exists.
 *
 * SRP: This module's only job is managing the theme.
 * OCP: New themes (e.g., 'auto') can be added without changing consumers.
 *
 * Usage:
 * ```ts
 * const theme = new ThemeManager(toggleButton);
 * theme.init(); // reads stored preference or detects system
 * // Toggle button click → theme.toggle()
 * ```
 */

import { load, save } from './storage';

const STORAGE_KEY = 'theme';

type Theme = 'light' | 'dark' | 'system';

export class ThemeManager {
  private current: Theme;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly sunIcon: HTMLSpanElement;
  private readonly moonIcon: HTMLSpanElement;

  constructor(toggleBtn: HTMLButtonElement) {
    this.toggleBtn = toggleBtn;
    this.current = load<Theme>(STORAGE_KEY, 'system');

    // Pre-render both icons once — toggle visibility via CSS class.
    // Avoids innerHTML on every toggle (XSS-safe, no string interpolation).
    this.sunIcon = this.createIconEl(
      'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', // moon path (shown in light mode)
    );
    this.moonIcon = this.createIconEl(
      'M12 2v2', // sun ray (one of many) — we build the full icon below
    );

    // Build sun icon (shown when dark mode is active → click to go light)
    this.sunIcon.replaceChildren();
    const sunSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sunSvg.setAttribute('width', '16');
    sunSvg.setAttribute('height', '16');
    sunSvg.setAttribute('viewBox', '0 0 24 24');
    sunSvg.setAttribute('fill', 'none');
    sunSvg.setAttribute('stroke', 'currentColor');
    sunSvg.setAttribute('stroke-width', '2');
    sunSvg.setAttribute('stroke-linecap', 'round');
    sunSvg.setAttribute('stroke-linejoin', 'round');
    const sunCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    sunCircle.setAttribute('cx', '12');
    sunCircle.setAttribute('cy', '12');
    sunCircle.setAttribute('r', '4');
    sunSvg.appendChild(sunCircle);
    for (const d of [
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41',
    ]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      sunSvg.appendChild(path);
    }
    this.sunIcon.appendChild(sunSvg);

    // Build moon icon (shown when light mode is active → click to go dark)
    const moonSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    moonSvg.setAttribute('width', '16');
    moonSvg.setAttribute('height', '16');
    moonSvg.setAttribute('viewBox', '0 0 24 24');
    moonSvg.setAttribute('fill', 'none');
    moonSvg.setAttribute('stroke', 'currentColor');
    moonSvg.setAttribute('stroke-width', '2');
    moonSvg.setAttribute('stroke-linecap', 'round');
    moonSvg.setAttribute('stroke-linejoin', 'round');
    const moonPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    moonPath.setAttribute('d', 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z');
    moonSvg.appendChild(moonPath);
    this.moonIcon.appendChild(moonSvg);

    this.sunIcon.classList.add('hidden');
    this.toggleBtn.appendChild(this.sunIcon);
    this.toggleBtn.appendChild(this.moonIcon);
  }

  /**
   * Initialize the theme manager.
   * Reads the stored preference (or detects system preference) and applies it.
   * Also wires the toggle button click handler.
   */
  init(): void {
    this.apply(this.current);
    this.toggleBtn.addEventListener('click', () => { this.toggle(); });
  }

  /**
   * Cycle to the next theme (light ↔ dark).
   * Persists the user's choice to localStorage.
   */
  toggle(): void {
    const resolved = this.resolved();
    const next = resolved === 'dark' ? 'light' : 'dark';
    this.current = next;
    this.apply(next);
    save(STORAGE_KEY, next);
  }

  /**
   * Resolve the effective theme, accounting for the 'system' option.
   * When set to 'system', queries the OS prefers-color-scheme media query.
   */
  private resolved(): 'light' | 'dark' {
    if (this.current !== 'system') return this.current;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Apply a theme by toggling the 'dark' class on the <html> element
   * and updating the icon visibility on the toggle button.
   *
   * @param theme - Theme to apply ('light', 'dark', or 'system')
   */
  private apply(theme: Theme): void {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    document.documentElement.classList.toggle('dark', isDark);

    // Toggle icon visibility (sun shown in dark mode, moon shown in light mode)
    this.sunIcon.classList.toggle('hidden', !isDark);
    this.moonIcon.classList.toggle('hidden', isDark);
  }

  /** Create a wrapper span element for an icon slot. */
  private createIconEl(_initialPath: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'flex items-center justify-center';
    return span;
  }
}
