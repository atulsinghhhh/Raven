import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { getSessionToken } from '@/lib/session';
import { listAdmins, type PlatformAdminRow } from '@/lib/super-admin/ops';
import { ApiError, superAdminApi, type AuthenticatedPlatformAdmin } from '@/lib/super-admin-client';
import { AdminsManager } from './admins-manager';

/**
 * Admins management (spec §3/§9): who holds a platform role today, plus
 * granting/revoking one. Granting and revoking are SUPER_ADMIN-only at
 * the API — a SUPPORT/ADMIN/READ_ONLY viewer sees the list but the
 * mutating controls are hidden client-side by `AdminsManager`, purely
 * for UX; the real boundary is `PlatformRoleGuard` re-checking on every
 * write.
 */
export default async function SuperAdminAdminsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/admins');

  let data: { admins: PlatformAdminRow[]; me: AuthenticatedPlatformAdmin } | null = null;
  let loadError: ApiError | null = null;

  try {
    const [admins, me] = await Promise.all([listAdmins(token), superAdminApi.me(token)]);
    data = { admins, me };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin/admins');
    if (err instanceof ApiError) {
      loadError = err;
    } else {
      throw err;
    }
  }

  if (loadError || !data) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Admins" eyebrow="Console" />
        <ErrorState
          title="Could not load admins"
          description="The Control API is unreachable right now. Retry in a moment."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Admins"
        eyebrow="Console"
        description="Everyone with Super Admin Portal access. Granting or revoking a platform role is the most sensitive action in this console — both require a stated reason and only a Super Admin can perform them."
      />
      <AdminsManager
        initialAdmins={data.admins}
        currentAdminId={data.me.id}
        canManage={data.me.platformRole === 'SUPER_ADMIN'}
      />
    </div>
  );
}
