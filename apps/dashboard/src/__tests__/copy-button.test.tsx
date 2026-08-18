import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyButton } from '@/components/ui/copy-button';

/**
 * jsdom's own `navigator.clipboard` is a read-only accessor, AND something
 * in React's render path re-derives `window.navigator` on mount — a
 * defineProperty override set before `render()` gets silently discarded.
 * Applying it after render (but before interacting) is what actually
 * sticks, confirmed by direct inspection during test authoring.
 */
function stubClipboard() {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'navigator', {
    value: { ...window.navigator, clipboard: { writeText } },
    configurable: true,
    writable: true,
  });
  return writeText;
}

describe('CopyButton', () => {
  it('writes the given value to the clipboard when clicked', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="rvk_abc.secret123" />);
    const writeText = stubClipboard();

    await user.click(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledWith('rvk_abc.secret123');
  });

  it('shows "Copied" feedback after a successful copy, then reverts to the label', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    const user = userEvent.setup({ delay: null });
    render(<CopyButton value="x" label="Copy key" />);
    stubClipboard();

    expect(screen.getByRole('button')).toHaveTextContent('Copy key');

    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));

    act(() => {
      jest.advanceTimersByTime(1600);
    });
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copy key'));

    jest.useRealTimers();
  });

  it('has an accessible label reflecting its current state', () => {
    render(<CopyButton value="x" label="Copy secret" />);
    expect(screen.getByRole('button', { name: 'Copy secret to clipboard' })).toBeInTheDocument();
  });
});
