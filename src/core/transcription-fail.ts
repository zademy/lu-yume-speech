/**
 * Shared transcription failure emitter.
 *
 * SRP: the one helper every transcription provider (remote adapters and the
 * Motor local alike) uses to report a failure — construct the typed
 * `TranscriptionApiError` and emit it on the event bus. Living in `core/`
 * (next to the bus itself) keeps provider modules from importing each other;
 * only `main.ts` composes them.
 */

import type { EventBus } from './event-bus';
import type { EventMap, TranscriptionApiError, TranscriptionError } from '../types';
import { TranscriptionApiError as ApiError } from '../types';

/**
 * Emit the error on the bus and return a `TranscriptionApiError` for the
 * caller to throw.
 */
export function fail(bus: EventBus<EventMap>, detail: TranscriptionError): TranscriptionApiError {
  const error = new ApiError(detail);
  bus.emit('transcription:error', error);
  return error;
}
