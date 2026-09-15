import { render, screen } from '@testing-library/react';
import { ProjectProvider, useProject } from '@/lib/project-context';
import type { Project } from '@/lib/api-client';

function project(id: string, name: string): Project {
  return { id, name, description: null, status: 'ACTIVE', ownerId: 'user-1', createdAt: '', updatedAt: '' };
}

function Consumer() {
  const { project, projectId, capabilities } = useProject();
  return (
    <div>
      <span data-testid="project-id">{projectId}</span>
      <span data-testid="project-name">{project.name}</span>
      <span data-testid="capabilities">{capabilities.join(',')}</span>
    </div>
  );
}

describe('ProjectProvider / useProject', () => {
  it('exposes the exact project and derives projectId from it', () => {
    render(
      <ProjectProvider project={project('proj-1', 'Demo App')} capabilities={[]}>
        <Consumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('project-id')).toHaveTextContent('proj-1');
    expect(screen.getByTestId('project-name')).toHaveTextContent('Demo App');
  });

  it('throws when called outside a ProjectProvider, rather than silently returning a null-ish default', () => {
    // Swallow the expected React error-boundary console noise for this
    // one assertion.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/useProject\(\) must be called/);
    spy.mockRestore();
  });

  it('passes backend-provided capabilities through unchanged — no filtering, no re-derivation', () => {
    // A capability string a real role→capability matrix would never
    // produce on its own. If this survives to the consumer verbatim, the
    // context is a pure passthrough, not reimplementing Phase 1's matrix
    // (apps/api/src/modules/projects/project-permissions.ts) or applying
    // any logic of its own.
    const weird = ['members:manage', 'some-made-up-capability:xyz'];
    render(
      <ProjectProvider project={project('proj-1', 'Demo')} capabilities={weird}>
        <Consumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('capabilities')).toHaveTextContent('members:manage,some-made-up-capability:xyz');
  });

  it('exposes an empty capabilities array as-is — never upgraded to "everything", never blocked', () => {
    render(
      <ProjectProvider project={project('proj-1', 'Demo')} capabilities={[]}>
        <Consumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('capabilities')).toHaveTextContent('');
  });

  it('updates every consumer when the provider re-renders with a different project — the switching case', () => {
    // Mirrors what actually happens when ProjectSwitcher navigates to a
    // new project URL: the server layout re-runs, AppShell receives a
    // new `currentProject`, and re-renders ProjectProvider with it. No
    // client-side switch handling lives in the context itself — this
    // just proves a prop change propagates correctly to every consumer.
    const { rerender } = render(
      <ProjectProvider project={project('proj-a', 'Project A')} capabilities={['keys:read']}>
        <Consumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('project-id')).toHaveTextContent('proj-a');
    expect(screen.getByTestId('capabilities')).toHaveTextContent('keys:read');

    rerender(
      <ProjectProvider project={project('proj-b', 'Project B')} capabilities={['billing:manage']}>
        <Consumer />
      </ProjectProvider>,
    );

    // No stale project-a data left behind anywhere.
    expect(screen.getByTestId('project-id')).toHaveTextContent('proj-b');
    expect(screen.getByTestId('project-name')).toHaveTextContent('Project B');
    expect(screen.getByTestId('capabilities')).toHaveTextContent('billing:manage');
    expect(screen.queryByText('proj-a')).not.toBeInTheDocument();
  });

  it('multiple consumers under the same provider all see the same, single value', () => {
    function SecondConsumer() {
      const { projectId } = useProject();
      return <span data-testid="second-project-id">{projectId}</span>;
    }
    render(
      <ProjectProvider project={project('proj-1', 'Demo')} capabilities={[]}>
        <Consumer />
        <SecondConsumer />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('project-id')).toHaveTextContent('proj-1');
    expect(screen.getByTestId('second-project-id')).toHaveTextContent('proj-1');
  });
});
