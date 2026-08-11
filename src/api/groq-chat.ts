/**
 * Groq chat-completions envelope — the single owner of the HTTP call shape
 * shared by every chat-based feature (transcription summary, LLM
 * post-processing, Pluma selection improve).
 *
 * Owns: the endpoint URL, request timeout, AbortController wiring, the
 * `response_format: json_schema` request body, `Retry-After` parsing, the
 * `choices[0].message.content` extraction, and one typed error. Callers keep
 * only what is genuinely theirs: the model, the system prompt, the JSON schema,
 * the response parser, and the fail policy (throw vs fail-open).
 *
 * Network egress: `https://api.groq.com` only (ARCHITECTURE.md §4).
 *
 * SRP: this module only performs a Groq chat-completion request and returns the
 * raw model content string; it knows nothing about transcriptions, summaries, or
 * prose improvement.
 */

/** Groq chat-completions endpoint (OpenAI-compatible). */
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Request timeout — LLM calls can be slow, but never block forever. */
const TIMEOUT_MS = 30_000;

/** Structured failure kind, so callers can choose their own message or fail open. */
export type GroqChatErrorKind = 'empty' | 'http' | 'rate-limit' | 'timeout' | 'network';

/**
 * Error thrown by `chatCompletion` for every failure path: an empty model
 * response, a non-2xx HTTP status, a rate limit, a timeout, or a network error.
 * The structured `kind` lets callers decide their own user-facing message
 * (or fail open) without re-implementing the detection logic.
 */
export class GroqChatError extends Error {
  readonly kind: GroqChatErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: GroqChatErrorKind,
    message: string,
    status?: number,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'GroqChatError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Options for a chat-completion request. */
export interface ChatCompletionOptions {
  /** Groq API key (DI — never read from storage here). */
  apiKey: string;
  /** Groq chat model id, e.g. `openai/gpt-oss-20b`. */
  model: string;
  /** Full system prompt (caller-built, schema-aware). */
  systemPrompt: string;
  /** User-message content (the text to process). */
  userContent: string;
  /** Name for the strict JSON schema (Groq requires one). */
  schemaName: string;
  /** Strict JSON schema constraining the model output. */
  schema: object;
  /** Optional external abort signal for caller-initiated cancellation. */
  signal?: AbortSignal;
}

/** Parse the `Retry-After` header (seconds) into a non-negative number. */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Format the shared Spanish rate-limit message, including the retry hint when
 * `Retry-After` is known. Used by every throwing chat caller.
 */
export function formatRateLimitMessage(retryAfterSeconds?: number): string {
  return retryAfterSeconds === undefined
    ? 'Límite de Groq alcanzado. Intenta de nuevo más tarde.'
    : `Límite de Groq alcanzado. Reintenta en ${retryAfterSeconds} s.`;
}

/**
 * Remove invisible / formatting Unicode characters that some chat models
 * inject (zero-width spaces, BOM, soft hyphen, bidi controls, interlinear
 * annotation). Visible text is untouched.
 */
export function stripInvisibleChars(text: string): string {
  return text.replace(
    /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff\ufff9-\ufffb]/g,
    '',
  );
}

/**
 * Send a schema-bound chat-completion request to Groq and return the raw model
 * content string (`choices[0].message.content`).
 *
 * A timeout aborts the request after {@link TIMEOUT_MS}. When `options.signal`
 * is provided it is linked to the internal controller so caller cancellation
 * aborts the in-flight request too.
 *
 * @throws {GroqChatError} on empty content, non-2xx HTTP, rate limit, timeout,
 *   or network error. The caller decides whether to surface a typed domain
 *   error or fail open.
 */
export async function chatCompletion(options: ChatCompletionOptions): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userContent },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: options.schemaName, strict: true, schema: options.schema },
        },
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      throw new GroqChatError(
        response.status === 429 ? 'rate-limit' : 'http',
        `Groq chat request failed (HTTP ${response.status}).`,
        response.status,
        retryAfter,
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new GroqChatError('empty', 'Empty model response.');
    return content;
  } catch (error) {
    if (error instanceof GroqChatError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GroqChatError('timeout', 'Groq chat request timed out.');
    }
    throw new GroqChatError('network', 'Groq chat network error.');
  } finally {
    clearTimeout(timeout);
  }
}
