import { dismissToast, subscribeToToasts, toast, type ToastItem } from '@/lib/toast';

describe('toast store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Drain whatever's still pending so one test's toasts never leak
    // into the next — the store is module-level state, not reset
    // between tests by Jest itself.
    let current: ToastItem[] = [];
    const unsubscribe = subscribeToToasts((items) => (current = items));
    unsubscribe();
    for (const t of current) dismissToast(t.id);
    jest.useRealTimers();
  });

  it('success/error/warning/info each notify subscribers with the right variant and message', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    toast.success('API key created');
    toast.error('Could not reach the server.');
    toast.warning('Usage is approaching the project limit');
    toast.info('Live stream is starting');

    const final = seen[seen.length - 1];
    expect(final.map((t) => t.variant)).toEqual(['success', 'error', 'warning', 'info']);
    expect(final.map((t) => t.message)).toEqual([
      'API key created',
      'Could not reach the server.',
      'Usage is approaching the project limit',
      'Live stream is starting',
    ]);

    unsubscribe();
  });

  it('dismisses itself automatically after its variant-specific duration', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    toast.success('Saved');
    expect(seen[seen.length - 1]).toHaveLength(1);

    jest.advanceTimersByTime(2999);
    expect(seen[seen.length - 1]).toHaveLength(1); // not yet — success lives 3000ms

    jest.advanceTimersByTime(1);
    expect(seen[seen.length - 1]).toHaveLength(0);

    unsubscribe();
  });

  it('gives error and warning toasts longer to read than success/info', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    toast.error('Could not reach the server.');
    const id = seen[seen.length - 1][0].id;

    jest.advanceTimersByTime(3000); // success/info's duration
    expect(seen[seen.length - 1].some((t) => t.id === id)).toBe(true); // error outlives it

    jest.advanceTimersByTime(3001); // now past error's own 6000ms
    expect(seen[seen.length - 1].some((t) => t.id === id)).toBe(false);

    unsubscribe();
  });

  it('can be dismissed manually before its timer fires, without a double-dismiss error', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    toast.info('Live stream is starting');
    const id = seen[seen.length - 1][0].id;

    dismissToast(id);
    expect(seen[seen.length - 1]).toHaveLength(0);

    // The auto-dismiss timer for this id was cleared — advancing past
    // its original duration must not throw or double-notify.
    expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    dismissToast(id); // dismissing an already-gone id is a no-op, not an error

    unsubscribe();
  });

  it('holds multiple simultaneous toasts independently, oldest first', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    toast.success('API key created');
    toast.success('Member invited');
    toast.error('Could not remove this member');

    const final = seen[seen.length - 1];
    expect(final).toHaveLength(3);
    expect(final.map((t) => t.message)).toEqual(['API key created', 'Member invited', 'Could not remove this member']);

    // Dismissing the middle one leaves the other two, in order.
    dismissToast(final[1].id);
    const afterDismiss = seen[seen.length - 1];
    expect(afterDismiss.map((t) => t.message)).toEqual(['API key created', 'Could not remove this member']);

    unsubscribe();
  });

  it('gives rapid, identical, repeated calls each their own toast and their own id — no silent de-dup', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    toast.success('Saved');
    toast.success('Saved');
    toast.success('Saved');

    const final = seen[seen.length - 1];
    expect(final).toHaveLength(3);
    expect(new Set(final.map((t) => t.id)).size).toBe(3);

    unsubscribe();
  });

  it('a late subscriber immediately receives the current toast list, not an empty one', () => {
    toast.warning('Usage is approaching the project limit');

    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0].message).toBe('Usage is approaching the project limit');

    unsubscribe();
  });

  it('stops notifying a subscriber once it unsubscribes', () => {
    const seen: ToastItem[][] = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items));
    unsubscribe();

    const callCountAfterUnsubscribe = seen.length;
    toast.success('Should not be observed');
    expect(seen).toHaveLength(callCountAfterUnsubscribe);
  });
});
