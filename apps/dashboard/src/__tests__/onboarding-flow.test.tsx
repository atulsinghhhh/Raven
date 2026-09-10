import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingFlow } from '@/app/onboarding/onboarding-flow';
import type { OnboardingState } from '@/lib/api-client';

const push = jest.fn();
const refresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

const FRESH: OnboardingState = {
  step: 1,
  completed: false,
  completedAt: null,
  useCases: [],
  experienceLevel: null,
  stack: [],
  createdFirstProject: false,
};

function okJson(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body };
}

describe('OnboardingFlow', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(okJson());
    push.mockClear();
    refresh.mockClear();
  });

  it('starts on the welcome step with no progress indicator', () => {
    render(<OnboardingFlow initialState={FRESH} hasProjects={false} />);
    expect(screen.getByRole('heading', { name: 'Welcome to Livqeno' })).toBeInTheDocument();
    expect(screen.queryByText(/step \d of/i)).not.toBeInTheDocument();
  });

  it('persists the step on continue — that PATCH is what makes a closed tab resumable', async () => {
    render(<OnboardingFlow initialState={FRESH} hasProjects={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/onboarding',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ step: 2 }) }),
      ),
    );
    expect(screen.getByRole('heading', { name: 'What are you building?' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
  });

  it('resumes at the step the server saved, not the beginning', () => {
    render(<OnboardingFlow initialState={{ ...FRESH, step: 4 }} hasProjects={false} />);
    expect(screen.getByRole('heading', { name: 'What are you building with?' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument();
  });

  it('marks selections with aria-pressed and saves them on continue', async () => {
    render(<OnboardingFlow initialState={{ ...FRESH, step: 2 }} hasProjects={false} />);

    const saas = screen.getByRole('button', { name: 'SaaS' });
    expect(saas).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(saas);
    expect(saas).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/onboarding',
        expect.objectContaining({ body: JSON.stringify({ useCases: ['saas'], step: 3 }) }),
      ),
    );
  });

  it('never blocks on the experience step — skip moves on without saving an answer', async () => {
    render(<OnboardingFlow initialState={{ ...FRESH, step: 3 }} hasProjects={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/onboarding',
        expect.objectContaining({ body: JSON.stringify({ step: 4 }) }),
      ),
    );
  });

  it('offers no skip on project creation for an account with no projects — the step is mandatory', () => {
    render(<OnboardingFlow initialState={{ ...FRESH, step: 5 }} hasProjects={false} />);
    expect(screen.queryByRole('button', { name: /skip|existing project/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  });

  it('lets an account that already has projects continue without creating another', () => {
    render(<OnboardingFlow initialState={{ ...FRESH, step: 5 }} hasProjects />);
    expect(screen.getByRole('button', { name: 'Use an existing project' })).toBeInTheDocument();
  });

  it('creates the project, shows the show-once key, and records createdFirstProject', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/projects' && init?.method === 'POST') {
        return Promise.resolve(okJson({ id: 'proj_1', name: 'My realtime app' }));
      }
      if (url === '/api/projects/proj_1/api-keys') {
        return Promise.resolve(okJson({ publicId: 'rk_pub', key: 'rk_pub.secret', environment: 'DEVELOPMENT' }));
      }
      return Promise.resolve(okJson());
    });

    render(<OnboardingFlow initialState={{ ...FRESH, step: 5 }} hasProjects={false} />);
    await userEvent.type(screen.getByLabelText('Project name'), 'My realtime app');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByRole('heading', { name: 'Project created' })).toBeInTheDocument();
    expect(screen.getByText('rk_pub.secret')).toBeInTheDocument();
    expect(screen.getByText(/only time the full key is shown/i)).toBeInTheDocument();

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/onboarding',
        expect.objectContaining({ body: JSON.stringify({ createdFirstProject: true, step: 6 }) }),
      ),
    );
  });

  it('completes onboarding and leaves for the dashboard from the final step', async () => {
    render(<OnboardingFlow initialState={{ ...FRESH, step: 7 }} hasProjects />);
    await userEvent.click(screen.getByRole('button', { name: 'Go to dashboard' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/onboarding/complete', { method: 'POST' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
  });

  it('surfaces a failed save without trapping the person on the step forever', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Something broke' }),
    });

    render(<OnboardingFlow initialState={FRESH} hasProjects={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
    // Still on welcome — the step only advances when the save landed.
    expect(screen.getByRole('heading', { name: 'Welcome to Livqeno' })).toBeInTheDocument();
  });
});
