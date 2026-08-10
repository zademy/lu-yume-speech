import { describe, it, expect } from 'vitest';
import { computeMetrics, countWords, formatBytes } from '../../src/metrics/metrics';
import type { GrabacionMeta } from '../../src/db/recordings-db';

function meta(
  over: Partial<GrabacionMeta> & Pick<GrabacionMeta, 'id' | 'createdAt'>,
): GrabacionMeta {
  return {
    text: '',
    language: undefined,
    model: 'whisper-large-v3-turbo',
    duration: undefined,
    operationMode: 'transcribe',
    audioBytes: 0,
    audioMimeType: 'audio/webm',
    ...over,
  } as GrabacionMeta;
}

const DAY1 = Date.UTC(2026, 0, 10, 12, 0, 0); // 2026-01-10
const DAY1_LATER = Date.UTC(2026, 0, 10, 18, 0, 0); // 2026-01-10
const DAY2 = Date.UTC(2026, 0, 11, 9, 0, 0); // 2026-01-11

describe('metrics — computeMetrics', () => {
  it('returns zeroed indicators for an empty snapshot', () => {
    const result = computeMetrics({
      metas: [],
      resumenesCount: 0,
      storageUsage: 0,
      storageQuota: 0,
    });

    expect(result.grabaciones).toEqual({ total: 0, minutosAudio: 0 });
    expect(result.tamaño).toEqual({ usageBytes: 0, quotaBytes: 0, pct: 0, audioBytes: 0 });
    expect(result.resumenes).toBe(0);
    expect(result.idioma.origenTop).toBeUndefined();
    expect(result.idioma.destinoTop).toBeUndefined();
    expect(result.idioma.origenes).toEqual([]);
    expect(result.diasDeUso).toBe(0);
    expect(result.porDia).toEqual({});
    expect(result.wpm.promedio).toBe(0);
  });

  it('aggregates totals, top languages, per-day counts and average WPM', () => {
    const metas: GrabacionMeta[] = [
      meta({
        id: 'g1',
        createdAt: DAY1,
        duration: 120,
        language: 'es',
        operationMode: 'transcribe',
        text: 'uno dos tres cuatro cinco', // 5 words
        audioBytes: 100,
      }),
      meta({
        id: 'g2',
        createdAt: DAY1_LATER,
        duration: 60,
        language: 'es',
        operationMode: 'transcribe',
        text: 'alpha beta', // 2 words
        audioBytes: 200,
      }),
      meta({
        id: 'g3',
        createdAt: DAY2,
        duration: 0, // no duration -> excluded from WPM
        language: 'en',
        operationMode: 'translate',
        text: 'hello world', // 2 words
        audioBytes: 50,
      }),
    ];

    const result = computeMetrics({
      metas,
      resumenesCount: 4,
      storageUsage: 500,
      storageQuota: 1000,
    });

    expect(result.grabaciones).toEqual({ total: 3, minutosAudio: 3 }); // (120+60)/60
    expect(result.tamaño).toEqual({
      usageBytes: 500,
      quotaBytes: 1000,
      pct: 50,
      audioBytes: 350,
    });
    expect(result.resumenes).toBe(4);
    // origen: es=2, en=1 -> es. destino: g1/g2 transcribe->es(2), g3 translate->en(1) -> es.
    expect(result.idioma.origenTop).toBe('es');
    expect(result.idioma.destinoTop).toBe('es');
    expect(result.idioma.origenes).toEqual([
      { lang: 'es', count: 2 },
      { lang: 'en', count: 1 },
    ]);
    expect(result.diasDeUso).toBe(2);
    expect(result.porDia).toEqual({ '2026-01-10': 2, '2026-01-11': 1 });
    // WPM: g1 = 5/2 = 2.5 ; g2 = 2/1 = 2 ; g3 excluded. avg = (2.5+2)/2 = 2.25
    expect(result.wpm.promedio).toBeCloseTo(2.25, 5);
    expect(result.wpm.refHumanaMin).toBe(150);
    expect(result.wpm.refHumanaMax).toBe(200);
    expect(result.palabras).toEqual({ total: 9 }); // 5 + 2 + 2
    expect(result.modo).toEqual({ transcribe: 2, translate: 1 });
    expect(result.racha).toEqual({ actual: 0, masLarga: 2 }); // DAY1+DAY2 consecutive, not today
  });

  it('uses "en" as the target language for translations', () => {
    const metas: GrabacionMeta[] = [
      meta({ id: 'g1', createdAt: DAY1, language: 'ja', operationMode: 'translate' }),
      meta({ id: 'g2', createdAt: DAY1, language: 'zh', operationMode: 'translate' }),
    ];
    const result = computeMetrics({ metas, resumenesCount: 0, storageUsage: 0, storageQuota: 0 });
    // both translate -> destino 'en' wins (2); origen is split (ja=1, zh=1) -> insertion order 'ja'.
    expect(result.idioma.destinoTop).toBe('en');
    expect(result.idioma.origenTop).toBe('ja');
  });

  it('pct is zero when quota is unavailable', () => {
    const result = computeMetrics({
      metas: [meta({ id: 'g1', createdAt: DAY1, audioBytes: 99 })],
      resumenesCount: 0,
      storageUsage: 99,
      storageQuota: 0,
    });
    expect(result.tamaño.pct).toBe(0);
    expect(result.tamaño.audioBytes).toBe(99);
  });
});

describe('metrics — helpers', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('hola mundo')).toBe(2);
    expect(countWords('  uno   dos\ttres ')).toBe(3);
  });

  it('formats byte counts in the smallest fitting unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(Math.pow(1024, 3))).toBe('1.0 GB');
  });
});
