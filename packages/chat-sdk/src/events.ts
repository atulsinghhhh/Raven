/**
 * Minimal typed pub/sub — no external dependency, keeps the bundle small.
 *
 * Differs from `@raven/rtc`'s emitter in one deliberate way: `on()`
 * returns an **unsubscribe function** rather than `this`. Chat handlers
 * are overwhelmingly registered inside component effects, where the
 * cleanup path is the common case and a mismatched `off(event, handler)`
 * is the classic way to leak one (spec §14). `off()` still exists for
 * code that prefers it.
 */
export type Unsubscribe = () => void;

export class TypedEventEmitter<
  EventMap extends { [K in keyof EventMap]: (...args: never[]) => void },
> {
  private listeners = new Map<keyof EventMap, Set<(...args: never[]) => void>>();

  on<E extends keyof EventMap>(event: E, handler: EventMap[E]): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (...args: never[]) => void);

    let released = false;
    return () => {
      // Idempotent: calling the same unsubscribe twice must not remove a
      // handler that was re-registered in between.
      if (released) return;
      released = true;
      this.off(event, handler);
    };
  }

  off<E extends keyof EventMap>(event: E, handler: EventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as (...args: never[]) => void);
    // Drop the empty set too, so a long-lived client doesn't accumulate
    // one entry per event type it ever saw.
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  once<E extends keyof EventMap>(event: E, handler: EventMap[E]): Unsubscribe {
    const wrapped = ((...args: never[]) => {
      unsubscribe();
      (handler as (...args: never[]) => void)(...args);
    }) as EventMap[E];
    const unsubscribe = this.on(event, wrapped);
    return unsubscribe;
  }

  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /** Test/diagnostic helper — how many handlers are attached to an event. */
  listenerCount(event: keyof EventMap): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  protected emit<E extends keyof EventMap>(event: E, ...args: Parameters<EventMap[E]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy before iterating — a handler may unsubscribe itself or another
    // handler for this same event mid-dispatch.
    for (const handler of Array.from(set)) {
      (handler as (...args: unknown[]) => void)(...args);
    }
  }
}
