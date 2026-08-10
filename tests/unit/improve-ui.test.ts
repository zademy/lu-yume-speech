import { afterEach, describe, expect, it, vi } from 'vitest';

import { createImproveController } from '../../src/escritos/improve-ui';
import type { EditorHandle, DocRange } from '../../src/escritos/editor';

function fakeEditor(opts: { text?: string; range?: DocRange | null }): EditorHandle & {
  replaced: Array<{ from: number; to: number; text: string }>;
  fireSelection: (r: DocRange | null) => void;
} {
  let cb: ((r: DocRange | null) => void) | null = null;
  const replaced: Array<{ from: number; to: number; text: string }> = [];
  const handle: EditorHandle & {
    replaced: typeof replaced;
    fireSelection: (r: DocRange | null) => void;
  } = {
    destroy: async () => {},
    getMarkdown: () => '',
    appendParagraph: () => {},
    getSelectionRange: () => opts.range ?? null,
    getSelectionText: () => opts.text ?? '',
    replaceRangeText: (from, to, text) => replaced.push({ from, to, text }),
    onSelectionChange: (fn) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    replaced,
    fireSelection: (r) => cb?.(r),
  };
  return handle;
}

function makeDeps(editor: EditorHandle | null, apiKey = 'gsk_key') {
  const anchor = document.createElement('div');
  document.body.append(anchor);
  return {
    deps: {
      getEditor: () => editor,
      anchor,
      toastContainer: document.createElement('div'),
      getApiKey: () => apiKey,
      getLang: () => 'en' as const,
    },
    cleanup: () => anchor.remove(),
  };
}

describe('improve-ui controller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides the star when the selection is empty (collapsed)', () => {
    const editor = fakeEditor({ range: null });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);
    editor.fireSelection(null);
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    expect(star.hidden).toBe(true);
    controller.dispose();
    cleanup();
  });

  it('shows the star when a non-empty selection arrives', () => {
    const editor = fakeEditor({ range: { from: 0, to: 5 }, text: 'hello' });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);
    editor.fireSelection({ from: 0, to: 5 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    expect(star.hidden).toBe(false);
    controller.dispose();
    cleanup();
  });

  it('Accept dispatches replaceRangeText with the suggestion and closes the popover', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ text: 'Better.' }) } }],
          }),
          { status: 200 },
        ),
      ),
    );
    const editor = fakeEditor({ range: { from: 3, to: 9 }, text: 'my draft' });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);

    // Open the popover by clicking the star.
    editor.fireSelection({ from: 3, to: 9 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    star.click();

    // Wait for the in-flight improve promise to resolve.
    await new Promise((r) => setTimeout(r, 0));

    const accept = deps.anchor.querySelector('.pluma-improve-accept') as HTMLButtonElement;
    accept.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(editor.replaced).toEqual([{ from: 3, to: 9, text: 'Better.' }]);
    const popover = deps.anchor.querySelector('.pluma-improve-popover') as HTMLElement;
    expect(popover.hidden).toBe(true);
    controller.dispose();
    cleanup();
  });

  it('Reject closes the popover without touching the editor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ text: 'Ignored.' }) } }],
          }),
          { status: 200 },
        ),
      ),
    );
    const editor = fakeEditor({ range: { from: 1, to: 4 }, text: 'abc' });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);

    editor.fireSelection({ from: 1, to: 4 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    star.click();
    await new Promise((r) => setTimeout(r, 0));

    const reject = deps.anchor.querySelector('.pluma-improve-reject') as HTMLButtonElement;
    reject.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(editor.replaced).toEqual([]);
    const popover = deps.anchor.querySelector('.pluma-improve-popover') as HTMLElement;
    expect(popover.hidden).toBe(true);
    controller.dispose();
    cleanup();
  });

  it('shows a toast on Groq error and closes the popover', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 }),
        ),
    );
    const editor = fakeEditor({ range: { from: 0, to: 3 }, text: 'abc' });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);

    editor.fireSelection({ from: 0, to: 3 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    star.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(deps.toastContainer.textContent).toContain('HTTP 500');
    controller.dispose();
    cleanup();
  });

  it('attach() re-binds the subscription to a new editor handle', () => {
    const first = fakeEditor({ range: null });
    const { deps, cleanup } = makeDeps(first);
    const controller = createImproveController(deps);
    const second = fakeEditor({ range: { from: 5, to: 8 }, text: 'xyz' });
    controller.attach(second);
    second.fireSelection({ from: 5, to: 8 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    expect(star.hidden).toBe(false);
    controller.dispose();
    cleanup();
  });

  it('setLanguage() refreshes the star and button labels', () => {
    const editor = fakeEditor({ range: null });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);
    controller.setLanguage('es');
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    expect(star.getAttribute('aria-label')).toContain('Mejorar');
    const reject = deps.anchor.querySelector('.pluma-improve-reject') as HTMLButtonElement;
    expect(reject.textContent).toBe('Rechazar');
    controller.dispose();
    cleanup();
  });

  it('clicking the star with no API key surfaces an error toast', () => {
    const editor = fakeEditor({ range: { from: 0, to: 3 }, text: 'abc' });
    const { deps, cleanup } = makeDeps(editor, '');
    const controller = createImproveController(deps);
    editor.fireSelection({ from: 0, to: 3 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    star.click();
    expect(deps.toastContainer.textContent).toBeTruthy();
    controller.dispose();
    cleanup();
  });

  it('clicking the star with an empty selection surfaces a warning toast', () => {
    const editor = fakeEditor({ range: { from: 0, to: 0 }, text: '' });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);
    editor.fireSelection({ from: 0, to: 0 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    star.click();
    expect(deps.toastContainer.textContent).toBeTruthy();
    controller.dispose();
    cleanup();
  });

  it('hides the star when the editor is null on a selection change', () => {
    const editor = fakeEditor({ range: { from: 0, to: 3 }, text: 'abc' });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);
    (deps as { getEditor: () => EditorHandle | null }).getEditor = () => null;
    editor.fireSelection({ from: 0, to: 3 });
    const star = deps.anchor.querySelector('.pluma-improve-star') as HTMLButtonElement;
    expect(star.hidden).toBe(true);
    controller.dispose();
    cleanup();
  });

  it('dispose() removes the root from the DOM', () => {
    const editor = fakeEditor({ range: null });
    const { deps, cleanup } = makeDeps(editor);
    const controller = createImproveController(deps);
    expect(deps.anchor.querySelector('.pluma-improve-root')).not.toBeNull();
    controller.dispose();
    expect(deps.anchor.querySelector('.pluma-improve-root')).toBeNull();
    cleanup();
  });
});
