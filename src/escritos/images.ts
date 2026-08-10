/**
 * Image persistence helpers for Pluma.
 *
 * Markdown stores images as `![alt](app-image:<id>)` — a stable, offline
 * reference to a blob in Dexie. At editor-mount time those refs are hydrated
 * into displayable object URLs; at serialize time object URLs are rewritten
 * back to the stable form. This keeps documents reload-safe without a custom
 * ProseMirror node view: the editor only ever sees displayable URLs, while
 * persistence only ever sees the stable refs.
 *
 * SRP: pure(ish) transforms over markdown + the persistence adapter contract.
 */

export const APP_IMAGE_PREFIX = 'app-image:';
const APP_IMAGE_RE = /!\[([^\]]*)\]\(app-image:([^)]+)\)/g;

/** Adapter the editor uses to load/persist image blobs (backed by escritos-db). */
export interface ImageAdapter {
  /** Load a previously stored image blob by its stable id (null if missing). */
  loadBlob(id: string): Promise<Blob | null>;
  /** Persist a new image and return its stable id (referenced as `app-image:<id>`). */
  saveImage(file: File, escritoId: string): Promise<string>;
}

/** Stable ids referenced as `app-image:<id>` anywhere in a markdown string. */
export function extractImageIds(md: string): string[] {
  const ids = new Set<string>();
  for (const match of md.matchAll(APP_IMAGE_RE)) {
    const id = match[2];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Rewrite displayable object URLs back to `app-image:<id>` for persistence. */
export function serializeImages(md: string, objectToId: Map<string, string>): string {
  let out = md;
  for (const [obj, id] of objectToId) {
    if (obj && id) out = out.split(obj).join(APP_IMAGE_PREFIX + id);
  }
  return out;
}

/** Result of hydrating stable refs into displayable object URLs. */
export interface HydratedImages {
  md: string;
  idToObject: Map<string, string>;
  objectToId: Map<string, string>;
}

/** Hydrate `app-image:<id>` refs into object URLs by resolving blobs via the adapter. */
export async function hydrateImages(
  md: string,
  adapter: Pick<ImageAdapter, 'loadBlob'>,
): Promise<HydratedImages> {
  const idToObject = new Map<string, string>();
  const objectToId = new Map<string, string>();
  const ids = extractImageIds(md);
  await Promise.all(
    ids.map(async (id) => {
      const blob = await adapter.loadBlob(id);
      if (!blob) return;
      const obj = URL.createObjectURL(blob);
      idToObject.set(id, obj);
      objectToId.set(obj, id);
    }),
  );
  let hydrated = md;
  for (const [id, obj] of idToObject) {
    hydrated = hydrated.split(APP_IMAGE_PREFIX + id).join(obj);
  }
  return { md: hydrated, idToObject, objectToId };
}
