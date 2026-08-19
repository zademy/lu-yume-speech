/**
 * Máquina de estados de descarga del Motor local — pure transition table.
 *
 * Single responsibility: decide whether a lifecycle event is legal from a
 * given {@link LocalModelState} and which state it produces. No I/O, no
 * timing, no storage — the download engine drives it and persists results.
 *
 * T3 covers the download slice of the spec lifecycle; 'active' and
 * 'update-available' transitions land with the lifecycle tickets.
 */

import type { LocalModelState } from '../types';

/** Events the download engine can feed into the machine. */
export type LocalModelLifecycleEvent =
  | { type: 'download-start' }
  | { type: 'artifacts-complete' }
  | { type: 'verified' }
  | { type: 'verify-failed' }
  | { type: 'cancelled' }
  | { type: 'failed' };

/** Result of applying one event: either the next state or a rejection. */
export type LocalModelTransition = { ok: true; state: LocalModelState } | { ok: false };

/**
 * Legal transitions (spec: No descargado → Descargando → Preparando →
 * Descargado; Descarga parcial tras cancelación; Descarga parcial and Error
 * are re-downloadable; a fully Descargado model never re-enters the download
 * flow through this machine — updates are explicit and land with T6).
 */
const TRANSITIONS: Readonly<
  Record<LocalModelState, Partial<Record<LocalModelLifecycleEvent['type'], LocalModelState>>>
> = {
  'not-downloaded': { 'download-start': 'downloading' },
  downloading: {
    'artifacts-complete': 'preparing',
    cancelled: 'partial',
    failed: 'error',
  },
  preparing: {
    verified: 'downloaded',
    'verify-failed': 'error',
    cancelled: 'partial',
  },
  partial: { 'download-start': 'downloading' },
  error: { 'download-start': 'downloading' },
  downloaded: {},
};

/**
 * Apply a lifecycle event to a state. Pure — returns the next state or
 * `{ ok: false }` when the event is illegal from that state.
 */
export function nextLocalModelState(
  state: LocalModelState,
  event: LocalModelLifecycleEvent,
): LocalModelTransition {
  const next = TRANSITIONS[state][event.type];
  return next === undefined ? { ok: false } : { ok: true, state: next };
}

/** Whether a state can start a download (re-download for partial/error). */
export function canStartDownload(state: LocalModelState): boolean {
  return nextLocalModelState(state, { type: 'download-start' }).ok;
}

/**
 * Whether a model in this state is activatable. Only artifacts-complete-and-
 * verified models may become the Modelo activo — partial downloads never.
 * ('active' handling lands with T6; until then downloaded = activatable.)
 */
export function isActivatable(state: LocalModelState): boolean {
  return state === 'downloaded';
}
