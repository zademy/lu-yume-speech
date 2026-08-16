// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers, WORKER_BASE_URL } from '../helpers/msw-handlers';
import { CloudflareWhisperClient } from '../../src/api/cloudflare-whisper-client';
import { CLOUDFLARE_WHISPER_MODEL, TranscriptionApiError } from '../../src/types';
import { EventBus } from '../../src/core/event-bus';
import type { EventMap } from '../../src/types';
import type { TranscriptionRequest } from '../../src/api/transcription-provider';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createClient(token = 'worker-secret-token'): {
  client: CloudflareWhisperClient;
  bus: EventBus<EventMap>;
} {
  const bus = new EventBus<EventMap>();
  return {
    client: new CloudflareWhisperClient(
      bus,
      () => token,
      () => WORKER_BASE_URL,
    ),
    bus,
  };
}

const request: TranscriptionRequest = {
  mode: 'transcribe',
  model: CLOUDFLARE_WHISPER_MODEL,
  language: 'es',
  temperature: 0,
  responseFormat: 'json',
};

const blob = () => new Blob(['audio'], { type: 'audio/webm' });

describe('CloudflareWhisperClient', () => {
  it('returns plain-text transcription with no metadata', async () => {
    const { client } = createClient();
    const result = await client.transcribe(blob(), request);
    expect(result.text).toBe('worker hello');
    expect(result.language).toBeUndefined();
    expect(result.duration).toBeUndefined();
    expect(result.segments).toBeUndefined();
  });

  it('sends raw audio body with audio Content-Type and Bearer token', async () => {
    let captured: { body: string; contentType: string; auth: string } | null = null;
    server.use(
      http.post(`${WORKER_BASE_URL}/transcribe`, async ({ request }) => {
        captured = {
          body: await request.text(),
          contentType: request.headers.get('Content-Type') ?? '',
          auth: request.headers.get('Authorization') ?? '',
        };
        return new HttpResponse('ok');
      }),
    );
    const { client } = createClient('tok-12345678');
    await client.transcribe(blob(), request);
    expect(captured!.body).toBe('audio');
    expect(captured!.contentType).toBe('audio/webm');
    expect(captured!.auth).toBe('Bearer tok-12345678');
  });

  it('appends ?lang= for an explicit language and omits it for auto', async () => {
    const urls: string[] = [];
    server.use(
      http.post(`${WORKER_BASE_URL}/transcribe`, ({ request }) => {
        urls.push(new URL(request.url).search);
        return new HttpResponse('ok');
      }),
    );
    const { client } = createClient();
    await client.transcribe(blob(), request);
    const auto: TranscriptionRequest = { ...request, language: undefined };
    await client.transcribe(blob(), auto);
    expect(urls[0]).toBe('?lang=es');
    expect(urls[1]).toBe('');
  });

  it('strips trailing slashes from the base URL', async () => {
    const bus = new EventBus<EventMap>();
    const client = new CloudflareWhisperClient(
      bus,
      () => 'tok',
      () => `${WORKER_BASE_URL}/`,
    );
    await expect(client.transcribe(blob(), request)).resolves.toMatchObject({
      text: 'worker hello',
    });
  });

  it('throws auth error when token is missing', async () => {
    const { client } = createClient('');
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('classifies 401 as auth', async () => {
    server.use(
      http.post(
        `${WORKER_BASE_URL}/transcribe`,
        () => new HttpResponse('No autorizado', { status: 401 }),
      ),
    );
    const { client } = createClient('invalid');
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('classifies 502 as server with plain-text message', async () => {
    server.use(
      http.post(
        `${WORKER_BASE_URL}/transcribe`,
        () => new HttpResponse('modelo falló', { status: 502 }),
      ),
    );
    const { client } = createClient();
    await expect(client.transcribe(blob(), request)).rejects.toMatchObject({
      detail: { kind: 'server', status: 502, message: 'modelo falló' },
    });
  });

  it('retries 503 then succeeds', async () => {
    let attempts = 0;
    server.use(
      http.post(`${WORKER_BASE_URL}/transcribe`, () => {
        attempts++;
        if (attempts < 2) return new HttpResponse('unavailable', { status: 503 });
        return new HttpResponse('recovered');
      }),
    );
    const { client } = createClient();
    const result = await client.transcribe(blob(), request);
    expect(result.text).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('aborts when external signal fires', async () => {
    server.use(
      http.post(`${WORKER_BASE_URL}/transcribe`, async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return new HttpResponse('late');
      }),
    );
    const ctrl = new AbortController();
    const { client } = createClient();
    setTimeout(() => ctrl.abort(), 50);
    await expect(client.transcribe(blob(), request, ctrl.signal)).rejects.toMatchObject({
      detail: { kind: 'network', message: 'Transcripción cancelada.' },
    });
  });

  it('emits start/success events and reports the fixed model', async () => {
    const { client, bus } = createClient();
    const starts: string[] = [];
    const errors: Error[] = [];
    bus.on('transcription:start', (model) => starts.push(model));
    bus.on('transcription:error', (e) => errors.push(e));
    await client.transcribe(blob(), request);
    expect(starts).toEqual([CLOUDFLARE_WHISPER_MODEL]);
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
