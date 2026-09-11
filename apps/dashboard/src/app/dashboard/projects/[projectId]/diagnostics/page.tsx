import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import { deriveSystemStatus, StatusBadge, SystemStatusIndicator } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, SectionHeader, StatCard } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { KeyValue, KeyValueGrid } from '@/components/ui/mono';
import { PageHeader } from '@/components/ui/page-header';
import { ProductTabs, rtcTabs } from '@/components/shell/product-tabs';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import { MobileList, MobileRow, Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatCount } from '@/lib/format';

/**
 * The page a developer opens when something is broken.
 *
 * Two independent sources: the project-scoped diagnostics endpoint (auth
 * required, tells you about *your* project) and the platform health
 * endpoint. Either can fail on its own, and the page still renders
 * whatever the other one returned: with the gap named explicitly, since
 * "unknown" and "healthy" must never look the same here.
 */

type CheckStatus = 'up' | 'down' | 'unknown';

interface Check {
  key: string;
  name: string;
  scope: string;
  status: CheckStatus;
  role: string;
  ifDown: string;
}

export default async function DiagnosticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const [diagnosticsResult, healthResult] = await Promise.allSettled([
    ravenApi.getDiagnostics(token, projectId),
    ravenApi.getHealth(),
  ]);

  if (
    diagnosticsResult.status === 'rejected' &&
    diagnosticsResult.reason instanceof ApiError &&
    diagnosticsResult.reason.status === 401
  ) {
    redirect('/login');
  }

  const base = `/dashboard/projects/${projectId}`;

  if (diagnosticsResult.status === 'rejected' && healthResult.status === 'rejected') {
    return (
      <ErrorState
        title="No checks could be run"
        description="Neither the project diagnostics endpoint nor the platform health endpoint responded. The Control API itself is unreachable from this console — that is the first thing to investigate."
        retryHref={`${base}/diagnostics`}
      />
    );
  }

  const diagnostics = diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : undefined;
  const health = healthResult.status === 'fulfilled' ? healthResult.value : undefined;

  // /health alone is enough to call the Control API up — it's the API that
  // serves that endpoint. Authentication can't take that shortcut: only the
  // authenticated project check proves the session itself is valid.
  const checks: Check[] = [
    {
      key: 'api',
      name: 'Control API',
      scope: 'Platform',
      status: diagnostics?.api === 'up' ? 'up' : health ? 'up' : 'unknown',
      role: 'Serves this dashboard, your server-side SDK calls, project and API key management, and RTC token minting.',
      ifDown: 'No new tokens can be minted and no telemetry is recorded. Media already flowing is unaffected.',
    },
    {
      key: 'authentication',
      name: 'Authentication',
      scope: 'This project',
      status: diagnostics?.authentication === 'ok' ? 'up' : 'unknown',
      role: 'Validates dashboard sessions and the API keys your backend uses to mint RTC tokens.',
      ifDown: 'Token minting and dashboard access stop. Participants already in a room stay connected.',
    },
    {
      key: 'signaling',
      name: 'Signaling',
      scope: 'This project',
      status: diagnostics?.dependencies.signaling ?? 'unknown',
      role: 'The WebSocket gateway every client connects to first, to negotiate and exchange session state.',
      ifDown: 'New participants cannot join or renegotiate. Existing peers hold until they next need to renegotiate.',
    },
    {
      key: 'sfu',
      name: 'SFU',
      scope: 'This project',
      status: diagnostics?.dependencies.sfu ?? health?.dependencies.sfu ?? 'unknown',
      role: 'Routes audio and video between participants so each client sends its stream once instead of to every peer.',
      ifDown: 'Media stops flowing, including for participants already in a room. This is the most visible failure.',
    },
    {
      key: 'turn',
      name: 'TURN',
      scope: 'This project',
      status: diagnostics?.dependencies.turn ?? health?.dependencies.turn ?? 'unknown',
      role: 'Relays media when a direct path is blocked by NAT or a restrictive firewall.',
      ifDown:
        'Connections still succeed on permissive networks and fail on corporate or mobile ones — often reported as "works for me".',
    },
    {
      key: 'database',
      name: 'Database',
      scope: 'Platform',
      status: health?.dependencies.database ?? 'unknown',
      role: 'Stores control-plane state: projects, API keys, rooms, connection records and errors.',
      ifDown: 'Token minting and this console stop working. Live media keeps flowing until a client needs a new token.',
    },
    {
      key: 'redis',
      name: 'Redis',
      scope: 'Platform',
      status: health?.dependencies.redis ?? 'unknown',
      role: 'Shares signaling state across API instances so any node can answer for any room.',
      ifDown:
        'Participants handled by different nodes can lose sight of each other, and reconnects behave inconsistently.',
    },
  ];

  const known = Object.fromEntries(
    checks.filter((c) => c.status !== 'unknown').map((c) => [c.key, c.status as 'up' | 'down']),
  );
  const systemStatus = deriveSystemStatus(Object.keys(known).length > 0 ? known : undefined);
  const downCount = checks.filter((c) => c.status === 'down').length;
  const unknownCount = checks.filter((c) => c.status === 'unknown').length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Diagnostics"
        description="Live dependency checks for this project and the platform behind it, run fresh on every load. Start here when connections are failing and you don't yet know whose fault it is."
        actions={
          <ButtonLink href={`${base}/errors`} variant="secondary">
            View errors
          </ButtonLink>
        }
      />
      <ProductTabs tabs={rtcTabs(base)} active="Diagnostics" />

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">
              {systemStatus === 'operational'
                ? 'Everything Livqeno can check is responding'
                : systemStatus === 'unknown'
                  ? 'Livqeno could not determine system status'
                  : `${formatCount(downCount)} of ${formatCount(checks.length)} checks are failing`}
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
              {systemStatus === 'operational'
                ? 'If connections are still failing, the cause is most likely client-side or network-side — check the error explorer and the individual connection timelines.'
                : systemStatus === 'unknown'
                  ? 'No dependency reported a definite state. Treat the rows below as unverified rather than healthy.'
                  : 'The failing dependencies below explain what breaks and what keeps working while they are down.'}
              {unknownCount > 0 && ` ${formatCount(unknownCount)} check(s) could not be verified.`}
            </p>
          </div>
          <div className="shrink-0">
            <SystemStatusIndicator status={systemStatus} />
          </div>
        </div>
      </Card>

      {diagnosticsResult.status === 'rejected' && (
        <ErrorState
          title="The project-scoped check failed"
          description={
            diagnosticsResult.reason instanceof ApiError && diagnosticsResult.reason.status === 404
              ? 'This project was not found by the diagnostics endpoint. Platform health below is still accurate; project-specific signaling, SFU and TURN checks are not.'
              : 'Livqeno could not run the checks scoped to this project. Anything below marked "Platform" still comes from the live health endpoint — the project-scoped rows are unverified.'
          }
          retryHref={`${base}/diagnostics`}
        />
      )}

      <section>
        <SectionHeader
          title="Active now"
          subtitle="Live counts, not a windowed aggregate — these reflect the moment this page rendered."
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Active connections"
            value={diagnostics ? formatCount(diagnostics.connections.active) : <NoDataYet label="Unverified" />}
            hint="This project"
          />
          <StatCard
            label="Gateway connections"
            value={health ? formatCount(health.signaling.activeConnections) : <NoDataYet label="Unverified" />}
            hint="All projects on this deployment"
          />
          <StatCard
            label="Gateway rooms"
            value={health ? formatCount(health.signaling.activeRooms) : <NoDataYet label="Unverified" />}
            hint="All projects on this deployment"
          />
          <StatCard
            label="Gateway participants"
            value={health ? formatCount(health.signaling.activeParticipants) : <NoDataYet label="Unverified" />}
            hint="All projects on this deployment"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Dependencies"
          subtitle="What each piece does, and what it means for your users when it stops."
        />

        <TableWrap className="hidden sm:block">
          <Table>
            <THead>
              <TH>Component</TH>
              <TH>Status</TH>
              <TH>What it does</TH>
            </THead>
            <TBody>
              {checks.map((check) => (
                <TR key={check.key}>
                  <TD className="align-top">
                    <div className="font-medium whitespace-nowrap text-fg">{check.name}</div>
                    <div className="mt-0.5 text-xs text-subtle">{check.scope}</div>
                  </TD>
                  <TD className="align-top">
                    <StatusBadge status={check.status} />
                  </TD>
                  <TD className="align-top">
                    <p className="max-w-xl text-sm leading-relaxed text-muted">{check.role}</p>
                    <p
                      className={`mt-1 max-w-xl text-xs leading-relaxed ${
                        check.status === 'down' ? 'text-danger-text' : 'text-subtle'
                      }`}
                    >
                      <span className="font-medium">If it&apos;s down: </span>
                      {check.ifDown}
                    </p>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>

        <div className="sm:hidden">
          <MobileList>
            {checks.map((check) => (
              <MobileRow key={check.key}>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg">{check.name}</div>
                    <div className="text-xs text-subtle">{check.scope}</div>
                  </div>
                  <StatusBadge status={check.status} />
                </div>
                <p className="text-xs leading-relaxed text-muted">{check.role}</p>
                <p
                  className={`mt-1.5 text-xs leading-relaxed ${
                    check.status === 'down' ? 'text-danger-text' : 'text-subtle'
                  }`}
                >
                  <span className="font-medium">If it&apos;s down: </span>
                  {check.ifDown}
                </p>
              </MobileRow>
            ))}
          </MobileList>
        </div>
      </section>

      <section>
        <SectionHeader title="For support" subtitle="Quote these when you report a problem to us." />
        <Card>
          <KeyValueGrid>
            <KeyValue label="Project ID">
              <span className="inline-flex items-center gap-1.5">
                <span className="truncate font-mono text-xs" title={diagnostics?.project.id ?? projectId}>
                  {diagnostics?.project.id ?? projectId}
                </span>
                <CopyButton value={diagnostics?.project.id ?? projectId} iconOnly label="Copy project ID" />
              </span>
            </KeyValue>
            <KeyValue label="Project name">{diagnostics?.project.name ?? <NoDataYet label="Unverified" />}</KeyValue>
            <KeyValue label="Platform health">
              {health ? health.status === 'ok' ? 'ok' : 'degraded' : <NoDataYet label="Unverified" />}
            </KeyValue>
            <KeyValue label="Checks failing">
              <span className="tabular">
                {formatCount(downCount)} of {formatCount(checks.length)}
              </span>
            </KeyValue>
          </KeyValueGrid>
        </Card>
      </section>
    </div>
  );
}
