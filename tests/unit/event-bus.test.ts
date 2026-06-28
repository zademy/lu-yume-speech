import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/event-bus';

type TestEvents = {
  ping: { value: number };
  'void-event': void;
};

describe('EventBus', () => {
  it('delivers emitted payload to subscribers', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on('ping', spy);
    bus.emit('ping', { value: 42 });
    expect(spy).toHaveBeenCalledWith({ value: 42 });
  });

  it('supports void events', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on('void-event', spy);
    bus.emit('void-event', undefined);
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  it('unsubscribe function removes the listener', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    const unsub = bus.on('ping', spy);
    unsub();
    bus.emit('ping', { value: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('listeners fire in subscription order', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.on('ping', () => order.push('first'));
    bus.on('ping', () => order.push('second'));
    bus.emit('ping', { value: 0 });
    expect(order).toEqual(['first', 'second']);
  });

  it('a throwing listener does not break siblings', () => {
    const bus = new EventBus<TestEvents>();
    const ok = vi.fn();
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', ok);
    bus.emit('ping', { value: 0 });
    expect(ok).toHaveBeenCalled();
  });

  it('clear(event?) removes listeners', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on('ping', spy);
    bus.clear('ping');
    bus.emit('ping', { value: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});
