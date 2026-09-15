import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MembersManager } from '@/app/dashboard/projects/[projectId]/members/members-manager';
import type { ProjectMember } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';

jest.mock('@/lib/session-expiry', () => ({ handleSessionExpiry: jest.fn() }));

function member(userId: string, overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    userId,
    email: `${userId}@example.com`,
    name: null,
    role: 'DEVELOPER',
    capabilities: [],
    invitedById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const OWNER = member('u-owner', { email: 'owner@example.com', role: 'OWNER' });

describe('MembersManager', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.spyOn(toast, 'success').mockImplementation(() => 'toast_test');
    jest.spyOn(toast, 'error').mockImplementation(() => 'toast_test');
    (handleSessionExpiry as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the initial member list', () => {
    render(
      <MembersManager
        projectId="proj-1"
        initialMembers={[OWNER, member('u-1')]}
        currentUserEmail="owner@example.com"
        canManage
      />,
    );
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('u-1@example.com')).toBeInTheDocument();
  });

  it('adds a member on success, with a toast and no inline error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => member('u-new', { email: 'new@example.com' }),
    });
    const user = userEvent.setup();
    render(<MembersManager projectId="proj-1" initialMembers={[OWNER]} currentUserEmail="owner@example.com" canManage />);

    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(screen.getByText('new@example.com')).toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('Member invited');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows both a toast and the inline ErrorState when adding a member fails, and does not add a row', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: 'NOT_FOUND', message: 'No account with that email' }),
    });
    const user = userEvent.setup();
    render(<MembersManager projectId="proj-1" initialMembers={[OWNER]} currentUserEmail="owner@example.com" canManage />);

    await user.type(screen.getByLabelText('Email'), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(screen.getByText('No account with that email')).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith('No account with that email');
    expect(screen.queryByText('ghost@example.com')).not.toBeInTheDocument();
  });

  it('a network failure while adding a member shows the same message inline and as a toast', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<MembersManager projectId="proj-1" initialMembers={[OWNER]} currentUserEmail="owner@example.com" canManage />);

    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    const message = 'Could not reach the Control API. Nothing was changed.';
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith(message);
  });

  it('removing a member requires a second, restated confirmation before DELETE fires', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });
    const user = userEvent.setup();
    render(
      <MembersManager
        projectId="proj-1"
        initialMembers={[OWNER, member('u-1')]}
        currentUserEmail="owner@example.com"
        canManage
      />,
    );

    const row = screen.getByText('u-1@example.com').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));

    // First click only reveals the restated-consequence confirm row — it
    // must not have fired the request yet.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove .* from this project\? They lose access immediately\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));

    await waitFor(() => expect(screen.queryByText('u-1@example.com')).not.toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/members/u-1', { method: 'DELETE' });
    expect(toast.success).toHaveBeenCalledWith('Member removed');
  });

  it('cancelling the confirmation leaves the member in place and never calls DELETE', async () => {
    const user = userEvent.setup();
    render(
      <MembersManager
        projectId="proj-1"
        initialMembers={[OWNER, member('u-1')]}
        currentUserEmail="owner@example.com"
        canManage
      />,
    );

    const row = screen.getByText('u-1@example.com').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('u-1@example.com')).toBeInTheDocument();
    // Back to the trigger button, not stuck on the confirm row.
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('a failed remove keeps the member in the list and reports the error inline and as a toast', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ code: 'INTERNAL', message: 'Could not remove this member' }),
    });
    const user = userEvent.setup();
    render(
      <MembersManager
        projectId="proj-1"
        initialMembers={[OWNER, member('u-1')]}
        currentUserEmail="owner@example.com"
        canManage
      />,
    );

    const row = screen.getByText('u-1@example.com').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not remove this member'));
    expect(screen.getByText('u-1@example.com')).toBeInTheDocument();
  });

  it('changing a role calls PATCH and updates the badge/select on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => member('u-1', { role: 'ADMIN' }),
    });
    const user = userEvent.setup();
    render(
      <MembersManager
        projectId="proj-1"
        initialMembers={[OWNER, member('u-1')]}
        currentUserEmail="owner@example.com"
        canManage
      />,
    );

    await user.selectOptions(screen.getByLabelText('Role for u-1@example.com'), 'ADMIN');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Member role updated'));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/members/u-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('a failed role change leaves the select at its prior value and reports the error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION_ERROR', message: 'Could not change this role' }),
    });
    const user = userEvent.setup();
    render(
      <MembersManager
        projectId="proj-1"
        initialMembers={[OWNER, member('u-1')]}
        currentUserEmail="owner@example.com"
        canManage
      />,
    );

    const select = screen.getByLabelText('Role for u-1@example.com') as HTMLSelectElement;
    await user.selectOptions(select, 'ADMIN');

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not change this role'));
    // Not bound to local optimistic state — nothing to roll back, the select
    // still reflects the member's real (unchanged) role.
    expect(select.value).toBe('DEVELOPER');
  });

  it('defers to handleSessionExpiry on a 401 from any mutation, without the generic toast/inline error', async () => {
    (handleSessionExpiry as jest.Mock).mockReturnValue(true);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'Not signed in' }),
    });
    const user = userEvent.setup();
    render(<MembersManager projectId="proj-1" initialMembers={[OWNER]} currentUserEmail="owner@example.com" canManage />);

    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(handleSessionExpiry).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText('Not signed in')).not.toBeInTheDocument();
  });

  it('the last remaining owner cannot be removed or demoted', () => {
    render(<MembersManager projectId="proj-1" initialMembers={[OWNER]} currentUserEmail="owner@example.com" canManage />);

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByText(/only owner/)).toBeInTheDocument();
  });

  describe('canManage=false (read-only viewer)', () => {
    // Every test above renders with canManage — none of them prove the
    // server-enforced read-only path (see members/page.tsx's own capability
    // check) actually hides the controls it's meant to hide, as opposed to
    // merely disabling them. A VIEWER role gets no management UI at all,
    // not a management UI with everything greyed out.
    it('does not render the "Add a member" form', () => {
      render(
        <MembersManager
          projectId="proj-1"
          initialMembers={[OWNER]}
          currentUserEmail="viewer@example.com"
          canManage={false}
        />,
      );

      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    });

    it('shows each member’s role as a static badge instead of an editable select', () => {
      render(
        <MembersManager
          projectId="proj-1"
          initialMembers={[OWNER]}
          currentUserEmail="viewer@example.com"
          canManage={false}
        />,
      );

      expect(screen.getByText('owner')).toBeInTheDocument();
      expect(screen.queryByLabelText(`Role for ${OWNER.email}`)).not.toBeInTheDocument();
    });

    it('offers no Remove control for any member, including a non-owner', () => {
      const developer = member('u-dev', { email: 'dev@example.com', role: 'DEVELOPER' });
      render(
        <MembersManager
          projectId="proj-1"
          initialMembers={[OWNER, developer]}
          currentUserEmail="viewer@example.com"
          canManage={false}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('never issues a mutation request — the read-only view has no path that could call fetch', () => {
      render(
        <MembersManager
          projectId="proj-1"
          initialMembers={[OWNER]}
          currentUserEmail="viewer@example.com"
          canManage={false}
        />,
      );

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
