// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers } from '../helpers/msw-handlers';
import { GroqClient } from '../../src/api/groq-client';
import { GroqApiError } from '../../src/types';
import { EventBus } from '../../src/core/event-bus';
import type { EventMap, TranscriptionOptions } from '../../src/types';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createClient(apiKey: string): GroqClient {
  const bus = new EventBus<EventMap>();
  return new GroqClient(bus, () => apiKey);
}

const opts: TranscriptionOptions = {
  model: 'whisper-large-v3-turbo',
  language: 'es',
  temperature: 0,
  responseFormat: 'json',
};

const blob = () => new Blob(['audio'], { type: 'audio/webm' });

describe('GroqClient', () => {
  it('returns parsed text on 200', async () => {
    const client = createClient('gsk_test-key');
    const result = await client.transcribe(blob(), opts);
    expect(result.text).toBe('hello world');
  });

  it('throws GroqApiError kind=auth on 401', async () => {
    const client = createClient('invalid');
    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('throws GroqApiError kind=network when no API key', async () => {
    const client = createClient('');
    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('aborts when external signal fires', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return HttpResponse.json({ text: 'late' });
      }),
    );
    const ctrl = new AbortController();
    const client = createClient('gsk_test-key');
    setTimeout(() => ctrl.abort(), 50);
    await expect(
      client.transcribe(blob(), opts, 'transcriptions', ctrl.signal),
    ).rejects.toMatchObject({
      detail: { kind: 'network' },
    });
  });

  it('retries 429 then succeeds', async () => {
    let attempts = 0;
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', () => {
        attempts++;
        if (attempts < 3) {
          return HttpResponse.json(
            { error: { message: 'rate' } },
            { status: 429, headers: { 'Retry-After': '0' } },
          );
        }
        return HttpResponse.json({ text: 'ok' });
      }),
    );
    const client = createClient('gsk_test-key');
    const result = await client.transcribe(blob(), opts);
    expect(result.text).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('classifies 403 as auth', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', () =>
        HttpResponse.json({ error: { message: 'forbidden' } }, { status: 403 }),
      ),
    );
    const client = createClient('gsk_test-key');
    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });
  });

  it('classifies 500 as server', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    const client = createClient('gsk_test-key');
    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'server', status: 500 },
    });
  });

  it('classifies 400 (other 4xx) as network', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', () =>
        HttpResponse.json({ error: { message: 'bad request' } }, { status: 400 }),
      ),
    );
    const client = createClient('gsk_test-key');
    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'network' },
    });
  });

  it('exhausts 429 retries then throws rate-limit with retryAfterMs', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', () =>
        HttpResponse.json(
          { error: { message: 'slow down' } },
          { status: 429, headers: { 'Retry-After': '2' } },
        ),
      ),
    );
    const client = createClient('gsk_test-key');
    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'rate-limit', retryAfterMs: 2000 },
    });
  }, 15000);

  it('emits transcription:error on the bus when throwing', async () => {
    const bus = new EventBus<EventMap>();
    const client = new GroqClient(bus, () => 'invalid');
    const errors: Error[] = [];
    bus.on('transcription:error', (e: Error) => errors.push(e));
    await expect(client.transcribe(blob(), opts)).rejects.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(GroqApiError);
  });

  it('emits transcription:start and transcription:success on happy path', async () => {
    const bus = new EventBus<EventMap>();
    const client = new GroqClient(bus, () => 'gsk_test-key');
    const events: string[] = [];
    bus.on('transcription:start', () => events.push('start'));
    bus.on('transcription:success', () => events.push('success'));
    await client.transcribe(blob(), opts);
    expect(events).toEqual(['start', 'success']);
  });

  it('sends verbose_json format and timestamp granularities in FormData', async () => {
    let capturedFormData: FormData | null = null;
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', async ({ request }) => {
        const form = await request.formData();
        capturedFormData = form;
        return HttpResponse.json({
          text: 'verbose result',
          segments: [{ id: 0, text: 'verbose result', start: 0, end: 1 }],
        });
      }),
    );
    const client = createClient('gsk_test-key');
    const verboseOpts: TranscriptionOptions = {
      model: 'whisper-large-v3-turbo',
      temperature: 0,
      responseFormat: 'verbose_json',
      timestampGranularities: ['word', 'segment'],
    };
    const result = await client.transcribe(blob(), verboseOpts);
    expect(result.text).toBe('verbose result');
    expect(capturedFormData).not.toBeNull();
    expect(capturedFormData!.get('response_format')).toBe('verbose_json');
    expect(capturedFormData!.getAll('timestamp_granularities[]')).toEqual(['word', 'segment']);
  });

  it('uses the latest API key supplied for each request', async () => {
    let apiKey = '';
    let authorization = '';
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', ({ request }) => {
        authorization = request.headers.get('Authorization') ?? '';
        return HttpResponse.json({ text: 'updated key' });
      }),
    );
    const bus = new EventBus<EventMap>();
    const client = new GroqClient(bus, () => apiKey);

    await expect(client.transcribe(blob(), opts)).rejects.toMatchObject({
      detail: { kind: 'auth' },
    });

    apiKey = 'gsk_live-key';
    await expect(client.transcribe(blob(), opts)).resolves.toMatchObject({ text: 'updated key' });
    expect(authorization).toBe('Bearer gsk_live-key');
  });
});
