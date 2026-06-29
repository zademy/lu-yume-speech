/**
 * Core type definitions for the Speech-to-Text application.
 *
 * This module is the single source of truth for all shared types,
 * interfaces, and constants. It contains NO runtime logic — only
 * type declarations and immutable configuration values.
 *
 * Design principles applied:
 * - ISP: Each interface is small and focused on one concept.
 * - SRP: This module only declares types, nothing else.
 */

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** MIME types for audio recording, ordered by preference (opus first). */
export const AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/** Complete transcription result from the Groq Whisper API. */
export interface TranscriptionResult {
  /** Full transcribed text */
  text: string;
  /** Detected or specified language (ISO-639-1) */
  language?: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Segment-level details (only with verbose_json) */
  segments?: TranscriptionSegment[];
  /** Word-level timestamps (only with verbose_json + word granularity) */
  words?: TranscriptionWord[];
}

/** Single transcription segment with timing and confidence metadata. */
export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

/** Single word with precise start/end timestamps. */
export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

/** Parameters for a transcription or translation request. */
export interface TranscriptionOptions {
  /** Whisper model to use */
  model: WhisperModel;
  /** Source language (ISO-639-1). Improves accuracy and latency when set. */
  language?: string;
  /** Context prompt to guide the model (max 224 tokens). Must match audio language. */
  prompt?: string;
  /** Sampling temperature 0–1. Use 0 for deterministic output. */
  temperature?: number;
  /** Response format. verbose_json enables timestamps and metadata. */
  responseFormat?: 'json' | 'text' | 'verbose_json';
  /** Timestamp detail level. Requires responseFormat = 'verbose_json'. */
  timestampGranularities?: Array<'word' | 'segment'>;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Whisper models available on the Groq platform. */
export type WhisperModel = 'whisper-large-v3' | 'whisper-large-v3-turbo';

/** All available models for UI selectors. */
export const WHISPER_MODELS: WhisperModel[] = ['whisper-large-v3', 'whisper-large-v3-turbo'];

// ---------------------------------------------------------------------------
// Operation mode
// ---------------------------------------------------------------------------

/**
 * What the app does with the audio.
 * - 'transcribe' → same language output
 * - 'translate'  → translate any language to English
 */
export type OperationMode = 'transcribe' | 'translate';

/** Label and description for each mode (UI selector). */
export interface OperationModeOption {
  value: OperationMode;
  label: string;
  description: string;
}

/** Available operation modes for the UI selector. */
export const OPERATION_MODES: readonly OperationModeOption[] = [
  {
    value: 'transcribe',
    label: 'Transcribir',
    description: 'Texto en el idioma original',
  },
  {
    value: 'translate',
    label: 'Traducir',
    description: 'Traducir audio a inglés',
  },
] as const;

/** Available response formats for the UI selector. */
export const RESPONSE_FORMATS: readonly {
  value: AppSettings['responseFormat'];
  label: string;
}[] = [
  { value: 'json', label: 'Texto plano' },
  { value: 'verbose_json', label: 'Con timestamps' },
  { value: 'text', label: 'Solo texto (raw)' },
] as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Application settings persisted to localStorage.
 *
 * Each field is independent — modules only read what they need (ISP).
 */
export interface AppSettings {
  model: WhisperModel;
  operationMode: OperationMode;
  language: string;
  prompt: string;
  temperature: number;
  responseFormat: 'json' | 'text' | 'verbose_json';
  autoCopy: boolean;
  recordMode: 'push-to-talk' | 'toggle';
  theme: 'light' | 'dark' | 'system';
}

/** Sensible defaults so the app works without any stored preferences. */
export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  model: 'whisper-large-v3-turbo',
  operationMode: 'transcribe',
  language: 'auto',
  prompt: '',
  temperature: 0,
  responseFormat: 'json',
  autoCopy: true,
  recordMode: 'push-to-talk',
  theme: 'system',
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Visual severity levels for the status bar. */
export type StatusLevel = 'idle' | 'recording' | 'processing' | 'success' | 'error' | 'warning';

/** Payload for status bar updates. */
export interface StatusUpdate {
  message: string;
  level: StatusLevel;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Typed event map for the application event bus.
 *
 * This is the central contract between modules. No module imports another
 * module directly — they communicate exclusively through these events (DIP).
 *
 * Key: event name. Value: event payload type (void = no payload).
 */
export interface EventMap {
  /** Microphone recording has started */
  'recording:start': void;
  /** Microphone recording has stopped */
  'recording:stop': void;
  /** Real-time audio level (0–1) for visualization */
  'recording:level': number;
  /** Silence detected for the configured threshold duration */
  'recording:silence': void;
  /** Recording duration tick (payload = elapsed seconds) */
  'recording:timer': number;
  /** Complete audio blob ready for transcription */
  'audio:blob-ready': Blob;
  /** Transcription request sent (payload = model name) */
  'transcription:start': string;
  /** Transcription completed successfully */
  'transcription:success': TranscriptionResult;
  /** Transcription failed */
  'transcription:error': Error;
  /** New text appended to the output area */
  'text:append': string;
  /** Status bar should update */
  'status:change': StatusUpdate;
  /** One or more settings changed */
  'settings:change': Partial<AppSettings>;
  /** A history entry was saved */
  'history:save': HistoryEntry;
  /** A history entry was deleted (payload = id) */
  'history:delete': string;
  /** All history entries were cleared */
  'history:clear': void;
  /** A history entry should be restored to the output area (payload = id) */
  'history:restore': string;
  /** The history list was updated (full list pushed to sidebar) */
  'history:updated': HistoryEntry[];
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Maximum number of history entries stored in localStorage. */
export const HISTORY_MAX_ENTRIES = 100;

/** localStorage key for the sidebar open/closed state. */
export const HISTORY_SIDEBAR_KEY = 'sidebar_open';

/** localStorage key for the history entries array. */
export const HISTORY_ENTRIES_KEY = 'history';

/** A single transcription saved to the history. */
export interface HistoryEntry {
  /** Unique identifier (crypto.randomUUID) */
  id: string;
  /** Transcribed text */
  text: string;
  /** Detected or specified language (ISO-639-1) */
  language?: string;
  /** Whisper model used */
  model: WhisperModel;
  /** Audio duration in seconds */
  duration?: number;
  /** Unix timestamp in milliseconds */
  createdAt: number;
  /** Whether this was a transcription or translation */
  operationMode: OperationMode;
}

// ---------------------------------------------------------------------------
// Recording modes
// ---------------------------------------------------------------------------

/** Available recording mode options for the UI selector. */
export const RECORD_MODES: readonly {
  value: AppSettings['recordMode'];
  label: string;
  description: string;
}[] = [
  { value: 'push-to-talk', label: 'Push-to-talk', description: 'Mantén presionado' },
  { value: 'toggle', label: 'Toggle', description: 'Un toque para iniciar/detener' },
] as const;

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** Language option for the UI selector. */
export interface LanguageOption {
  /** ISO-639-1 code, or 'auto' for auto-detection */
  code: string;
  /** Human-readable display name */
  label: string;
}

/** Supported transcription languages. */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'sv', label: 'Svenska' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
] as const;

/**
 * Typed alias for the analyser byte data shape used by Web Audio.
 * TS 6.0 tracks the generic parameter; this alias keeps call sites clean
 * and avoids `as any` casts when calling `getByteTimeDomainData`.
 */
export type AnalyserByteData = Uint8Array<ArrayBuffer>;

/**
 * Thrown when `navigator.mediaDevices` is unavailable.
 * Happens on insecure contexts (HTTP non-localhost) or very old browsers.
 */
export class MicNotSupportedError extends Error {
  constructor(
    message = 'MediaRecorder/navigator.mediaDevices not available in this context (requires HTTPS or localhost).',
  ) {
    super(message);
    this.name = 'MicNotSupportedError';
  }
}

// ---------------------------------------------------------------------------
// Groq API errors
// ---------------------------------------------------------------------------

/** Discriminated union of all Groq API failure modes. */
export type GroqError =
  | ({ kind: 'auth' } & ErrorPayload)
  | ({ kind: 'rate-limit'; retryAfterMs?: number } & ErrorPayload)
  | ({ kind: 'network' } & ErrorPayload)
  | ({ kind: 'parse' } & ErrorPayload)
  | ({ kind: 'server'; status: number } & ErrorPayload);

interface ErrorPayload {
  message: string;
  cause?: unknown;
}

/**
 * Typed error thrown by `GroqClient.transcribe()`.
 * Also emitted on the event bus as `transcription:error`
 * (satisfies `EventMap['transcription:error']: Error`).
 */
export class GroqApiError extends Error {
  readonly detail: GroqError;
  constructor(detail: GroqError) {
    super(detail.message);
    this.name = 'GroqApiError';
    this.detail = detail;
    if (detail.cause !== undefined) this.cause = detail.cause;
  }
}
