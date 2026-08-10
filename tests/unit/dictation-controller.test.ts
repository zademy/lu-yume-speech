import { describe, expect, it } from 'vitest';

import { EventBus } from '../../src/core/event-bus';
import type { EventMap, AppLanguage } from '../../src/types';
import { createDictationController } from '../../src/escritos/dictation';
import type { EditorHandle } from '../../src/escritos/editor';

/**
 * The dictation controller wires the shared EventBus to a Pluma editor. We
 * verify the multi-segment append contract: each `text:append` while armed
 * produces a separate `appendParagraph` call in arrival order, and the editor
 * is never called while disarmed.
 */
function fakeEditor(): EditorHandle & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    destroy: async () => {},
    getMarkdown: () => '',
    appendParagraph: (text: string) => calls.push(text),
    getSelectionRange: () => null,
    getSelectionText: () => '',
    replaceRangeText: () => {},
    onSelectionChange: () => () => {},
  };
}

function makeDeps(editor: EditorHandle) {
  let recording = false;
  return {
    bus: new EventBus<EventMap>(),
    startRecorder: () => {
      recording = true;
      return Promise.resolve();
    },
    stopRecorder: () => {
      recording = false;
    },
    isRecording: () => recording,
    getEditor: () => editor,
    toastContainer: document.createElement('div'),
    getLang: (): AppLanguage => 'en',
  };
}

describe('dictation controller', () => {
  it('appends each text:append as a separate paragraph while armed, in order', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);

    // Disarmed — events are ignored.
    deps.bus.emit('text:append', 'before');
    expect(editor.calls).toEqual([]);

    // Arm: toggle ON. startRecorder is called synchronously.
    controller.toggle();
    expect(deps.isRecording()).toBe(true);

    deps.bus.emit('text:append', 'first');
    deps.bus.emit('text:append', 'second');
    deps.bus.emit('text:append', 'third');

    expect(editor.calls).toEqual(['first', 'second', 'third']);

    // Disarm while recording — pendingAppend keeps the next text:append alive
    // because the Groq round-trip may still be in flight.
    controller.toggle();
    expect(deps.isRecording()).toBe(false);
    deps.bus.emit('text:append', 'after');
    expect(editor.calls).toEqual(['first', 'second', 'third', 'after']);

    controller.dispose();
  });

  it('emits dictation:target pluma when armed; output only after transcription lands', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const targets: Array<'output' | 'pluma'> = [];
    deps.bus.on('dictation:target', (t) => targets.push(t));
    const controller = createDictationController(deps);

    controller.toggle(); // arm → 'pluma'
    controller.toggle(); // disarm while recording → target stays 'pluma' (pendingAppend)
    expect(targets).toEqual(['pluma']);

    // Transcription lands → append + target released to 'output'
    deps.bus.emit('text:append', 'hello');
    expect(targets).toEqual(['pluma', 'output']);

    controller.dispose();
  });

  it('does not append when the editor is null', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);
    // Simulate "no doc open" by swapping the editor getter.
    (deps as { getEditor: () => EditorHandle | null }).getEditor = () => null;
    controller.toggle();
    deps.bus.emit('text:append', 'ignored');
    expect(editor.calls).toEqual([]);
    controller.dispose();
  });

  it('toggle returns to idle when startRecorder fails', async () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    deps.startRecorder = () => Promise.reject(new Error('mic denied'));
    const controller = createDictationController(deps);
    controller.toggle();
    // startRecorder is async — wait for the rejection handler to reset.
    await new Promise((r) => setTimeout(r, 0));
    expect(
      controller.root.querySelector('.pluma-dictation-toggle')?.getAttribute('aria-pressed'),
    ).toBe('false');
    controller.dispose();
  });

  it('setLanguage re-renders labels with Spanish strings', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);
    controller.setLanguage('es');
    const status = controller.root.querySelector('.pluma-dictation-status');
    expect(status?.textContent).toContain('reposo');
    controller.dispose();
  });

  it('reflects recording:stop with processing status when armed', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);
    controller.toggle(); // arm
    deps.bus.emit('recording:stop', undefined);
    const status = controller.root.querySelector('.pluma-dictation-status');
    expect(status?.textContent).toContain('Transcrib'); // "Transcribing…"
    controller.dispose();
  });

  it('ignores status:change with idle level', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);
    controller.toggle(); // arm
    const before = controller.root.querySelector('.pluma-dictation-status')?.textContent;
    deps.bus.emit('status:change', { message: 'should be ignored', level: 'idle' });
    const after = controller.root.querySelector('.pluma-dictation-status')?.textContent;
    expect(after).toBe(before);
    controller.dispose();
  });

  it('surfaces non-idle status:change updates', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);
    controller.toggle(); // arm
    // 'processing' level is replaced by the i18n label (never shows technical
    // pipeline text like "Procesando con whisper-large-v3-turbo..."), so we
    // test the passthrough with a 'warning' level instead.
    deps.bus.emit('status:change', { message: 'Custom status', level: 'warning' });
    const status = controller.root.querySelector('.pluma-dictation-status');
    expect(status?.textContent).toBe('Custom status');
    expect(status?.getAttribute('data-level')).toBe('warning');
    controller.dispose();
  });

  it('replaces processing status with i18n label (no technical model name)', () => {
    const editor = fakeEditor();
    const deps = makeDeps(editor);
    const controller = createDictationController(deps);
    controller.toggle(); // arm
    deps.bus.emit('status:change', {
      message: 'Procesando con whisper-large-v3-turbo...',
      level: 'processing',
    });
    const status = controller.root.querySelector('.pluma-dictation-status');
    // Must show the clean i18n label, never the pipeline's technical text.
    expect(status?.textContent).toBe('Transcribing…');
    expect(status?.textContent).not.toContain('whisper');
    expect(status?.getAttribute('data-level')).toBe('processing');
    controller.dispose();
  });
});
