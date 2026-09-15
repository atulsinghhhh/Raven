import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';

describe('EmptyState', () => {
  it('renders a title, optional description, and optional action', () => {
    render(
      <EmptyState
        title="No projects yet"
        description="Create your first project to get started."
        action={<button>New project</button>}
      />,
    );

    expect(screen.getByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first project to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('renders without a description or action when omitted', () => {
    render(<EmptyState title="No rooms yet" />);
    expect(screen.getByText('No rooms yet')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('has role="alert" so assistive tech announces it immediately', () => {
    render(<ErrorState description="The Control API is unreachable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('The Control API is unreachable');
  });

  it('never renders a raw stack trace — only the developer-friendly description passed in', () => {
    render(<ErrorState description="Project not found" />);
    expect(screen.queryByText(/at Object\.<anonymous>/)).not.toBeInTheDocument();
  });

  it('renders a retryHref as a link when only retryHref is given', () => {
    render(<ErrorState description="Unreachable" retryHref="/dashboard/projects/p1/overview" />);
    const retry = screen.getByRole('link', { name: 'Retry' });
    expect(retry).toHaveAttribute('href', '/dashboard/projects/p1/overview');
  });

  it('renders onRetry as a button that calls back on click, in place of a navigation link', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<ErrorState description="Unreachable" retryHref="/should-not-be-used" onRetry={onRetry} />);

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('link', { name: 'Retry' })).not.toBeInTheDocument();

    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the retry button as busy when retrying is true', () => {
    render(<ErrorState description="Unreachable" onRetry={() => {}} retrying />);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('NoDataYet', () => {
  it('defaults to "No data yet" text — never a fabricated number', () => {
    render(<NoDataYet />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('accepts a custom label (e.g. "Unknown" for an unreachable dependency)', () => {
    render(<NoDataYet label="Unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
