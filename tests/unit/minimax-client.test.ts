// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers } from '../helpers/msw-handlers';
import {
  MiniMaxClient,
  MINIMAX_ENDPOINT,
  MINIMAX_MAX_REQUEST_BYTES,
} from '../../src/api/minimax-client';
import { MINIMAX_ASR_MODEL, TranscriptionApiError } from '../../src/types';
import { EventBus } from '../../src/core/event-bus';
import type { EventMap } from '../../src/types';
import type { TranscriptionRequest } from '../../src/api/transcription-provider';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const WAV_BYTES = new TextEncoder().encode('fake-wav-payload');

function createClient(
  apiKey = 'minimax-secret-key',
  prepare = async (): Promise<{ blob: Blob; durationSeconds: number }> => ({
    blob: new Blob([WAV_BYTES], { type: 'audio/wav' }),
    durationSeconds: 2,
  }),
): {
  client: MiniMaxClient;
  bus: EventBus<EventMap>;
} {
  const bus = new EventBus<EventMap>();
  return { client: new MiniMaxClient(bus, () => apiKey, prepare), bus };
}

const request: TranscriptionRequest = {
  mode: 'transcribe',
  model: 'whisper-large-v3-turbo',
  language: 'es',
  temperature: 0,
  responseFormat: 'json',
};

const blob = () => new Blob(['recorded-audio'], { type: 'audio/webm' });

describe('MiniMaxClient', () => {
  it('normalizes a successful response into text + duration', async () => {
    const { client } = createClient();
    const result = await client.transcribe(blob(), request);
    expect(result.text).toBe('minimax hello');
    expect(result.duration).toBe(2);
    expect(result.language).toBeUndefined();
    expect(result.segments).toBeUndefined();
  });

  it('sends multipart form with asr-1.0, the prepared WAV file and Bearer auth', async () => {
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
    expect(new Uint8Array(await captured!.file!.arrayBuffer())).toEqual(WAV_BYTES);
  });

  it('sends exactly what the audio port produced — never the raw recording', async () => {
    let sent: Uint8Array | null = null;
    server.use(
      http.post(MINIMAX_ENDPOINT, async ({ request }) => {
        const form = await request.formData();
        const file = form.get('file');
        sent = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
        return HttpResponse.json({ text: 'ok', duration: 1 });
      }),
    );
    const converted = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
    const { client } = createClient('k', async () => ({
      blob: converted,
      durationSeconds: 1,
    }));
    await client.transcribe(blob(), request);
    expect(sent).toEqual(new Uint8Array([1, 2, 3, 4]));
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

  it('rejects recordings longer than 500 seconds before any upload', async () => {
    let calls = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        calls++;
        return HttpResponse.json({ text: 'x', duration: 1 });
      }),
    );
    const { client } = createClient('k', async () => ({
      blob: new Blob([WAV_BYTES], { type: 'audio/wav' }),
      durationSeconds: 500.5,
    }));
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'incompatible', message: expect.stringContaining('500') },
    });
    expect(calls).toBe(0);
  });

  it('rejects payloads above the 50 MB request limit before any upload', async () => {
    let calls = 0;
    server.use(
      http.post(MINIMAX_ENDPOINT, () => {
        calls++;
        return HttpResponse.json({ text: 'x', duration: 1 });
      }),
    );
    const oversized = new Blob([new Uint8Array(MINIMAX_MAX_REQUEST_BYTES + 1)], {
      type: 'audio/wav',
    });
    const { client } = createClient('k', async () => ({
      blob: oversized,
      durationSeconds: 1,
    }));
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'incompatible' },
    });
    expect(calls).toBe(0);
  });

  it('throws auth error when the key is missing', async () => {
    const { client } = createClient('');
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: {
        kind: 'auth',
        message: expect.stringContaining('MiniMax'),
      },
    });
  });

  it('classifies 401 as auth', async () => {
    server.use(http.post(MINIMAX_ENDPOINT, () => HttpResponse.json({}, { status: 401 })));
    const { client } = createClient('invalid');
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('retries 503 then succeeds', async () => {
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
