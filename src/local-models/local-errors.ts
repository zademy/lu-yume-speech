/**
 * Local failure classification — the 9 actionable error categories.
 *
 * Single responsibility: turn any Motor local failure (inference
 * `TranscriptionError`, download outcome or warning) into one of the nine
 * spec categories plus the concrete manual actions offered for it, and
 * build the exportable technical report. Pure module — no DOM, no bus.
 */

import type {
  LocalErrorCategory,
  LocalFailureClassification,
  LocalFailureCode,
  LocalModelState,
  LocalRecoveryAction,
  TranscriptionError,
} from '../types';

/** Input accepted by the classifier — any local failure shape. */
export interface LocalFailureInput {
  /** Structured code when the failure came from the provider. */
  code?: LocalFailureCode;
  /** `TranscriptionError` kind when the failure came from the provider. */
  kind?: TranscriptionError['kind'];
  /** Human message (used only as a fallback signal, never alone). */
  message?: string;
  /** Download-engine terminal reason, when the failure came from a download. */
  downloadReason?:
    'cancelled' | 'download-failed' | 'busy-other-tab' | 'invalid-state' | 'busy' | 'unknown-model';
  /** Download phase when it failed: verifying distinguishes integrity loss. */
  downloadPhase?: 'fetching' | 'verifying';
  /** Advisory warning kind accompanying the failure (space/memory). */
  warningKind?: 'space-insufficient' | 'memory-tier';
  /** Resulting record state after a download failure. */
  recordState?: LocalModelState;
  /** Underlying cause chain, when the failure carried one. */
  cause?: unknown;
}

/** Code → category for every structured provider code. */
const CODE_CATEGORY: Readonly<Record<LocalFailureCode, LocalErrorCategory>> = {
  'no-active-model': 'model-incompatible',
  'model-not-in-catalog': 'model-incompatible',
  'model-not-downloaded': 'model-incompatible',
  'memory-blocked': 'insufficient-memory',
  'webgpu-required': 'webgpu-unavailable',
  'wasm-not-supported': 'model-incompatible',
  'request-incompatible': 'model-incompatible',
  'browser-not-supported': 'browser-not-supported',
  'audio-decode': 'inference-failed',
  'load-failed': 'inference-failed',
  'weights-missing': 'integrity-invalid',
  'memory-inference': 'insufficient-memory',
  'inference-failed': 'inference-failed',
  'inference-busy-other-tab': 'busy-other-tab',
  cancelled: 'download-interrupted',
};

/** The concrete manual actions per category, in offer order. */
const CATEGORY_ACTIONS: Readonly<Record<LocalErrorCategory, readonly LocalRecoveryAction[]>> = {
  'browser-not-supported': ['update-browser', 'remote-groq', 'remote-cloudflare'],
  'webgpu-unavailable': ['switch-backend', 'smaller-model', 'remote-groq', 'remote-cloudflare'],
  'insufficient-memory': ['smaller-model', 'switch-backend', 'remote-groq', 'remote-cloudflare'],
  'insufficient-space': ['free-space', 'smaller-model'],
  'download-interrupted': ['re-download'],
  'integrity-invalid': ['re-download', 'remote-groq', 'remote-cloudflare'],
  'model-incompatible': ['re-download', 'smaller-model', 'remote-groq', 'remote-cloudflare'],
  'inference-failed': [
    'retry',
    'switch-backend',
    'smaller-model',
    'remote-groq',
    'remote-cloudflare',
  ],
  'busy-other-tab': ['wait-other-tab'],
};

/**
 * Classify a local failure into one of the nine categories with its manual
 * recovery actions. Structured codes win; message text is only consulted
 * for worker-origin failures that arrive as untyped strings.
 */
export function classifyLocalFailure(input: LocalFailureInput): LocalFailureClassification {
  const category = categorize(input);
  return { category, actions: CATEGORY_ACTIONS[category] };
}

function categorize(input: LocalFailureInput): LocalErrorCategory {
  // Download-side failures carry their own reasons.
  if (input.downloadReason === 'busy-other-tab') return 'busy-other-tab';
  if (input.downloadReason === 'cancelled') return 'download-interrupted';
  if (input.warningKind === 'space-insufficient') return 'insufficient-space';
  if (input.downloadReason === 'download-failed') {
    return input.downloadPhase === 'verifying' ? 'integrity-invalid' : 'download-interrupted';
  }

  // Provider-side failures: structured code first.
  if (input.code) return CODE_CATEGORY[input.code];

  // Worker-origin strings have no code — fall back to stable signals.
  const message = input.message ?? '';
  if (/\bwebgpu\b/i.test(message)) return 'webgpu-unavailable';
  if (MEMORY_SIGNAL.test(message)) return 'insufficient-memory';
  if (/\bcach[eé]/i.test(message)) return 'integrity-invalid';
  return 'inference-failed';
}

/** Inference failures that smell like memory exhaustion (mirrors the provider). */
const MEMORY_SIGNAL = /\b(out of memory|oom|alloc(?:ation)? failed|memory access)\b/i;

/**
 * Extract the classifier input from a thrown transcription error — the
 * provider's `TranscriptionApiError` carries the structured `detail`; any
 * other error degrades to its message.
 */
export function fromTranscriptionError(error: unknown): LocalFailureInput {
  const detail = (
    error as {
      detail?: { kind?: TranscriptionError['kind']; code?: LocalFailureCode; message?: string };
    }
  ).detail;
  if (detail) {
    return {
      kind: detail.kind,
      code: detail.code,
      message: detail.message,
      cause: (error as { cause?: unknown }).cause,
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/** Context carried into the exportable technical report. */
export interface TechnicalReportContext {
  /** ISO timestamp of the failure. */
  at: string;
  /** Active transcription method at the time. */
  method: string;
  /** Active local model id, when any. */
  modelId?: string;
  /** Effective backend of the last local run, when known. */
  backend?: string;
  /** User agent string. */
  userAgent: string;
  /** Device RAM in GB when reported. */
  deviceMemoryGb?: number | null;
}

/**
 * Build the exportable technical report (plain text) for a local failure —
 * category, message, chain of causes and the environment snapshot. Users
 * attach this to bug reports; it never contains audio or transcription
 * text.
 */
export function buildTechnicalReport(
  failure: LocalFailureInput,
  context: TechnicalReportContext,
): string {
  const lines: string[] = [
    'lu-yume-speech — Informe de fallo del Motor local',
    `Fecha: ${context.at}`,
    `Categoría: ${failure.code ?? failure.downloadReason ?? failure.kind ?? 'inference-failed'}`,
    `Método: ${context.method}`,
  ];
  if (context.modelId) lines.push(`Modelo: ${context.modelId}`);
  if (context.backend) lines.push(`Backend: ${context.backend}`);
  if (context.deviceMemoryGb !== undefined && context.deviceMemoryGb !== null) {
    lines.push(`RAM reportada (GB): ${context.deviceMemoryGb}`);
  }
  lines.push(`Navegador: ${context.userAgent}`);
  if (failure.message) lines.push(`Mensaje: ${failure.message}`);
  if (failure.downloadPhase) lines.push(`Fase de descarga: ${failure.downloadPhase}`);
  if (failure.recordState) lines.push(`Estado del registro: ${failure.recordState}`);

  const causes: string[] = [];
  let depth = 0;
  let cause: unknown = (failure as { cause?: unknown }).cause;
  while (cause instanceof Error && depth < 5) {
    causes.push(cause.message);
    cause = cause.cause;
    depth += 1;
  }
  if (causes.length > 0) lines.push(`Causas: ${causes.join(' <- ')}`);
  return lines.join('\n');
}
