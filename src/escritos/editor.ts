/**
 * Milkdown editor integration for Pluma.
 *
 * Wraps `@milkdown/crepe` (batteries-included: toolbar, placeholder, GFM tables,
 * history) into a small lifecycle handle. Markdown is the persistence format:
 * `onChange(md)` fires on every document change (the caller debounces for
 * saves), and `getMarkdown()` reads the current document on demand (T5 will use
 * a ranged variant for AI selection-refine).
 *
 * Doc switching is handled by destroy + remount — cheap, and it avoids the edge
 * cases of in-place `setMarkdown` across ProseMirror transactions.
 *
 * Not unit-tested in jsdom (Crepe/ProseMirror need a real DOM); excluded from
 * coverage. Integration is verified by the production build (Vite bundles Crepe
 * + the Nord theme CSS) and by runtime use in the Pluma view.
 *
 * SRP: this module only bridges the Pluma UI and the Milkdown editor.
 */

import '@milkdown/crepe/theme/nord.css';
import { Crepe } from '@milkdown/crepe';

export interface MountEditorOptions {
  /** Initial markdown loaded into the editor. */
  initialMD: string;
  /** Fired on every markdown change — the caller debounces for persistence. */
  onChange: (markdown: string) => void;
}

export interface EditorHandle {
  /** Destroy the editor and detach its DOM. Safe to call once. */
  destroy: () => Promise<void>;
  /** Read the current document as markdown. */
  getMarkdown: () => string;
}

/**
 * Mount a Milkdown (Crepe) editor into `container`. Resolves with a handle once
 * the editor is ready. The caller owns the container's sibling children; Crepe
 * appends its own DOM inside `container`.
 */
export async function mountEditor(
  container: HTMLElement,
  options: MountEditorOptions,
): Promise<EditorHandle> {
  const crepe = new Crepe({
    root: container,
    defaultValue: options.initialMD,
  });
  crepe.on((api) => {
    api.markdownUpdated((_ctx, markdown, prevMarkdown) => {
      if (markdown !== prevMarkdown) options.onChange(markdown);
    });
  });
  await crepe.create();
  return {
    destroy: async () => {
      try {
        await crepe.destroy();
      } catch {
        /* best-effort during teardown */
      }
    },
    getMarkdown: () => crepe.getMarkdown(),
  };
}
