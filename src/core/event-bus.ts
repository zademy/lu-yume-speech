/**
 * Typed event bus for decoupled module communication.
 *
 * This is the backbone of the application's architecture. Every module
 * communicates through this bus instead of importing other modules directly,
 * satisfying the Dependency Inversion Principle (DIP):
 *
 *   High-level policy ← EventBus (abstraction) → Low-level details
 *
 * Usage:
 * ```ts
 * const bus = new EventBus<EventMap>();
 * const unsub = bus.on('recording:start', () => console.log('started'));
 * bus.emit('recording:start', undefined);
 * unsub(); // cleanup
 * ```
 *
 * SRP: This class ONLY dispatches events. Zero business logic.
 */

type Listener<T> = (data: T) => void;

/**
 * Loosen the constraint so interfaces with `void` values are accepted.
 * `void` is assignable to `unknown`, but TS doesn't infer this through
 * `Record<string, unknown>` index signatures. We bypass with `any` here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventBus<TEventMap extends Record<string, any>> {
  private readonly listeners = new Map<keyof TEventMap, Set<Listener<unknown>>>();

  /**
   * Subscribe to an event.
   *
   * @returns Unsubscribe function — call it to remove the listener.
   */
  on<TKey extends keyof TEventMap>(event: TKey, listener: Listener<TEventMap[TKey]>): () => void {
    const key = event as string;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener as Listener<unknown>);

    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Remove a specific listener from an event.
   */
  off<TKey extends keyof TEventMap>(event: TKey, listener: Listener<TEventMap[TKey]>): void {
    this.listeners.get(event as string)?.delete(listener as Listener<unknown>);
  }

  /**
   * Emit an event. All listeners fire synchronously and in insertion order.
   * Listener errors are caught and logged so one bad listener cannot break others.
   */
  emit<TKey extends keyof TEventMap>(event: TKey, data: TEventMap[TKey]): void {
    const set = this.listeners.get(event as string);
    if (!set) return;

    for (const listener of set) {
      try {
        listener(data);
      } catch (error) {
        console.error(`[EventBus] Error in "${String(event)}" listener:`, error);
      }
    }
  }

  /**
   * Remove all listeners. Pass an event name to clear only that event.
   */
  clear(event?: keyof TEventMap): void {
    if (event) {
      this.listeners.delete(event as string);
    } else {
      this.listeners.clear();
    }
  }
}
