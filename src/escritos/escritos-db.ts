/**
 * Persistent storage for Escritos (Pluma writer's surface) and their images,
 * backed by IndexedDB via Dexie.
 *
 * Mirrors the `recordings-db` module: lazy singleton connection, CRUD over a
 * typed Dexie store, `__resetForTests` for cross-file isolation. Uses a separate
 * database (`lu-yume-escritos`) so Pluma content is independent of the Grabación
 * store — a Dictar purge never touches documents, and vice versa. Both databases
 * share the origin storage quota reported by `navigator.storage.estimate()`.
 *
 * This module never touches credential or settings storage (owned by
 * `src/platform/` and `src/utils/theme.ts`).
 *
 * Schema (version 1):
 *   escritos  — Escrito rows: id PK, +updatedAt
 *   imagenes  — ImagenEscrito rows: id PK, +escritoId (cascade on escrito delete)
 *
 * SRP: this module's only job is structured persistence of Pluma documents.
 * DIP: consumers depend on these functions, not on Dexie or IndexedDB directly.
 */

import Dexie, { type Table } from 'dexie';
import type { Escrito, ImagenEscrito } from '../types';

class YumeEscritosDB extends Dexie {
  escritos!: Table<Escrito, string>;
  imagenes!: Table<ImagenEscrito, string>;

  constructor() {
    super('lu-yume-escritos');
    this.version(1).stores({
      escritos: 'id, updatedAt',
      imagenes: 'id, escritoId',
    });
  }
}

let dbInstance: YumeEscritosDB | null = null;

/** Lazily open the singleton DB connection. */
function db(): YumeEscritosDB {
  if (!dbInstance) dbInstance = new YumeEscritosDB();
  return dbInstance;
}

/** Drop the cached connection (test helper for isolation across files). */
export function __resetForTests(): void {
  dbInstance?.close();
  dbInstance = null;
}

// ---------------------------------------------------------------------------
// Escritos
// ---------------------------------------------------------------------------

/** Create a new empty escrito and persist it. Returns the created row. */
export async function createEscrito(titulo = ''): Promise<Escrito> {
  const now = Date.now();
  const escrito: Escrito = {
    id: crypto.randomUUID(),
    titulo,
    contenidoMD: '',
    createdAt: now,
    updatedAt: now,
  };
  await db().escritos.put(escrito);
  return escrito;
}

/** All escritos newest-first by `updatedAt` (sidebar-friendly, no image blobs). */
export async function getAllEscritos(): Promise<Escrito[]> {
  const rows = await db().escritos.toArray();
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}

/** One escrito by id, or undefined when missing. */
export async function getEscrito(id: string): Promise<Escrito | undefined> {
  return db().escritos.get(id);
}

/** Rename an escrito. No-op (returns false) when it does not exist. */
export async function renameEscrito(id: string, titulo: string): Promise<boolean> {
  const existing = await db().escritos.get(id);
  if (!existing) return false;
  existing.titulo = titulo;
  existing.updatedAt = Date.now();
  await db().escritos.put(existing);
  return true;
}

/**
 * Update an escrito's markdown body and bump `updatedAt`.
 * No-op (returns false) when it does not exist.
 */
export async function updateContent(id: string, contenidoMD: string): Promise<boolean> {
  const existing = await db().escritos.get(id);
  if (!existing) return false;
  existing.contenidoMD = contenidoMD;
  existing.updatedAt = Date.now();
  await db().escritos.put(existing);
  return true;
}

/**
 * Delete one escrito and cascade-delete its images atomically.
 * No-op when it does not exist.
 */
export async function removeEscrito(id: string): Promise<void> {
  const database = db();
  await database.transaction('rw', database.escritos, database.imagenes, async () => {
    await database.imagenes.where('escritoId').equals(id).delete();
    await database.escritos.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

/** Persist an image belonging to an escrito (referenced as `app-image:<id>`). */
export async function saveImagen(imagen: ImagenEscrito): Promise<void> {
  await db().imagenes.put(imagen);
}

/** Fetch one image by id, or undefined when missing. */
export async function getImagen(id: string): Promise<ImagenEscrito | undefined> {
  return db().imagenes.get(id);
}

/** Delete one image. No-op if it does not exist. */
export async function removeImagen(id: string): Promise<void> {
  await db().imagenes.delete(id);
}

/** All images belonging to an escrito (for node-view resolution / export). */
export async function getImagenesByEscrito(escritoId: string): Promise<ImagenEscrito[]> {
  return db().imagenes.where('escritoId').equals(escritoId).toArray();
}

// ---------------------------------------------------------------------------
// Bulk / maintenance
// ---------------------------------------------------------------------------

/** Delete every escrito and every image (full Pluma reset). */
export async function clearAllEscritos(): Promise<void> {
  const database = db();
  await database.transaction('rw', database.escritos, database.imagenes, async () => {
    await database.escritos.clear();
    await database.imagenes.clear();
  });
}
