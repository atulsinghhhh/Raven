import { act, render } from '@testing-library/react';
import { useDebouncedRefetch } from '@/lib/realtime/use-debounced-refetch';

function Probe({ refetch, trigger }: { refetch: () => void; trigger: number }) {
  const scheduleRefetch = useDebouncedRefetch(refetch);
  // Re-invoking scheduleRefetch whenever `trigger` changes stands in for a
  // realtime event handler calling it — the test drives that by re-rendering
  // with a new trigger value.
  scheduleRefetch();
  void trigger;
  return null;
}

describe('useDebouncedRefetch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('collapses a burst of schedule calls into a single refetch after the debounce window', () => {
    const refetch = jest.fn();
    const { rerender } = render(<Probe refetch={refetch} trigger={0} />);

    // Three renders in quick succession, each re-triggering scheduleRefetch —
    // the same shape as three realtime nudges arriving close together.
    rerender(<Probe refetch={refetch} trigger={1} />);
    rerender(<Probe refetch={refetch} trigger={2} />);

    act(() => {
      jest.advanceTimersByTime(399);
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('calls the latest refetch function passed in, not the one captured on first render', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<Probe refetch={first} trigger={0} />);
    rerender(<Probe refetch={second} trigger={1} />);

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clears the pending timer on unmount, so an in-flight debounce never fires after', () => {
    const refetch = jest.fn();
    const { unmount } = render(<Probe refetch={refetch} trigger={0} />);

    unmount();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(refetch).not.toHaveBeenCalled();
  });
});
