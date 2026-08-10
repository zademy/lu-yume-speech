/**
 * Pluma dictation controller (T4).
 *
 * A toggle inside Pluma that reuses the application-wide audio capture +
 * Groq transcription pipeline — no duplicated Recorder/GroqClient. When the
 * toggle is ON, the composition root flips the dictation target to `'pluma'`
 * (see `EventMap['dictation:target']`), so `wireTranscriptionPipeline` stops
 * appending to the Dictar `outputArea` and instead emits `text:append`, which
 * this controller funnels into the open editor as a new paragraph block at the
 * end. Multi-segment sessions accumulate as separate blocks.
 *
 * The caret is never moved: `EditorHandle.appendParagraph` dispatches a
 * transaction without reselecting, so a writer can keep editing mid-document
 * while new dictated paragraphs land below.
 *
 * Settings are inherited from `AppSettings` (model, language, operation mode,
 * LLM post-process) — Pluma does not keep its own voice settings.
 *
 * Architecture: the state machine (`nextDictationState`) is pure and unit-
 * tested; the DOM controller below only wires events to UI elements.
 *
 * SRP: this module only routes the shared capture pipeline into Pluma.
 */

import type { EventBus } from '../core/event-bus';
import type { AppLanguage, EventMap, StatusLevel } from '../types';
import { translate } from '../i18n/translations';
import type { EditorHandle } from './editor';

/** Visible state derived from bus events + the toggle. */
export interface DictationState {
  /** Whether Pluma dictation is armed (button pressed). */
  active: boolean;
  /** Whether the shared recorder is currently capturing audio. */
  recording: boolean;
  /** Status message for the Pluma status bar. */
  message: string;
  /** Visual level for the status pill. */
  level: StatusLevel;
}

/** Events that can mutate the dictation state. */
export type DictationEvent =
  | { type: 'toggle'; nowRecording: boolean }
  | { type: 'recording:start' }
  | { type: 'recording:stop' }
  | { type: 'status'; message: string; level: StatusLevel }
  | { type: 'reset' };

/**
 * Pure state transition for the Pluma dictation toggle. Used by the controller
 * and unit-tested in isolation. The `nowRecording` flag on `toggle` reflects
 * whether the shared recorder actually started — toggling ON when mic access
 * fails must not mark us active.
 */
export function nextDictationState(
  prev: DictationState,
  event: DictationEvent,
  lang: AppLanguage,
): DictationState {
  switch (event.type) {
    case 'toggle': {
      if (prev.active) {
        return {
          active: false,
          recording: event.nowRecording,
          message: translate(lang, 'pluma.dictation.idle'),
          level: 'idle',
        };
      }
      return {
        active: true,
        recording: event.nowRecording,
        message: event.nowRecording
          ? translate(lang, 'pluma.dictation.listening')
          : translate(lang, 'pluma.dictation.armed'),
        level: event.nowRecording ? 'recording' : 'warning',
      };
    }
    case 'recording:start': {
      if (!prev.active) return prev;
      return {
        ...prev,
        recording: true,
        message: translate(lang, 'pluma.dictation.listening'),
        level: 'recording',
      };
    }
    case 'recording:stop': {
      if (!prev.active) return prev;
      return {
        ...prev,
        recording: false,
        message: translate(lang, 'pluma.dictation.processing'),
        level: 'processing',
      };
    }
    case 'status': {
      return { ...prev, message: event.message, level: event.level };
    }
    case 'reset': {
      return {
        active: false,
        recording: false,
        message: translate(lang, 'pluma.dictation.idle'),
        level: 'idle',
      };
    }
  }
}

/** Deps injected by the composition root (DI — no direct imports). */
export interface DictationDeps {
  bus: EventBus<EventMap>;
  /** Start/stop the shared recorder. */
  startRecorder: () => void;
  stopRecorder: () => void;
  /** Returns whether the shared recorder is currently capturing. */
  isRecording: () => boolean;
  /** Latest Pluma editor handle (null when no doc is open). */
  getEditor: () => EditorHandle | null;
  /** Toast container for surfacing errors to the user. */
  toastContainer: HTMLElement;
  /** Current UI language (refreshed on settings:change). */
  getLang: () => AppLanguage;
}

export interface DictationController {
  /** Toggle arm/disarm; flips the dictation target and starts/stops the recorder. */
  toggle: () => void;
  /** Refresh all labels after a language change. */
  setLanguage: (lang: AppLanguage) => void;
  /** Detach bus listeners. */
  dispose: () => void;
  /** The toggle button element (for the panel to mount). */
  readonly root: HTMLElement;
}

/**
 * Build the Pluma dictation toggle + status pill and wire it to the bus.
 *
 * The button lives in the Pluma status bar (decision: status bar over editor
 * toolbar — the toolbar is Crepe-owned and adding buttons there is invasive).
 */
export function createDictationController(deps: DictationDeps): DictationController {
  let lang = deps.getLang();
  let state: DictationState = {
    active: false,
    recording: false,
    message: translate(lang, 'pluma.dictation.idle'),
    level: 'idle',
  };

  const root = document.createElement('div');
  root.className = 'pluma-dictation flex items-center gap-2';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pluma-dictation-toggle';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', translate(lang, 'pluma.dictation.toggle.aria'));

  const dot = document.createElement('span');
  dot.className = 'pluma-dictation-dot';
  const label = document.createElement('span');
  label.textContent = translate(lang, 'pluma.dictation.toggle.start');
  button.append(dot, label);

  const status = document.createElement('span');
  status.className = 'pluma-dictation-status';
  status.setAttribute('role', 'status');
  status.textContent = state.message;

  root.append(button, status);

  const render = (): void => {
    button.setAttribute('aria-pressed', String(state.active));
    button.classList.toggle('is-active', state.active);
    status.dataset.level = state.level;
    status.textContent = state.message;
    label.textContent = state.active
      ? translate(lang, 'pluma.dictation.toggle.stop')
      : translate(lang, 'pluma.dictation.toggle.start');
    dot.dataset.recording = String(state.recording);
  };

  const apply = (next: DictationState): void => {
    state = next;
    render();
  };

  const onToggle = (): void => {
    if (state.active) {
      // Disarm — stop the recorder if it is running.
      if (deps.isRecording()) deps.stopRecorder();
      const next = nextDictationState(state, { type: 'toggle', nowRecording: false }, lang);
      deps.bus.emit('dictation:target', 'output');
      apply(next);
      return;
    }
    // Arm — the composition root's `ensureAudioReady` is the caller's job; we
    // only flip the target and start the recorder. If the recorder is not
    // ready yet (mic still initializing), `recording:start` will arrive later
    // via the bus and `nextDictationState` will move us to `recording`.
    deps.bus.emit('dictation:target', 'pluma');
    try {
      deps.startRecorder();
    } catch (err) {
      console.warn('[Pluma] dictation start failed:', err);
      apply(nextDictationState(state, { type: 'reset' }, lang));
      deps.bus.emit('dictation:target', 'output');
      return;
    }
    apply(nextDictationState(state, { type: 'toggle', nowRecording: deps.isRecording() }, lang));
  };

  button.addEventListener('click', onToggle);

  // Bus wiring — append text + reflect recorder lifecycle.
  const offAppend = deps.bus.on('text:append', (text) => {
    if (!state.active) return;
    const editor = deps.getEditor();
    if (!editor) return;
    editor.appendParagraph(text);
  });

  const offStart = deps.bus.on('recording:start', () => {
    apply(nextDictationState(state, { type: 'recording:start' }, lang));
  });
  const offStop = deps.bus.on('recording:stop', () => {
    apply(nextDictationState(state, { type: 'recording:stop' }, lang));
  });
  const offStatus = deps.bus.on('status:change', (update) => {
    // Only surface processing/error/success messages — the global pipeline
    // also emits idle ones that are not relevant to Pluma.
    if (update.level === 'idle') return;
    apply(nextDictationState(state, { type: 'status', ...update }, lang));
  });

  render();

  return {
    root,
    toggle: onToggle,
    setLanguage: (next) => {
      lang = next;
      apply(nextDictationState(state, { type: 'reset' }, lang));
    },
    dispose: () => {
      offAppend();
      offStart();
      offStop();
      offStatus();
    },
  };
}
