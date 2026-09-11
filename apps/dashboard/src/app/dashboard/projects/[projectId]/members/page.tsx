import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MembersManager } from './members-manager';

/**
 * Who can reach this project, and what each of them may do.
 *
 * The capability list comes from the API rather than being re-derived
 * here: two copies of the permission matrix would drift, and the
 * front-end copy is the one that would be wrong.
 */
export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const email = decodeSessionEmail(token);
  const base = `/dashboard/projects/${projectId}`;

  let members;
  try {
    members = await ravenApi.listMembers(token, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');

    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Project not found"
          description="This project no longer exists, or it belongs to a different account."
          action={
            <ButtonLink href="/dashboard/projects" variant="primary">
              Back to projects
            </ButtonLink>
          }
        />
      );
    }

    return (
      <ErrorState
        title="Could not load members"
        description="The Control API is unreachable right now. Nothing has changed — retry in a moment."
        retryHref={`${base}/members`}
      />
    );
  }

  // Whether to render the management controls at all. The server enforces
  // this regardless — asking the API what this user can do, instead of
  // guessing from their role, keeps the two in agreement.
  const viewer = members.find((m) => m.email === email);
  const canManage = viewer?.capabilities.includes('members:manage') ?? false;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Members"
        description={
          canManage
            ? 'Everyone with access to this project. Roles decide what each person can do — see the docs for the full capability table.'
            : 'Everyone with access to this project. Your role does not allow changing membership, so this view is read-only.'
        }
      />

      <MembersManager
        projectId={projectId}
        initialMembers={members}
        currentUserEmail={email ?? null}
        canManage={canManage}
      />
    </div>
  );
}
