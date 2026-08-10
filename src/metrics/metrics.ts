/**
 * Métricas — derived indicators for the Métricas panel.
 *
 * Pure functions over an in-memory snapshot of Grabación metadata. No I/O, no
 * persistence: the caller builds the snapshot from `recordings-db` plus the
 * origin storage estimate, then calls `computeMetrics`. This keeps the math
 * trivially testable and decoupled from Dexie.
 *
 * SRP: this module only computes derived indicators from data.
 */

import type { GrabacionMeta } from '../db/recordings-db';

/** Inputs required to compute the panel indicators. */
export interface MetricsInput {
  metas: readonly GrabacionMeta[];
  resumenesCount: number;
  /** Origin storage usage in bytes (navigator.storage.estimate). */
  storageUsage: number;
  /** Origin storage quota in bytes. */
  storageQuota: number;
}

/** One language with its grabación count, for the idioma breakdown. */
export interface IdiomaCount {
  lang: string;
  count: number;
}

/** Computed indicators. */
export interface MetricsResult {
  grabaciones: { total: number; minutosAudio: number };
  tamaño: { usageBytes: number; quotaBytes: number; pct: number; audioBytes: number };
  resumenes: number;
  idioma: {
    origenTop?: string;
    destinoTop?: string;
    /** Source languages ranked by grabación count (descending). */
    origenes: IdiomaCount[];
  };
  diasDeUso: number;
  /** Per-day counts keyed 'YYYY-MM-DD' (UTC) for the activity heatmap. */
  porDia: Record<string, number>;
  wpm: { promedio: number; refHumanaMin: number; refHumanaMax: number };
  /** Total words dictated across all grabaciones. */
  palabras: { total: number };
  /** Grabación count split by operation mode. */
  modo: { transcribe: number; translate: number };
  /** Usage streaks in days, derived from consecutive active days. */
  racha: { actual: number; masLarga: number };
}

/** Reference human speaking rate (words per minute), shown alongside the user's WPM. */
export const WPM_HUMANO_MIN = 150;
export const WPM_HUMANO_MAX = 200;

/** Count whitespace-separated words in a text (matches the existing word counter). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Derive the Métricas panel indicators from a snapshot of Grabación metadata. */
export function computeMetrics(input: MetricsInput): MetricsResult {
  const { metas, resumenesCount, storageUsage, storageQuota } = input;

  let segundos = 0;
  let audioBytes = 0;
  let palabrasTotal = 0;
  let transcribe = 0;
  let translate = 0;
  const origenCounts = new Map<string, number>();
  const destinoCounts = new Map<string, number>();
  const porDia: Record<string, number> = {};
  const wpms: number[] = [];

  for (const m of metas) {
    segundos += m.duration ?? 0;
    audioBytes += m.audioBytes;
    palabrasTotal += countWords(m.text);
    if (m.operationMode === 'translate') translate++;
    else transcribe++;

    if (m.language) bump(origenCounts, m.language);
    // Target language: the app translates to English; in transcribe mode it stays.
    const destino = m.operationMode === 'translate' ? 'en' : m.language;
    if (destino) bump(destinoCounts, destino);

    const day = dayKey(m.createdAt);
    porDia[day] = (porDia[day] ?? 0) + 1;

    const mins = (m.duration ?? 0) / 60;
    const words = countWords(m.text);
    if (mins > 0 && words > 0) wpms.push(words / mins);
  }

  const wpmPromedio = wpms.length ? wpms.reduce((a, b) => a + b, 0) / wpms.length : 0;
  const pct = storageQuota > 0 ? (storageUsage / storageQuota) * 100 : 0;
  const origenes = [...origenCounts.entries()]
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);

  return {
    grabaciones: { total: metas.length, minutosAudio: segundos / 60 },
    tamaño: { usageBytes: storageUsage, quotaBytes: storageQuota, pct, audioBytes },
    resumenes: resumenesCount,
    idioma: {
      origenTop: topKey(origenCounts),
      destinoTop: topKey(destinoCounts),
      origenes,
    },
    diasDeUso: Object.keys(porDia).length,
    porDia,
    wpm: { promedio: wpmPromedio, refHumanaMin: WPM_HUMANO_MIN, refHumanaMax: WPM_HUMANO_MAX },
    palabras: { total: palabrasTotal },
    modo: { transcribe, translate },
    racha: computeStreaks(porDia),
  };
}

/** Format a byte count as a compact human-readable string (B / KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/**
 * Current and longest usage streaks (in days) from the set of active days.
 *
 * The current streak counts consecutive active days ending today (with a one-day
 * grace window so a streak isn't broken until a full day is missed). The longest
 * streak is the largest run of consecutive active days ever recorded.
 */
export function computeStreaks(porDia: Record<string, number>): {
  actual: number;
  masLarga: number;
} {
  const days = new Set(Object.keys(porDia));
  if (days.size === 0) return { actual: 0, masLarga: 0 };

  // Longest run across all recorded days.
  const sorted = [...days].sort();
  let masLarga = 0;
  let run = 0;
  let prevTs: number | null = null;
  const DAY_MS = 86_400_000;
  for (const d of sorted) {
    const ts = Date.parse(`${d}T00:00:00Z`);
    if (prevTs !== null && ts - prevTs === DAY_MS) run++;
    else run = 1;
    if (run > masLarga) masLarga = run;
    prevTs = ts;
  }

  // Current streak: walk back from today (grace: if today inactive, start yesterday).
  let actual = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor.getTime()))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (days.has(dayKey(cursor.getTime()))) {
    actual++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { actual, masLarga };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Most frequent key in a count map; ties resolved by insertion order. Undefined when empty. */
function topKey(map: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = -1;
  for (const [key, count] of map) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** UTC 'YYYY-MM-DD' for a timestamp — stable across test timezones. */
function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
