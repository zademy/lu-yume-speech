import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { registerKeyboardShortcuts, type KeyboardActions } from '../../src/utils/keyboard';

function dispatchKey(
  type: 'keydown' | 'keyup',
  init: { code?: string; key?: string; altKey?: boolean; ctrlKey?: boolean },
): void {
  document.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
}

describe('registerKeyboardShortcuts', () => {
  let cleanup: (() => void) | null;

  beforeEach(() => {
    cleanup = null;
  });

  afterEach(() => {
    cleanup?.();
  });

  it('toggle mode: first keydown starts recording, second stops', () => {
    const start = vi.fn();
    const stop = vi.fn();
    const actions: KeyboardActions = {
      onRecordStart: start,
      onRecordStop: stop,
      getMode: () => 'toggle',
    };

    cleanup = registerKeyboardShortcuts(actions);

    dispatchKey('keydown', { code: 'Space', ctrlKey: true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    dispatchKey('keydown', { code: 'Space', ctrlKey: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('push-to-talk: keydown starts, keyup stops', () => {
    const start = vi.fn();
    const stop = vi.fn();
    const actions: KeyboardActions = {
      onRecordStart: start,
      onRecordStop: stop,
      getMode: () => 'push-to-talk',
    };

    cleanup = registerKeyboardShortcuts(actions);

    dispatchKey('keydown', { code: 'Space', ctrlKey: true });
    expect(start).toHaveBeenCalledTimes(1);

    dispatchKey('keyup', { code: 'Space' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('push-to-talk: releasing modifier also stops', () => {
    const stop = vi.fn();
    const actions: KeyboardActions = {
      onRecordStart: vi.fn(),
      onRecordStop: stop,
      getMode: () => 'push-to-talk',
    };

    cleanup = registerKeyboardShortcuts(actions);

    dispatchKey('keydown', { code: 'Space', ctrlKey: true });
    dispatchKey('keyup', { key: 'Control' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('push-to-talk: keyup in toggle mode does nothing', () => {
    const stop = vi.fn();
    const actions: KeyboardActions = {
      onRecordStart: vi.fn(),
      onRecordStop: stop,
      getMode: () => 'toggle',
    };

    cleanup = registerKeyboardShortcuts(actions);

    dispatchKey('keyup', { code: 'Space' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('calls preventDefault on shortcut match', () => {
    const actions: KeyboardActions = {
      onRecordStart: vi.fn(),
      onRecordStop: vi.fn(),
      getMode: () => 'toggle',
    };

    cleanup = registerKeyboardShortcuts(actions);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      code: 'Space',
      ctrlKey: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('ignores non-matching keys', () => {
    const start = vi.fn();
    const actions: KeyboardActions = {
      onRecordStart: start,
      onRecordStop: vi.fn(),
      getMode: () => 'toggle',
    };

    cleanup = registerKeyboardShortcuts(actions);

    dispatchKey('keydown', { code: 'Enter', ctrlKey: true });
    dispatchKey('keydown', { code: 'Space', ctrlKey: false });
    expect(start).not.toHaveBeenCalled();
  });

  it('cleanup removes all listeners', () => {
    const start = vi.fn();
    const actions: KeyboardActions = {
      onRecordStart: start,
      onRecordStop: vi.fn(),
      getMode: () => 'toggle',
    };

    cleanup = registerKeyboardShortcuts(actions);
    cleanup();
    cleanup = null;

    dispatchKey('keydown', { code: 'Space', ctrlKey: true });
    expect(start).not.toHaveBeenCalled();
  });
});
