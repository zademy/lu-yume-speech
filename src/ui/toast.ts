/**
 * Toast notification system.
 *
 * Displays brief, non-blocking feedback messages in the bottom-right corner.
 * Supports success, error, warning, and info levels with appropriate styling.
 *
 * SRP: This module's only job is showing and auto-dismissing toasts.
 * Accessibility: Uses aria-live="polite" so screen readers announce toasts
 *               without stealing focus.
 *
 * Usage:
 * ```ts
 * showToast(container, 'Texto copiado', 'success');
 * showToast(container, 'Error: API key invalida', 'error', 5000);
 * ```
 */

type ToastLevel = 'success' | 'error' | 'warning' | 'info';

/** Neutral treatment per toast level using design system tokens. */
const LEVEL_STYLES: Record<ToastLevel, string> = {
  success:
    'bg-[var(--color-surface)] border-[var(--color-border-strong)] text-[var(--color-text-primary)]',
  error:
    'bg-[var(--color-surface-sunken)] border-[var(--color-text-primary)] text-[var(--color-text-primary)]',
  warning:
    'bg-[var(--color-surface-muted)] border-[var(--color-border-strong)] text-[var(--color-text-primary)]',
  info: 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)]',
};

/**
 * Pre-parsed SVG icon elements per toast level.
 * Built once at module load time via DOMParser — no runtime innerHTML.
 */
const LEVEL_ICON_NODES: Record<ToastLevel, SVGElement> = parseIconMap({
  success:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
});

/**
 * Show a toast notification.
 *
 * @param container - The toast container element (fixed positioned)
 * @param message   - Text to display
 * @param level     - Visual severity
 * @param duration  - Auto-dismiss time in ms (default: 3000)
 */
export function showToast(
  container: HTMLDivElement,
  message: string,
  level: ToastLevel = 'info',
  duration = 3000,
): void {
  const toast = document.createElement('div');
  toast.className = [
    'pointer-events-auto',
    'flex items-center gap-2',
    'px-4 py-3',
    'rounded-lg border',
    'text-sm font-medium',
    'shadow-lg',
    'transition-all duration-300 ease-out',
    'opacity-0 translate-y-2',
    LEVEL_STYLES[level],
  ].join(' ');

  toast.setAttribute('role', 'status');
  toast.dataset.toastLevel = level;

  // Icon — cloned from pre-parsed SVG element (no innerHTML at runtime).
  const iconSlot = document.createElement('span');
  iconSlot.className = 'shrink-0';
  iconSlot.appendChild(LEVEL_ICON_NODES[level].cloneNode(true));

  // Message — textContent auto-escapes, no XSS risk.
  const msgSlot = document.createElement('span');
  msgSlot.textContent = message;

  toast.appendChild(iconSlot);
  toast.appendChild(msgSlot);
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
  });

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-2');

    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, duration);
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Parse a map of SVG strings into actual SVGElement nodes using DOMParser.
 * Called once at module load. All strings are developer-controlled constants.
 */
function parseIconMap(map: Record<string, string>): Record<string, SVGElement> {
  const parser = new DOMParser();
  const result: Record<string, SVGElement> = {};

  for (const [key, svgString] of Object.entries(map)) {
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (svg) {
      result[key] = svg;
    }
  }

  return result;
}
