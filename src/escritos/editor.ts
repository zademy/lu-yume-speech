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
 * Not unit-tested in jsdom (Crepe/ProseMirror need a real DOM); excluded from
 * coverage. The pure image transforms live in `./images.ts` (covered). Editor
 * integration is verified by the production build + runtime.
 *
 * SRP: this module only bridges the Pluma UI and the Milkdown editor.
 */

import '@milkdown/crepe/theme/nord.css';
import { Crepe } from '@milkdown/crepe';

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

export interface EditorHandle {
  /** Destroy the editor, revoke object URLs, detach DOM. Safe to call once. */
  destroy: () => Promise<void>;
  /** Read the current document as serialized markdown (stable `app-image:` refs). */
  getMarkdown: () => string;
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

  return {
    destroy: async () => {
      for (const obj of objectToId.keys()) URL.revokeObjectURL(obj);
      objectToId.clear();
      try {
        await crepe.destroy();
      } catch {
        /* best-effort during teardown */
      }
    },
    getMarkdown: () => serialize(crepe.getMarkdown()),
  };
}
