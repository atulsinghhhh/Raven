import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components/ui/toaster';
import { dismissToast, subscribeToToasts, toast, type ToastItem } from '@/lib/toast';

describe('Toaster', () => {
  afterEach(() => {
    // The toast store is module-level state, not reset between tests by
    // Jest — drain it so one test's toasts never leak into the next.
    let current: ToastItem[] = [];
    const unsubscribe = subscribeToToasts((items) => (current = items));
    unsubscribe();
    act(() => {
      for (const t of current) dismissToast(t.id);
    });
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<Toaster />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a success toast as a polite status region, not an alert', async () => {
    render(<Toaster />);
    act(() => toast.success('API key created'));

    const region = await screen.findByText('API key created');
    const toastEl = region.closest('[role]');
    expect(toastEl).toHaveAttribute('role', 'status');
    expect(toastEl).toHaveAttribute('aria-live', 'polite');
  });

  it('renders an error toast as an assertive alert', async () => {
    render(<Toaster />);
    act(() => toast.error('Could not reach the server.'));

    const region = await screen.findByText('Could not reach the server.');
    const toastEl = region.closest('[role]');
    expect(toastEl).toHaveAttribute('role', 'alert');
    expect(toastEl).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders a warning toast as an assertive alert too — it is worth interrupting for', async () => {
    render(<Toaster />);
    act(() => toast.warning('Usage is approaching the project limit'));

    const region = await screen.findByText('Usage is approaching the project limit');
    expect(region.closest('[role]')).toHaveAttribute('role', 'alert');
  });

  it('renders multiple toasts at once, each independently dismissible', async () => {
    render(<Toaster />);
    act(() => {
      toast.success('API key created');
      toast.success('Member invited');
    });

    expect(await screen.findByText('API key created')).toBeInTheDocument();
    expect(screen.getByText('Member invited')).toBeInTheDocument();

    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss notification' });
    expect(dismissButtons).toHaveLength(2);

    await userEvent.click(dismissButtons[0]);
    await waitFor(() => expect(screen.queryByText('API key created')).not.toBeInTheDocument());
    expect(screen.getByText('Member invited')).toBeInTheDocument();

    // Clean up the survivor so it doesn't leak into the next test.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  });
});
