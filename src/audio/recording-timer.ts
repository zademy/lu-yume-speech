/**
 * Recording duration timer.
 *
 * Tracks elapsed recording time and emits periodic tick events
 * so the UI can display a live "00:00" counter.
 *
 * SRP: This module's only job is measuring elapsed recording time.
 * DIP: Emits events through the bus — the UI subscribes independently.
 *
 * Lifecycle:
 * ```ts
 * const timer = new RecordingTimer(bus);
 * timer.start();  // begins emitting 'recording:timer'
 * timer.stop();   // pauses, emits final elapsed time
 * timer.reset();  // resets to 0
 * ```
 */

import type { EventBus } from '../core/event-bus';
import type { EventMap } from '../types';

/** How often (ms) the timer emits a tick. */
const TICK_INTERVAL_MS = 100;

export class RecordingTimer {
  private readonly bus: EventBus<EventMap>;
  private startTime: number = 0;
  private elapsedAtPause: number = 0;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(bus: EventBus<EventMap>) {
    this.bus = bus;
  }

  /**
   * Start or resume the timer.
   * Emits 'recording:timer' events every 100ms with elapsed seconds.
   */
  start(): void {
    if (this.interval !== null) return; // Already running

    this.startTime = Date.now();

    this.interval = setInterval(() => {
      const elapsed = this.elapsedAtPause + (Date.now() - this.startTime);
      this.bus.emit('recording:timer', elapsed / 1000);
    }, TICK_INTERVAL_MS);
  }

  /**
   * Pause the timer. Preserves elapsed time for potential resume.
   * Emits one final tick with the exact elapsed time.
   */
  stop(): void {
    if (this.interval === null) return;

    clearInterval(this.interval);
    this.interval = null;

    this.elapsedAtPause += Date.now() - this.startTime;

    // Emit final accurate time
    this.bus.emit('recording:timer', this.elapsedAtPause / 1000);
  }

  /**
   * Reset elapsed time to zero.
   * Only call when the timer is stopped.
   */
  reset(): void {
    this.elapsedAtPause = 0;
    this.startTime = 0;
    this.bus.emit('recording:timer', 0);
  }

  /**
   * Get current elapsed time in seconds, including an active session.
   */
  getElapsed(): number {
    if (this.interval !== null) {
      return (this.elapsedAtPause + (Date.now() - this.startTime)) / 1000;
    }
    return this.elapsedAtPause / 1000;
  }

  /**
   * Stop the timer and reset state.
   * Safe to call multiple times.
   */
  dispose(): void {
    this.stop();
    this.reset();
  }
}
