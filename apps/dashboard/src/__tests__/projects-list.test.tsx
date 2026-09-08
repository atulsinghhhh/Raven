import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsList } from '@/app/dashboard/projects/projects-list';
import type { Project } from '@/lib/api-client';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const PROJECT: Project = {
  id: 'proj_1',
  name: 'acme-video',
  description: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
} as Project;

function createdProject(id = 'proj_new') {
  return { ok: true, status: 201, json: async () => ({ id }) };
}

/** The dialog's submit button, which lives in the footer outside the form. */
function submitButton() {
  return screen.getByRole('button', { name: 'Create project' });
}

describe('ProjectsList — create project', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    push.mockClear();
  });

  it('does not render the dialog until the developer asks for it', () => {
    render(<ProjectsList initialProjects={[PROJECT]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the dialog from the deep link, so ?new=1 lands ready to type', async () => {
    render(<ProjectsList initialProjects={[PROJECT]} autoOpenCreate />);
    expect(screen.getByRole('dialog', { name: 'Create a project' })).toBeInTheDocument();
    // The name field takes focus, not the header's close button, which
    // is first in DOM order, and would make Space or Enter dismiss the
    // dialog the instant it opened.
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveFocus());
  });

  it('keeps Tab inside the dialog instead of letting it reach the page behind', async () => {
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} autoOpenCreate />);
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveFocus());

    const panel = screen.getByRole('dialog');
    // Walk well past the control count; focus must never escape the panel.
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(panel).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('keeps submit disabled until the name clears the API minimum', async () => {
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    expect(submitButton()).toBeDisabled();

    await user.type(screen.getByLabelText('Project name'), 'a');
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText('At least 2 characters.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Project name'), 'b');
    expect(submitButton()).toBeEnabled();
  });

  it('treats a whitespace-only name as empty rather than valid', async () => {
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    await user.type(screen.getByLabelText('Project name'), '    ');
    expect(submitButton()).toBeDisabled();
  });

  it('omits description entirely when left blank, since the field is optional', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createdProject());
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    await user.type(screen.getByLabelText('Project name'), '  spaced-name  ');
    await user.click(submitButton());

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ name: 'spaced-name' });
    expect(body).not.toHaveProperty('description');
  });

  it('sends a trimmed description when one is given', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createdProject());
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    await user.type(screen.getByLabelText('Project name'), 'acme');
    await user.type(screen.getByLabelText('Description (optional)'), '  support widget  ');
    await user.click(submitButton());

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ name: 'acme', description: 'support widget' });
  });

  it('navigates to the new project on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(createdProject('proj_xyz'));
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[]} />);
    await user.click(screen.getByRole('button', { name: /Create your first project/ }));

    await user.type(screen.getByLabelText('Project name'), 'first');
    await user.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/projects/proj_xyz/overview'));
  });

  it("surfaces the API's own rejection instead of a generic message", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ message: 'A project with that name already exists' }),
    });
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    await user.type(screen.getByLabelText('Project name'), 'acme-video');
    await user.click(submitButton());

    expect(await screen.findByText('A project with that name already exists')).toBeInTheDocument();
    // The dialog stays open so the name can be corrected without retyping.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('reports an unreachable server without claiming the project was created', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    await user.type(screen.getByLabelText('Project name'), 'acme');
    await user.click(submitButton());

    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    const trigger = screen.getByRole('button', { name: /New project/ });
    await user.click(trigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('discards a half-typed name when reopened, rather than resuming it', async () => {
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);

    await user.click(screen.getByRole('button', { name: /New project/ }));
    await user.type(screen.getByLabelText('Project name'), 'abandoned');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /New project/ }));
    expect(screen.getByLabelText('Project name')).toHaveValue('');
  });

  it('caps both fields at the lengths the API accepts', async () => {
    const user = userEvent.setup();
    render(<ProjectsList initialProjects={[PROJECT]} />);
    await user.click(screen.getByRole('button', { name: /New project/ }));

    expect(screen.getByLabelText('Project name')).toHaveAttribute('maxlength', '80');
    expect(screen.getByLabelText('Description (optional)')).toHaveAttribute('maxlength', '500');
  });
});
