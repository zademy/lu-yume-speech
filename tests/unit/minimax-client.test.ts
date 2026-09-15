// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers } from '../helpers/msw-handlers';
import {
  MiniMaxClient,
  MINIMAX_ENDPOINT,
  MINIMAX_MAX_REQUEST_BYTES,
  fragmentTimeoutMs,
} from '../../src/api/minimax-client';
import { MINIMAX_ASR_MODEL, TranscriptionApiError } from '../../src/types';
import { REQUEST_TIMEOUT_MS } from '../../src/api/transcription-provider';
import { EventBus } from '../../src/core/event-bus';
import type { EventMap } from '../../src/types';
import type { TranscriptionRequest } from '../../src/api/transcription-provider';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Tiny fake sample rate keeps long-recording fixtures small (1 sample = 1 ms). */
const RATE = 1_000;

function samplesOf(seconds: number, amplitude = 0): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  if (amplitude !== 0) samples.fill(amplitude);
  return samples;
}

/** Encoder fake: the uploaded file encodes fragment length + first sample. */
const encoderFake = (samples: Float32Array): Blob =>
  new Blob([`frag:${samples.length}:${samples[0] ?? 0}`], { type: 'audio/wav' });

function createClient(
  apiKey = 'minimax-secret-key',
  decode: () => Promise<{ samples: Float32Array; sampleRate: number }> = async () => ({
    samples: samplesOf(2),
    sampleRate: RATE,
  }),
  encode = encoderFake,
): {
  client: MiniMaxClient;
  bus: EventBus<EventMap>;
} {
  const bus = new EventBus<EventMap>();
  return { client: new MiniMaxClient(bus, () => apiKey, decode, encode), bus };
}

/** Client over a long all-speech recording (hard cuts, N = ceil(seconds/500)). */
function createLongClient(
  seconds: number,
  texts?: string[],
): { client: MiniMaxClient; bus: EventBus<EventMap>; files: string[] } {
  const files: string[] = [];
  let call = 0;
  const bus = new EventBus<EventMap>();
  const client = new MiniMaxClient(
    bus,
    () => 'k',
    async () => ({ samples: samplesOf(seconds, 1), sampleRate: RATE }),
    encoderFake,
  );
  server.use(
    http.post(MINIMAX_ENDPOINT, async ({ request }) => {
      const form = await request.formData();
      const file = form.get('file');
      files.push(file instanceof File ? await file.text() : 'not-a-file');
      return HttpResponse.json({
        text: texts ? (texts[call++] ?? 'x') : 'minimax hello',
        duration: 1,
      });
    }),
  );
  return { client, bus, files };
}

const request: TranscriptionRequest = {
  mode: 'transcribe',
  model: 'whisper-large-v3-turbo',
  language: 'es',
  temperature: 0,
  responseFormat: 'json',
};

const blob = () => new Blob(['recorded-audio'], { type: 'audio/webm' });

/** Capture one file payload per MiniMax POST. */
function captureFiles(): string[] {
  const files: string[] = [];
  server.use(
    http.post(MINIMAX_ENDPOINT, async ({ request }) => {
      const form = await request.formData();
      const file = form.get('file');
      files.push(file instanceof File ? await file.text() : 'not-a-file');
      return HttpResponse.json({ text: 'minimax hello', duration: 1 });
    }),
  );
  return files;
}

describe('MiniMaxClient — single-fragment recordings', () => {
  it('normalizes a successful response into text + duration', async () => {
    const { client } = createClient();
    const result = await client.transcribe(blob(), request);
    expect(result.text).toBe('minimax hello');
    expect(result.duration).toBe(2);
    expect(result.language).toBeUndefined();
    expect(result.segments).toBeUndefined();
  });

  it('sends multipart form with asr-1.0, the encoded WAV file and Bearer auth', async () => {
    let captured: {
      auth: string | null;
      contentType: string | null;
      language: string | null;
      form: FormData;
      file: File | null;
    } | null = null;
    server.use(
      http.post(MINIMAX_ENDPOINT, async ({ request }) => {
        const form = await request.formData();
        const file = form.get('file');
        captured = {
          auth: request.headers.get('Authorization'),
          contentType: request.headers.get('Content-Type'),
          language: request.headers.get('language'),
          form,
          file: file instanceof File ? file : null,
        };
        return HttpResponse.json({ text: 'ok', duration: 1 });
      }),
    );
    const { client } = createClient('minimax-key-123');
    await client.transcribe(blob(), request);

    expect(captured!.auth).toBe('Bearer minimax-key-123');
    expect(captured!.contentType).toMatch(/^multipart\/form-data/);
    expect(captured!.language).toBe('es');
    expect(captured!.form.get('model')).toBe(MINIMAX_ASR_MODEL);
    expect(captured!.form.get('response_format')).toBe('json');
    expect(captured!.form.get('stream')).toBe('false');
    expect(captured!.file).not.toBeNull();
    expect(captured!.file!.name).toBe('audio.wav');
    expect(await (captured!.file as File).text()).toBe('frag:2000:0');
  });

  it('sends exactly what the encoder produced — never the raw recording', async () => {
    const files = captureFiles();
    const { client } = createClient(
      'k',
      async () => ({ samples: samplesOf(1).fill(0.5), sampleRate: RATE }),
      (samples) => new Blob([`enc:${samples.length}:${samples[0]}`], { type: 'audio/wav' }),
    );
    await client.transcribe(blob(), request);
    expect(files).toEqual(['enc:1000:0.5']);
  });

  it('omits the language header for auto and for codes MiniMax does not document', async () => {
    const languages: Array<string | null> = [];
    server.use(
      http.post(MINIMAX_ENDPOINT, ({ request }) => {
        languages.push(request.headers.get('language'));
        return HttpResponse.json({ text: 'ok', duration: 1 });
      }),
    );
    const { client } = createClient();
    await client.transcribe(blob(), { ...request, language: undefined });
    await client.transcribe(blob(), { ...request, language: 'hi' });
    await client.transcribe(blob(), { ...request, language: 'zh' });
    expect(languages[0]).toBeNull();
    expect(languages[1]).toBeNull();
    expect(languages[2]).toBe('zh');
  });

  it('treats an empty text response as a valid result', async () => {
    server.use(http.post(MINIMAX_ENDPOINT, () => HttpResponse.json({ text: '', duration: 2 })));
    const { client } = createClient();
    const result = await client.transcribe(blob(), request);
    expect(result.text).toBe('');
    expect(result.duration).toBe(2);
  });

  it('rejects encoded payloads above the 50 MB request limit before any upload', async () => {
    let calls = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        calls++;
        return HttpResponse.json({ text: 'x', duration: 1 });
      }),
    );
    const { client } = createClient(
      'k',
      async () => ({ samples: samplesOf(1), sampleRate: RATE }),
      () => new Blob([new Uint8Array(MINIMAX_MAX_REQUEST_BYTES + 1)], { type: 'audio/wav' }),
    );
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'incompatible' },
    });
    expect(calls).toBe(0);
  });

  it('rejects empty decoded audio before any upload', async () => {
    const { client } = createClient('k', async () => ({
      samples: new Float32Array(0),
      sampleRate: RATE,
    }));
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'incompatible', message: expect.stringContaining('vac') },
    });
  });
});

describe('MiniMaxClient — long recordings split into one Transcripción', () => {
  it('splits above-limit audio into ordered fragments and joins their text with one space', async () => {
    const { client, bus, files } = createLongClient(1_000, ['hola', 'mundo']);
    const starts: string[] = [];
    const statuses: string[] = [];
    bus.on('transcription:start', (model) => starts.push(model));
    bus.on('status:change', (s) => statuses.push(s.message));

    const result = await client.transcribe(blob(), request);

    expect(files).toEqual(['frag:500000:1', 'frag:500000:1']);
    expect(result.text).toBe('hola mundo');
    expect(result.duration).toBe(1_000);
    expect(starts).toEqual([MINIMAX_ASR_MODEL]);
    expect(statuses.filter((m) => m.includes('fragmento'))).toEqual([
      'Procesando con MiniMax… (fragmento 1 de 2)',
      'Procesando con MiniMax… (fragmento 2 de 2)',
    ]);
  });

  it('keeps an exact 500-second recording as one request', async () => {
    const { client, files } = createLongClient(500);
    const result = await client.transcribe(blob(), request);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('frag:500000:1');
    expect(result.duration).toBe(500);
  });

  it('moves the cut into a nearby silence gap instead of slicing speech', async () => {
    const files = captureFiles();
    const samples = samplesOf(600);
    // Speech island straddles the hard 500 s boundary: 499.5 s → 503 s.
    samples.fill(0.9, Math.round(499.5 * RATE), Math.round(503 * RATE));
    const { client } = createClient('k', async () => ({ samples, sampleRate: RATE }));
    await client.transcribe(blob(), request);

    expect(files).toHaveLength(2);
    const first = Number(files[0]!.split(':')[1]);
    const second = Number(files[1]!.split(':')[1]);
    // Cut landed in the silent stretch just before the island (≤ 499.5 s),
    // never inside it and never after the hard boundary.
    expect(first).toBeGreaterThan(497 * RATE);
    expect(first).toBeLessThanOrEqual(Math.round(499.5 * RATE));
    expect(first + second).toBe(600 * RATE);
  });

  it('falls back to the hard boundary when the whole lookback window is speech', async () => {
    const { client, files } = createLongClient(1_000);
    await client.transcribe(blob(), request);
    expect(files[0]).toBe('frag:500000:1');
  });

  it('hands the encoder zero-copy views of the decoded buffer (no PCM duplication)', async () => {
    // One backing buffer for the whole hour-long-style take; the encoder
    // must receive subarray VIEWS into it, never per-fragment copies.
    const buffer = new ArrayBuffer(1_000_000 * 4);
    new Float32Array(buffer).fill(1);
    const seen: Array<{ sameBuffer: boolean; byteOffset: number; length: number }> = [];
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: new Float32Array(buffer), sampleRate: RATE }),
      (samples) => {
        seen.push({
          sameBuffer: samples.buffer === buffer,
          byteOffset: samples.byteOffset,
          length: samples.length,
        });
        return encoderFake(samples);
      },
    );
    await client.transcribe(blob(), request);
    expect(seen).toHaveLength(2);
    for (const view of seen) {
      expect(view.sameBuffer).toBe(true);
    }
    expect(seen[0]!.byteOffset).toBe(0);
    expect(seen[1]!.byteOffset).toBe(500_000 * 4);
    expect(seen[0]!.length + seen[1]!.length).toBe(1_000_000);
  });

  it('skips empty fragment texts when joining', async () => {
    const files: string[] = [];
    const texts = ['hola', ''];
    let call = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, async ({ request }) => {
        const form = await request.formData();
        const file = form.get('file');
        files.push(file instanceof File ? await file.text() : 'not-a-file');
        return HttpResponse.json({ text: texts[call++] ?? 'x', duration: 500 });
      }),
    );
    const { client } = createClient('k', async () => ({
      samples: samplesOf(1_000, 1),
      sampleRate: RATE,
    }));
    const result = await client.transcribe(blob(), request);
    expect(files).toHaveLength(2);
    expect(result.text).toBe('hola');
  });

  it('fails without emitting partial text when a middle fragment errors', async () => {
    const calls: number[] = [];
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        calls.push(calls.length + 1);
        if (calls.length === 2) {
          return HttpResponse.json({ base_resp: { status_msg: 'boom' } }, { status: 500 });
        }
        return HttpResponse.json({ text: `t${calls.length}`, duration: 500 });
      }),
    );
    const { client, bus } = createClient('k', async () => ({
      samples: samplesOf(1_500, 1),
      sampleRate: RATE,
    }));
    const successes: unknown[] = [];
    bus.on('transcription:success', (r) => successes.push(r));

    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'server' },
    });
    // Fragment 3 was never submitted and nothing partial was emitted.
    expect(calls).toEqual([1, 2]);
    expect(successes).toHaveLength(0);
  });
});

describe('MiniMaxClient — errors and events', () => {
  it('throws auth error when the key is missing', async () => {
    const { client } = createClient('');
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'auth', message: expect.stringContaining('MiniMax') },
    });
  });

  it('classifies 401 as auth', async () => {
    server.use(http.post(MINIMAX_ENDPOINT, () => HttpResponse.json({}, { status: 401 })));
    const { client } = createClient('invalid');
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('retries 503 then succeeds within one fragment', async () => {
    let attempts = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        attempts++;
        if (attempts < 2) return HttpResponse.json({}, { status: 503 });
        return HttpResponse.json({ text: 'recovered', duration: 1 });
      }),
    );
    const { client } = createClient();
    const result = await client.transcribe(blob(), request);
    expect(result.text).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('fails with parse kind on a malformed response body', async () => {
    server.use(http.post(MINIMAX_ENDPOINT, () => HttpResponse.json({ text: 42 })));
    const { client } = createClient();
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'parse' },
    });
  });

  it('reports a decode failure from the audio port as a parse error', async () => {
    const { client } = createClient('k', async () => {
      throw new Error('decode boom');
    });
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'parse', message: expect.stringContaining('convertir') },
    });
  });

  it('emits start with asr-1.0 then success on the bus', async () => {
    const { client, bus } = createClient();
    const starts: string[] = [];
    const errors: Error[] = [];
    bus.on('transcription:start', (model) => starts.push(model));
    bus.on('transcription:error', (e) => errors.push(e));
    await client.transcribe(blob(), request);
    expect(starts).toEqual([MINIMAX_ASR_MODEL]);
    expect(errors).toHaveLength(0);
  });

  it('emits transcription:error on the bus when throwing', async () => {
    const { client, bus } = createClient('invalid');
    const errors: Error[] = [];
    bus.on('transcription:error', (e) => errors.push(e));
    await expect(client.transcribe(blob(), request)).rejects.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TranscriptionApiError);
  });
});

describe('fragmentTimeoutMs', () => {
  it('never goes below the shared 30 s floor', () => {
    expect(fragmentTimeoutMs(0)).toBe(REQUEST_TIMEOUT_MS);
    expect(fragmentTimeoutMs(5)).toBe(REQUEST_TIMEOUT_MS);
  });

  it('scales with fragment duration (×3 realtime headroom)', () => {
    expect(fragmentTimeoutMs(100)).toBe(300_000);
    expect(fragmentTimeoutMs(200)).toBe(600_000);
  });

  it('caps long fragments at 15 minutes', () => {
    expect(fragmentTimeoutMs(600)).toBe(900_000);
    expect(fragmentTimeoutMs(5_000)).toBe(900_000);
  });
});

describe('MiniMaxClient — resumable takes (transcribeResumable)', () => {
  it('uploads only pending fragments and prepends the completed prefix', async () => {
    const files: string[] = [];
    const texts = ['b', 'c'];
    let call = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, async ({ request }) => {
        const form = await request.formData();
        const file = form.get('file');
        files.push(file instanceof File ? await file.text() : 'not-a-file');
        return HttpResponse.json({ text: texts[call++] ?? 'x', duration: 500 });
      }),
    );
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: samplesOf(1_500, 1), sampleRate: RATE }),
      encoderFake,
    );

    const result = await client.transcribeResumable(blob(), request, {
      completedTexts: ['a'],
    });

    expect(files).toEqual(['frag:500000:1', 'frag:500000:1']);
    expect(result.text).toBe('a b c');
    expect(result.duration).toBe(1_500);
  });

  it('reports the growing completed prefix after each fragment success', async () => {
    const texts = ['a', 'b', 'c'];
    let call = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, () =>
        HttpResponse.json({ text: texts[call++] ?? 'x', duration: 500 }),
      ),
    );
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: samplesOf(1_500, 1), sampleRate: RATE }),
      encoderFake,
    );
    const prefixes: string[][] = [];
    const result = await client.transcribeResumable(blob(), request, {
      completedTexts: [],
      onFragmentCompleted: (t) => prefixes.push([...t]),
    });

    expect(prefixes).toEqual([['a'], ['a', 'b'], ['a', 'b', 'c']]);
    expect(result.text).toBe('a b c');
  });

  it('uses the currently configured credential on a corrected retry', async () => {
    const auths: Array<string | null> = [];
    let failFirst = true;
    server.use(
      http.post(MINIMAX_ENDPOINT, ({ request }) => {
        auths.push(request.headers.get('Authorization'));
        if (failFirst) {
          failFirst = false;
          return HttpResponse.json({}, { status: 401 });
        }
        return HttpResponse.json({ text: 'ok', duration: 2 });
      }),
    );
    let key = 'minimax-old-key';
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => key,
      async () => ({ samples: samplesOf(2), sampleRate: RATE }),
      encoderFake,
    );

    await expect(client.transcribeResumable(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
    key = 'minimax-corrected-key';
    const result = await client.transcribeResumable(blob(), request);
    expect(result.text).toBe('ok');
    expect(auths).toEqual(['Bearer minimax-old-key', 'Bearer minimax-corrected-key']);
  });

  it('keeps the prefix across repeated failures of the same pending fragment', async () => {
    // Fragment index = fragmentBase + call-in-run, so resumed runs number
    // their uploads as the fragments they actually carry.
    const srv = { fragmentBase: 0, calls: 0, total: 0, blockedFragment: 2 };
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        srv.calls++;
        srv.total++;
        const fragment = srv.fragmentBase + srv.calls;
        if (fragment === srv.blockedFragment) {
          return HttpResponse.json({}, { status: 500 });
        }
        return HttpResponse.json({ text: `f${fragment}`, duration: 500 });
      }),
    );
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: samplesOf(1_500, 1), sampleRate: RATE }),
      encoderFake,
    );

    // Run 1 (fresh): fragment 1 succeeds, fragment 2 fails.
    await expect(client.transcribeResumable(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'server' },
    });
    expect(srv.total).toBe(2);

    // Run 2 (resume from 'f1'): the SAME pending fragment fails again —
    // exactly ONE new upload, the completed prefix is not resent.
    srv.calls = 0;
    srv.fragmentBase = 1;
    await expect(
      client.transcribeResumable(blob(), request, { completedTexts: ['f1'] }),
    ).rejects.toMatchObject({ detail: { kind: 'server' } });
    expect(srv.total).toBe(3);

    // Run 3 (unblock): pending fragments 2 and 3 run once each, joined result.
    srv.calls = 0;
    srv.fragmentBase = 1;
    srv.blockedFragment = 0;
    const result = await client.transcribeResumable(blob(), request, {
      completedTexts: ['f1'],
    });
    expect(srv.total).toBe(5);
    expect(result.text).toBe('f1 f2 f3');
  });

  it('resumes a one-fragment take like a fresh transcription', async () => {
    const files = captureFiles();
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: samplesOf(2), sampleRate: RATE }),
      encoderFake,
    );
    const result = await client.transcribeResumable(blob(), request, {
      completedTexts: [],
    });
    expect(files).toHaveLength(1);
    expect(result.text).toBe('minimax hello');
    expect(result.duration).toBe(2);
  });

  it('resumes from an empty prefix after a first-fragment failure', async () => {
    const srv = { allow: false, calls: 0 };
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        srv.calls++;
        if (!srv.allow) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json({ text: 'ok', duration: 2 });
      }),
    );
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: samplesOf(2), sampleRate: RATE }),
      encoderFake,
    );

    // 500 is non-retryable → terminal failure on fragment 1, no backoff.
    await expect(client.transcribeResumable(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'server' },
    });
    expect(srv.calls).toBe(1);

    // One-fragment take resumed from an empty prefix: full re-upload, success.
    srv.allow = true;
    const result = await client.transcribeResumable(blob(), request, { completedTexts: [] });
    expect(srv.calls).toBe(2);
    expect(result.text).toBe('ok');
  });

  it('emits exactly one start/success pair on a resumed take', async () => {
    const texts = ['b', 'c'];
    let call = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, () =>
        HttpResponse.json({ text: texts[call++] ?? 'x', duration: 500 }),
      ),
    );
    const bus = new EventBus<EventMap>();
    const client = new MiniMaxClient(
      bus,
      () => 'k',
      async () => ({ samples: samplesOf(1_500, 1), sampleRate: RATE }),
      encoderFake,
    );
    const starts: string[] = [];
    const successes: unknown[] = [];
    bus.on('transcription:start', (m) => starts.push(m));
    bus.on('transcription:success', (r) => successes.push(r));
    await client.transcribeResumable(blob(), request, { completedTexts: ['a'] });
    expect(starts).toEqual([MINIMAX_ASR_MODEL]);
    expect(successes).toHaveLength(1);
  });
});
