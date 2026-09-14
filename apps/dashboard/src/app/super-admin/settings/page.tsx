import { redirect } from 'next/navigation';
import { Card, CardHeader, SectionHeader } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState } from '@/components/ui/states';
import { getSessionToken } from '@/lib/session';
import { getSettings, type PlatformRoleName, type SettingsResponse } from '@/lib/super-admin/ops';
import { ApiError } from '@/lib/super-admin-client';

/**
 * Retention policy + platform-role reference (spec §21). Intentionally
 * static and read-only in this pass — no forms, no editable config. The
 * content itself comes from the API's hardcoded response
 * (`SettingsController`), which mirrors
 * docs/super-admin/implementation-plan.md §3 verbatim.
 */

const ROLE_TONE: Record<PlatformRoleName, BadgeTone> = {
  SUPER_ADMIN: 'danger',
  ADMIN: 'accent',
  SUPPORT: 'info',
  READ_ONLY: 'neutral',
};

const ROLE_LABEL: Record<PlatformRoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SUPPORT: 'Support',
  READ_ONLY: 'Read only',
};

const RETENTION_LABEL: Record<string, string> = {
  adminAuditLogs: 'Admin audit logs',
  securityEvents: 'Security-relevant activity events',
  businessActivityEvents: 'Business activity events',
  highVolumeTelemetry: 'High-volume telemetry (connections, connection events, chat messages)',
};

export default async function SuperAdminSettingsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/settings');

  let data: SettingsResponse | null = null;
  let loadError: ApiError | null = null;

  try {
    data = await getSettings(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?next=/super-admin/settings');
    if (err instanceof ApiError) {
      loadError = err;
    } else {
      throw err;
    }
  }

  if (loadError || !data) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Settings" eyebrow="Console" />
        <ErrorState title="Could not load settings" description="The Control API is unreachable right now. Retry in a moment." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        eyebrow="Console"
        description="Reference documentation: what happens to platform data over time, and what each platform role can do. Nothing on this page is editable."
      />

      <section>
        <SectionHeader
          title="Data retention"
          subtitle="Documented now, enforced later — see implementation-plan.md §3 for the reasoning behind each entry."
        />
        <Card padded={false}>
          <dl className="divide-y divide-line">
            {Object.entries(data.retentionPolicy).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <dt className="text-sm font-medium text-fg">{RETENTION_LABEL[key] ?? key}</dt>
                <dd className="text-sm text-muted sm:text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section>
        <SectionHeader title="Platform roles" subtitle="What each role can and cannot do across this console." />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.platformRoles.map((role) => (
            <Card key={role.role}>
              <CardHeader title={<Badge tone={ROLE_TONE[role.role]}>{ROLE_LABEL[role.role]}</Badge>} subtitle={role.summary} />
              <ul className="flex flex-col gap-1.5 text-sm text-muted">
                {role.canDo.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-subtle" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
