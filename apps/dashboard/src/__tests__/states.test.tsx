import { render, screen } from '@testing-library/react';
import { EmptyState, ErrorState, NoDataYet } from '@/components/ui/states';

describe('EmptyState', () => {
  it('renders a title, optional description, and optional action', () => {
    render(<EmptyState title="No projects yet" description="Create your first project to get started." action={<button>New project</button>} />);

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
