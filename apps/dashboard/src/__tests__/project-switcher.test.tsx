import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSwitcher } from '@/components/shell/project-switcher';
import type { Project } from '@/lib/api-client';

const push = jest.fn();
let pathname = '/dashboard/projects/proj_1/webhooks';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

function project(id: string, name: string): Project {
  return { id, name, description: null, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' } as Project;
}

const CURRENT = project('proj_1', 'acme-video');
const OTHER = project('proj_2', 'acme-chat');

async function openSwitcher() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Switch project' }));
  return user;
}

describe('ProjectSwitcher', () => {
  beforeEach(() => {
    push.mockClear();
    pathname = '/dashboard/projects/proj_1/webhooks';
  });

  it("shows the current project's name on the trigger", () => {
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    expect(screen.getByText('acme-video')).toBeInTheDocument();
  });

  it('lists every project as a menu item when opened', async () => {
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    await openSwitcher();

    expect(screen.getByRole('menuitem', { name: 'acme-video' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'acme-chat' })).toBeInTheDocument();
  });

  it('selecting a different project navigates to the same section under the new project id', async () => {
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    const user = await openSwitcher();

    await user.click(screen.getByRole('menuitem', { name: 'acme-chat' }));

    expect(push).toHaveBeenCalledWith('/dashboard/projects/proj_2/webhooks');
  });

  it('falls back to overview when the current path has no recognisable project section', async () => {
    pathname = '/dashboard/projects';
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    const user = await openSwitcher();

    await user.click(screen.getByRole('menuitem', { name: 'acme-chat' }));

    expect(push).toHaveBeenCalledWith('/dashboard/projects/proj_2/overview');
  });

  it('re-selecting the already-current project still lands on its overview, not the current section', async () => {
    // targetPath's own rule: currentId === nextId short-circuits to
    // overview regardless of section, since there's nothing to preserve
    // "from" — you're already there.
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    const user = await openSwitcher();

    await user.click(screen.getByRole('menuitem', { name: 'acme-video' }));

    expect(push).toHaveBeenCalledWith('/dashboard/projects/proj_1/overview');
  });

  it('does not show a search box for a short project list', async () => {
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    await openSwitcher();

    expect(screen.queryByRole('textbox', { name: 'Find a project' })).not.toBeInTheDocument();
  });

  it('shows and applies a search filter once there are enough projects to need one', async () => {
    const many = [CURRENT, OTHER, ...Array.from({ length: 5 }, (_, i) => project(`proj_x${i}`, `other-${i}`))];
    render(<ProjectSwitcher projects={many} current={CURRENT} />);
    const user = await openSwitcher();

    const search = screen.getByRole('textbox', { name: 'Find a project' });
    await user.type(search, 'chat');

    expect(screen.getByRole('menuitem', { name: 'acme-chat' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'acme-video' })).not.toBeInTheDocument();
  });

  it('shows a no-match message instead of an empty list when nothing matches the search', async () => {
    const many = [CURRENT, OTHER, ...Array.from({ length: 5 }, (_, i) => project(`proj_x${i}`, `other-${i}`))];
    render(<ProjectSwitcher projects={many} current={CURRENT} />);
    const user = await openSwitcher();

    await user.type(screen.getByRole('textbox', { name: 'Find a project' }), 'nonexistent');

    expect(screen.getByText(/No projects match/)).toBeInTheDocument();
  });

  it('offers links to all projects, creating a new project, and this project’s settings', async () => {
    render(<ProjectSwitcher projects={[CURRENT, OTHER]} current={CURRENT} />);
    await openSwitcher();

    expect(screen.getByRole('menuitem', { name: 'All projects' })).toHaveAttribute('href', '/dashboard/projects');
    expect(screen.getByRole('menuitem', { name: 'New project' })).toHaveAttribute(
      'href',
      '/dashboard/projects?new=1',
    );
    expect(screen.getByRole('menuitem', { name: 'Project settings' })).toHaveAttribute(
      'href',
      '/dashboard/projects/proj_1/settings',
    );
  });
});
