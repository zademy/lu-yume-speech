import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GroqChatError,
  chatCompletion,
  formatRateLimitMessage,
  stripInvisibleChars,
  type ChatCompletionOptions,
} from '../../src/api/groq-chat';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string' } },
  required: ['text'],
} as const;

function baseOptions(overrides: Partial<ChatCompletionOptions> = {}): ChatCompletionOptions {
  return {
    apiKey: 'gsk_key',
    model: 'openai/gpt-oss-20b',
    systemPrompt: 'You are a test helper.',
    userContent: 'hello',
    schemaName: 'test_output',
    schema: SCHEMA,
    ...overrides,
  };
}

function groqResponse(
  content: string | null,
  status = 200,
  headers?: Record<string, string>,
): Response {
  const body = content === null ? '{}' : JSON.stringify({ choices: [{ message: { content } }] });
  return new Response(body, { status, headers });
}

describe('chatCompletion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the raw model content on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqResponse('{"text":"Hi"}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(chatCompletion(baseOptions())).resolves.toBe('{"text":"Hi"}');
  });

  it('posts to the Groq chat endpoint with the schema-bound body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await chatCompletion(
      baseOptions({ model: 'm1', systemPrompt: 'sys', userContent: 'u', schemaName: 'nm' }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gsk_key');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; name: string } };
      temperature: number;
    };
    expect(body.model).toBe('m1');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u' },
    ]);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, name: 'nm' },
    });
    expect(body.temperature).toBe(0);
  });

  it('throws GroqChatError(empty) when the model returns no content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse(null)));
    const err = await chatCompletion(baseOptions()).catch((e) => e);
    expect(err).toBeInstanceOf(GroqChatError);
    expect((err as GroqChatError).kind).toBe('empty');
  });

  it('throws GroqChatError(http) with the status on a non-rate-limit failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 500 })));
    const err = await chatCompletion(baseOptions()).catch((e) => e);
    expect((err as GroqChatError).kind).toBe('http');
    expect((err as GroqChatError).status).toBe(500);
  });

  it('throws GroqChatError(rate-limit) with retryAfterSeconds on a 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('rate', { status: 429, headers: { 'retry-after': '7' } })),
    );
    const err = await chatCompletion(baseOptions()).catch((e) => e);
    expect((err as GroqChatError).kind).toBe('rate-limit');
    expect((err as GroqChatError).status).toBe(429);
    expect((err as GroqChatError).retryAfterSeconds).toBe(7);
  });

  it('throws GroqChatError(timeout) when the request aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    const err = await chatCompletion(baseOptions()).catch((e) => e);
    expect((err as GroqChatError).kind).toBe('timeout');
  });

  it('throws GroqChatError(network) on a generic fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const err = await chatCompletion(baseOptions()).catch((e) => e);
    expect((err as GroqChatError).kind).toBe('network');
  });

  it('links an external abort signal to the request', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const p = chatCompletion(baseOptions({ signal: ctrl.signal }));
    ctrl.abort();
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(GroqChatError);
    expect((err as GroqChatError).kind).toBe('timeout');
  });
});

describe('stripInvisibleChars', () => {
  it('leaves normal text untouched', () => {
    expect(stripInvisibleChars('Hello, world!')).toBe('Hello, world!');
  });

  it('removes zero-width spaces and the BOM', () => {
    expect(stripInvisibleChars('a\u200bb\ufeffc')).toBe('abc');
  });

  it('removes soft hyphens and bidi marks', () => {
    expect(stripInvisibleChars('foo\u00adbar\u202e')).toBe('foobar');
  });
});

describe('formatRateLimitMessage', () => {
  it('includes the retry hint when Retry-After is known', () => {
    expect(formatRateLimitMessage(12)).toBe('Límite de Groq alcanzado. Reintenta en 12 s.');
  });

  it('omits the retry hint when Retry-After is unknown', () => {
    expect(formatRateLimitMessage()).toBe('Límite de Groq alcanzado. Intenta de nuevo más tarde.');
  });
});
