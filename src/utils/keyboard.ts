/**
 * Keyboard shortcut manager.
 *
 * Manages global keyboard shortcuts with OS-aware modifier key detection.
 * Supports two recording modes:
 * - **Push-to-talk**: hold modifier+space to record, release to stop
 * - **Toggle**: press modifier+space to start, press again to stop
 *
 * The mode is determined at runtime via a callback so this module
 * stays decoupled from the settings system (DIP).
 *
 * SRP: This module only maps keyboard events to action callbacks.
 * DIP: It accepts callbacks (abstractions), not concrete handlers.
 *
 * The caller owns the lifecycle:
 * ```ts
 * const cleanup = registerKeyboardShortcuts({
 *   onRecordStart,
 *   onRecordStop,
 *   getMode: () => settings.recordMode,
 * });
 * cleanup(); // removes all listeners
 * ```
 */

import { detectOS } from './os-detect';

/** Callbacks the keyboard manager will invoke. */
export interface KeyboardActions {
  /** Called when recording should start. */
  onRecordStart: () => void;
  /** Called when recording should stop. */
  onRecordStop: () => void;
  /** Returns the current recording mode. Called on every keystroke. */
  getMode: () => 'push-to-talk' | 'toggle';
}

/**
 * Register global keyboard shortcuts for audio recording.
 *
 * Shortcut: Alt+Space on macOS, Ctrl+Space elsewhere.
 * Behavior depends on the current recording mode returned by `getMode()`.
 *
 * @returns Cleanup function that removes all event listeners.
 */
export function registerKeyboardShortcuts(actions: KeyboardActions): () => void {
  const os = detectOS();
  let pushToTalkActive = false;
  let toggleActive = false;

  function onKeyDown(event: KeyboardEvent): void {
    const modifierActive = os.isMac ? event.altKey : event.ctrlKey;

    if (modifierActive && event.code === 'Space') {
      event.preventDefault();

      const mode = actions.getMode();

      if (mode === 'toggle') {
        // Toggle mode: first press starts, second press stops
        if (!toggleActive) {
          toggleActive = true;
          actions.onRecordStart();
        } else {
          toggleActive = false;
          actions.onRecordStop();
        }
      } else {
        // Push-to-talk mode: start on key down
        if (!pushToTalkActive) {
          pushToTalkActive = true;
          actions.onRecordStart();
        }
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    // Push-to-talk stop only fires on key release
    if (actions.getMode() !== 'push-to-talk') return;

    const modifierReleased = os.isMac ? event.key === 'Alt' : event.key === 'Control';

    if (event.code === 'Space' || modifierReleased) {
      if (pushToTalkActive) {
        pushToTalkActive = false;
        actions.onRecordStop();
      }
    }
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
  };
}
