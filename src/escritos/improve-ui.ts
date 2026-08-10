/**
 * Pluma AI selection improve — UI controller (T5).
 *
 * Vanilla DOM: watches the editor selection via `EditorHandle.onSelectionChange`,
 * shows a floating star near any non-empty selection, and on click opens a
 * popover that calls `improveSelection`, shows the suggestion, and Accepts or
 * Rejects. Accept dispatches `replaceRangeText(from, to, suggestion)`.
 *
 * Architecture: the network call + prompt are in `./improve.ts` (pure, tested).
 * This module only wires DOM events to the editor handle + toast container and
 * is exercised by the production build (it needs a real selection in a real
 * editor; not unit-tested in jsdom).
 *
 * SRP: this module only renders the improve affordance and forwards Accept.
 */

import type { AppLanguage } from '../types';
import { translate } from '../i18n/translations';
import { improveSelection, ImproveError } from './improve';
import type { EditorHandle, DocRange } from './editor';

export interface ImproveDeps {
  /** Returns the current editor handle (null when no doc is open). */
  getEditor: () => EditorHandle | null;
  /** Element whose bounding rect anchors the star (the editor container). */
  anchor: HTMLElement;
  /** Toast container for surfacing errors to the user. */
  toastContainer: HTMLElement;
  /** Groq API key getter (DI — never reads storage itself). */
  getApiKey: () => string;
  /** Current UI language (refreshed on settings:change). */
  getLang: () => AppLanguage;
}

export interface ImproveController {
  /** Refresh labels after a language change. */
  setLanguage: (lang: AppLanguage) => void;
  /** Re-bind the selection subscription to a freshly mounted editor. */
  attach: (editor: EditorHandle) => void;
  /** Detach the editor subscription and remove DOM. */
  dispose: () => void;
  /** The popover element (for the panel to mount). */
  readonly root: HTMLElement;
}

/**
 * Build the improve star + popover and wire it to the editor.
 *
 * The star and popover live in `deps.anchor`'s coordinate space; the caller
 * mounts `root` once and positions are recomputed on every selection change.
 */
export function createImproveController(deps: ImproveDeps): ImproveController {
  let lang = deps.getLang();
  let activeRange: DocRange | null = null;
  let pending: {
    from: number;
    to: number;
    promise: Promise<string>;
    ctrl: AbortController;
  } | null = null;

  const root = document.createElement('div');
  root.className = 'pluma-improve-root';
  // Overlay the anchor so the star can float above the editor. The anchor is
  // marked relative so absolute children anchor to it, not the viewport.
  deps.anchor.style.position = 'relative';
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '50',
  } satisfies Partial<CSSStyleDeclaration>);
  root.setAttribute('aria-hidden', 'true');

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'pluma-improve-star';
  star.hidden = true;
  star.textContent = '★';
  Object.assign(star.style, {
    position: 'absolute',
    pointerEvents: 'auto',
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    lineHeight: '1',
    borderRadius: '6px',
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    padding: '0',
  } satisfies Partial<CSSStyleDeclaration>);
  star.setAttribute('aria-label', translate(lang, 'pluma.improve.star.aria'));

  const popover = document.createElement('div');
  popover.className = 'pluma-improve-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', translate(lang, 'pluma.improve.label'));
  popover.hidden = true;
  Object.assign(popover.style, {
    position: 'absolute',
    pointerEvents: 'auto',
    top: '36px',
    right: '0',
    width: '320px',
    maxWidth: '90vw',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: '8px',
    padding: '12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    zIndex: '51',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.className = 'pluma-improve-label text-[11px] font-semibold text-[var(--color-text-muted)]';
  label.textContent = translate(lang, 'pluma.improve.label');

  const body = document.createElement('div');
  body.className = 'pluma-improve-body';

  const actions = document.createElement('div');
  actions.className = 'pluma-improve-actions flex items-center gap-2';
  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = 'pluma-improve-accept';
  acceptBtn.textContent = translate(lang, 'pluma.improve.accept');
  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'pluma-improve-reject';
  rejectBtn.textContent = translate(lang, 'pluma.improve.reject');
  actions.append(acceptBtn, rejectBtn);

  popover.append(label, body, actions);
  root.append(star, popover);
  deps.anchor.append(root);

  const closePopover = (): void => {
    popover.hidden = true;
    if (pending) {
      pending.ctrl.abort();
      pending = null;
    }
    acceptBtn.disabled = false;
  };

  const positionNearSelection = (range: DocRange | null): void => {
    if (!range) {
      star.hidden = true;
      star.setAttribute('aria-hidden', 'true');
      return;
    }
    const editor = deps.getEditor();
    if (!editor) {
      star.hidden = true;
      return;
    }
    // Approximate the selection viewport position via the anchor's coords.
    // The editor exposes logical ranges, not pixel rects; a coarse but stable
    // placement above the editor's top-right keeps the star visible without a
    // per-selection getBoundingClientRect walk.
    const anchorRect = deps.anchor.getBoundingClientRect();
    star.style.left = `${Math.max(8, anchorRect.width - 48)}px`;
    star.style.top = '8px';
    star.hidden = false;
    star.setAttribute('aria-hidden', 'false');
  };

  const onSelection = (range: DocRange | null): void => {
    activeRange = range;
    if (pending) return; // keep the popover open while a request is in-flight
    positionNearSelection(range);
  };

  const onClickStar = (): void => {
    if (!activeRange) return;
    const editor = deps.getEditor();
    const key = deps.getApiKey();
    if (!editor) return;
    if (!key) {
      showToast(translate(lang, 'pluma.improve.error'), 'error');
      return;
    }
    const text = editor.getSelectionText();
    if (!text.trim()) {
      showToast(translate(lang, 'pluma.improve.empty'), 'warning');
      return;
    }
    star.hidden = true;
    label.textContent = translate(lang, 'pluma.improve.loading');
    body.replaceChildren();
    acceptBtn.disabled = true;
    rejectBtn.textContent = translate(lang, 'pluma.improve.reject');
    popover.hidden = false;

    const ctrl = new AbortController();
    const promise = improveSelection(text, key, { signal: ctrl.signal }).catch((err: unknown) => {
      const msg =
        err instanceof ImproveError ? err.message : translate(lang, 'pluma.improve.error');
      return Promise.reject(new Error(msg));
    });
    pending = { from: activeRange.from, to: activeRange.to, promise, ctrl };

    void promise
      .then((suggestion) => {
        if (!pending) return;
        label.textContent = translate(lang, 'pluma.improve.label');
        body.textContent = suggestion;
        acceptBtn.disabled = false;
      })
      .catch((err: unknown) => {
        if (!pending) return; // aborted by Reject/close
        closePopover();
        const message = err instanceof Error ? err.message : translate(lang, 'pluma.improve.error');
        showToast(message, 'error');
      });
  };

  const onAccept = (): void => {
    if (!pending) return;
    const { from, to, promise } = pending;
    void promise
      .then((suggestion) => {
        const editor = deps.getEditor();
        if (editor) editor.replaceRangeText(from, to, suggestion);
        closePopover();
      })
      .catch(() => {
        // error toast already shown; just close
        closePopover();
      });
  };

  const onReject = (): void => {
    closePopover();
  };

  star.addEventListener('click', onClickStar);
  acceptBtn.addEventListener('click', onAccept);
  rejectBtn.addEventListener('click', onReject);

  // Subscribe to editor selection changes. Re-subscribe on every editor swap
  // — the composition root calls `attach(editor)` after mount.
  let unsubscribe: (() => void) | null = null;
  const subscribe = (editor: EditorHandle): void => {
    if (unsubscribe) unsubscribe();
    unsubscribe = editor.onSelectionChange(onSelection);
  };

  // Best-effort: subscribe to whatever editor is current at construction time.
  const initial = deps.getEditor();
  if (initial) subscribe(initial);

  // Tiny toast helper — avoids importing showToast (kept local to UI module).
  function showToast(message: string, kind: 'error' | 'warning' | 'info'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    deps.toastContainer.append(el);
    window.setTimeout(() => el.remove(), 4000);
  }

  return {
    root,
    setLanguage: (next) => {
      lang = next;
      star.setAttribute('aria-label', translate(lang, 'pluma.improve.star.aria'));
      popover.setAttribute('aria-label', translate(lang, 'pluma.improve.label'));
      acceptBtn.textContent = translate(lang, 'pluma.improve.accept');
      rejectBtn.textContent = translate(lang, 'pluma.improve.reject');
    },
    attach: (editor) => subscribe(editor),
    dispose: () => {
      if (pending) pending.ctrl.abort();
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      root.remove();
    },
  };
}
