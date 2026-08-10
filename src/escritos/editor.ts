/**
 * Milkdown editor integration for Pluma.
 *
 * Wraps `@milkdown/crepe` (batteries-included: toolbar, placeholder, GFM tables,
 * history, image paste/drop) into a small lifecycle handle. Markdown is the
 * persistence format: `onChange(md)` fires on every document change (caller
 * debounces for saves), and `getMarkdown()` reads the current document on
 * demand.
 *
 * Images are persisted offline as blobs in Dexie and referenced in markdown as
 * `app-image:<id>` (see `./images.ts`). On mount those stable refs are hydrated
 * into displayable object URLs; on every change/save the object URLs are
 * serialized back to the stable form. This keeps documents reload-safe without
 * a custom ProseMirror node view.
 *
 * Doc switching is handled by destroy + remount — cheap, and it avoids the edge
 * cases of in-place `setMarkdown` across ProseMirror transactions.
 *
 * Selection-aware operations power T4 (dictation append) and T5 (AI improve):
 * `appendParagraph` adds a new block at doc end without disturbing the caret;
 * `getSelectionRange`/`getSelectionText`/`replaceRangeText` drive the improve
 * popover; `onSelectionChange` notifies the star trigger.
 *
 * Not unit-tested in jsdom (Crepe/ProseMirror need a real DOM); excluded from
 * coverage. The pure transforms live in `./images.ts`, `./dictation.ts` and
 * `./improve.ts` (covered). Editor integration is verified by the production
 * build + runtime.
 *
 * SRP: this module only bridges the Pluma UI and the Milkdown editor.
 */

import '@milkdown/crepe/theme/nord.css';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Transaction } from '@milkdown/kit/prose/state';

import { type ImageAdapter, hydrateImages, serializeImages } from './images';

export interface MountEditorOptions {
  /** Initial markdown loaded into the editor (with `app-image:<id>` refs). */
  initialMD: string;
  /** Fired with serialized markdown on every change — the caller debounces. */
  onChange: (markdown: string) => void;
  /** Owning escrito id — required when `images` is provided (persists pastes). */
  escritoId?: string;
  /** Image persistence adapter; when omitted, pastes use Crepe's default blob URLs. */
  images?: ImageAdapter;
}

/** A half-open ProseMirror document range. */
export interface DocRange {
  /** Inclusive start offset (0-based, ProseMirror position). */
  from: number;
  /** Exclusive end offset. */
  to: number;
}

export interface EditorHandle {
  /** Destroy the editor, revoke object URLs, detach DOM. Safe to call once. */
  destroy: () => Promise<void>;
  /** Read the current document as serialized markdown (stable `app-image:` refs). */
  getMarkdown: () => string;
  /**
   * Append `text` as a new paragraph block at the end of the document. The
   * caret/selection is NOT moved — callers that had a cursor stay where they
   * were. Used by dictation append (T4).
   */
  appendParagraph: (text: string) => void;
  /** Current selection range, or `null` when the editor has no selection. */
  getSelectionRange: () => DocRange | null;
  /** Plain-text content of the current selection (empty when collapsed). */
  getSelectionText: () => string;
  /**
   * Replace the half-open `[from, to)` range with `text`, dispatching a single
   * ProseMirror transaction. Used by AI improve Accept (T5). No-op when the
   * editor is unavailable.
   */
  replaceRangeText: (from: number, to: number, text: string) => void;
  /**
   * Subscribe to selection changes inside the editor. Returns an unsubscribe
   * function. The callback receives the latest range (null when collapsed).
   */
  onSelectionChange: (cb: (range: DocRange | null) => void) => () => void;
}

/**
 * Mount a Milkdown (Crepe) editor into `container`. Resolves with a handle once
 * the editor is ready. When `images` + `escritoId` are supplied, pasted/dropped
 * images persist as blobs and the document round-trips `app-image:<id>` refs.
 */
export async function mountEditor(
  container: HTMLElement,
  options: MountEditorOptions,
): Promise<EditorHandle> {
  const images = options.images;
  const escritoId = options.escritoId;
  const useImages = Boolean(images && escritoId);
  let objectToId = new Map<string, string>();

  // Hydrate persisted app-image refs into displayable object URLs.
  let initialMD = options.initialMD;
  if (useImages && images) {
    const hydrated = await hydrateImages(options.initialMD, images);
    initialMD = hydrated.md;
    objectToId = hydrated.objectToId;
  }

  const serialize = (md: string): string => serializeImages(md, objectToId);

  const crepe = new Crepe({
    root: container,
    defaultValue: initialMD,
    ...(images && escritoId
      ? {
          featureConfigs: {
            [Crepe.Feature.ImageBlock]: {
              onUpload: async (file: File) => {
                const id = await images.saveImage(file, escritoId);
                const obj = URL.createObjectURL(file);
                objectToId.set(obj, id);
                return obj;
              },
            },
          },
        }
      : {}),
  });

  crepe.on((api) => {
    api.markdownUpdated((_ctx, markdown, prevMarkdown) => {
      if (markdown !== prevMarkdown) options.onChange(serialize(markdown));
    });
  });
  await crepe.create();

  // Selection listeners for T5 (improve star). Wired once on mount; each
  // callback is notified on every ProseMirror transaction that may have moved
  // the selection.
  const selectionListeners = new Set<(range: DocRange | null) => void>();
  const readSelection = (): DocRange | null => {
    const view = crepe.editor.ctx.get(editorViewCtx);
    const { selection } = view.state;
    return selection.empty || selection.to === selection.from
      ? null
      : { from: selection.from, to: selection.to };
  };
  const notifySelection = (): void => {
    const range = readSelection();
    for (const cb of selectionListeners) {
      try {
        cb(range);
      } catch {
        /* listener error must not break others */
      }
    }
  };
  // Observe transactions on the view to fan-out selection notifications.
  // We override `dispatchTransaction` the idiomatic ProseMirror way: apply the
  // transaction ourselves via `updateState(state.apply(tr))` — which does NOT
  // re-enter `dispatchTransaction` — instead of calling `view.dispatch`, which
  // would re-invoke this override and recurse (RangeError: Maximum call stack).
  const view0 = crepe.editor.ctx.get(editorViewCtx);
  const userDispatch = (view0.props as { dispatchTransaction?: (tr: Transaction) => void })
    .dispatchTransaction;
  view0.setProps({
    dispatchTransaction(tr) {
      if (userDispatch) userDispatch(tr);
      else view0.updateState(view0.state.apply(tr));
      notifySelection();
    },
  });

  /** Append `text` as a new paragraph block at doc end, caret untouched. */
  const appendParagraph = (text: string): void => {
    if (!text.trim()) return;
    const view = crepe.editor.ctx.get(editorViewCtx);
    const { state } = view;
    const schema = state.schema;
    const paragraphType = schema.nodes.paragraph;
    if (!paragraphType) return;
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const tr = state.tr;
    const end = state.doc.content.size;
    let pos = end;
    // Ensure a block boundary before the appended content when the doc does
    // not already end on one (e.g. empty doc).
    const needsGap = end > 0;
    for (const [i, lineRaw] of lines.entries()) {
      const line = lineRaw;
      if (i > 0 || needsGap) {
        // Inserting a fresh empty paragraph node keeps block boundaries clean
        // rather than gluing text onto the tail of the last block.
        const gap = paragraphType.create();
        tr.insert(pos, gap);
        pos += gap.nodeSize;
      }
      const textNode = schema.text(line);
      const para = paragraphType.create(null, textNode);
      tr.insert(pos, para);
      pos += para.nodeSize;
    }
    // Do NOT scroll the selection — the user's caret stays where it was.
    view.dispatch(tr);
  };

  const getSelectionRange = (): DocRange | null => {
    const view = crepe.editor.ctx.get(editorViewCtx);
    const { selection } = view.state;
    if (selection.empty || selection.to === selection.from) return null;
    return { from: selection.from, to: selection.to };
  };

  const getSelectionText = (): string => {
    const view = crepe.editor.ctx.get(editorViewCtx);
    const { selection, doc } = view.state;
    if (selection.empty) return '';
    return doc.textBetween(selection.from, selection.to, '\n');
  };

  const replaceRangeText = (from: number, to: number, text: string): void => {
    const view = crepe.editor.ctx.get(editorViewCtx);
    let tr = view.state.tr;
    if (from < 0 || to < from || to > view.state.doc.content.size) return;
    tr = tr.insertText(text, from, to);
    view.dispatch(tr);
  };

  const onSelectionChange = (cb: (range: DocRange | null) => void): (() => void) => {
    selectionListeners.add(cb);
    return () => {
      selectionListeners.delete(cb);
    };
  };

  return {
    destroy: async () => {
      selectionListeners.clear();
      for (const obj of objectToId.keys()) URL.revokeObjectURL(obj);
      objectToId.clear();
      try {
        await crepe.destroy();
      } catch {
        /* best-effort during teardown */
      }
    },
    getMarkdown: () => serialize(crepe.getMarkdown()),
    appendParagraph,
    getSelectionRange,
    getSelectionText,
    replaceRangeText,
    onSelectionChange,
  };
}
