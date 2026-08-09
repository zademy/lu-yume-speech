/**
 * LLM transcription post-processor — optional polishing pass via Groq chat
 * completions, reusing the same API key as transcription.
 *
 * Raw Whisper output is often unpunctuated and littered with disfluencies. This
 * module asks a Groq chat model to clean it up — punctuation, capitalization,
 * filler/stutter removal, obvious-error correction — while preserving meaning
 * and language. Output is constrained to `{ "transcription": "..." }` via a
 * strict JSON schema so parsing is reliable.
 *
 * Fail-open by design: on any network error, non-JSON response, or empty result
 * the original text is returned untouched so transcription never depends on the
 * LLM succeeding. Zero-width characters some models inject are stripped.
 *
 * Architecture: the pure pieces (`stripInvisibleChars`, `buildSystemPrompt`,
 * `parseTranscriptionResponse`) are deterministic and fully unit-testable; only
 * the thin `postProcessWithLlm` wrapper touches the network.
 *
 * SRP: this module only refines transcription text via an LLM — it does not do
 * speech-to-text, manage settings, or touch the DOM.
 */

/** Groq chat-completions endpoint (OpenAI-compatible). Same origin as transcription. */
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Request timeout — LLM calls can be slow, but never block forever. */
const TIMEOUT_MS = 30_000;

/** Options for an LLM post-processing run. */
export interface LlmPostProcessOptions {
  /** Groq chat model id, e.g. `llama-3.3-70b-versatile`. */
  model: string;
  /** Extra user instructions appended to the built-in system prompt. */
  instructions?: string;
  /** Optional abort signal for caller-initiated cancellation. */
  signal?: AbortSignal;
}

/**
 * Remove invisible / formatting Unicode characters that some chat models inject
 * (zero-width spaces, BOM, soft hyphen, bidi controls, interlinear annotation).
 * Visible text is untouched.
 */
export function stripInvisibleChars(text: string): string {
  // U+00AD soft hyphen, U+200B..U+200F zero-width + bidi marks,
  // U+2028/U+2029 line/paragraph separators, U+202A..U+202E bidi embedding,
  // U+2060..U+2064 + U+206A..U+206F format chars, U+FEFF BOM,
  // U+FFF9..U+FFFB interlinear annotation.
  return text.replace(
    /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff\ufff9-\ufffb]/g,
    '',
  );
}

/** Built-in system prompt that constrains the model to clean, schema-bound output. */
const BASE_SYSTEM_PROMPT = [
  'You are a transcription post-processor.',
  'Clean up raw speech-to-text output:',
  'add punctuation and correct capitalization;',
  'remove filler words and stutters;',
  'fix obvious spelling and grammar errors;',
  'preserve the original meaning and language exactly — never add or omit information.',
  'Return ONLY a JSON object matching this schema:',
  '{"transcription": string}.',
  'Do not include any prose, markdown, or explanation.',
].join(' ');

/**
 * Build the system prompt, optionally extending the built-in instructions with
 * user-supplied guidance (e.g. "prefer formal tone", domain vocabulary).
 */
export function buildSystemPrompt(instructions?: string): string {
  const extra = instructions?.trim();
  return extra ? `${BASE_SYSTEM_PROMPT}\n\nAdditional instructions: ${extra}` : BASE_SYSTEM_PROMPT;
}

/** JSON schema enforcing `{ "transcription": string }` with no extra fields. */
export const TRANSCRIPTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { transcription: { type: 'string' } },
  required: ['transcription'],
} as const;

/**
 * Parse the model's chat response: extract `transcription`, strip invisible
 * chars, and fall back to the raw string when JSON is missing or malformed.
 */
export function parseTranscriptionResponse(raw: string): string {
  const text = stripInvisibleChars(raw).trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'transcription' in parsed &&
      typeof (parsed as { transcription?: unknown }).transcription === 'string'
    ) {
      return stripInvisibleChars((parsed as { transcription: string }).transcription);
    }
  } catch {
    // Not JSON — fall through and return the raw text.
  }
  return text;
}

/**
 * Run the LLM post-processing pass on `text`.
 *
 * @returns The polished text, or the original `text` unchanged on any failure
 *          (network error, timeout, non-JSON response, empty result).
 */
export async function postProcessWithLlm(
  text: string,
  apiKey: string,
  options: LlmPostProcessOptions,
): Promise<string> {
  if (!text.trim() || !apiKey || !options.model) return text;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const body = {
      model: options.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(options.instructions) },
        { role: 'user', content: text },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'transcription_output',
          strict: true,
          schema: TRANSCRIPTION_OUTPUT_SCHEMA,
        },
      },
      temperature: 0,
    };

    const res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return text;

    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return text;

    const cleaned = parseTranscriptionResponse(content);
    return cleaned || text;
  } catch {
    return text; // network/abort/parse failure — fail open with the original
  } finally {
    clearTimeout(timeout);
  }
}
