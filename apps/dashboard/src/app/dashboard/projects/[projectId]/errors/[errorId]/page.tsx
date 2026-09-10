import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi, type ErrorCategory } from '@/lib/api-client';
import { ConnectionStateBadge, ErrorCategoryBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, SectionHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { IconChevronRight } from '@/components/ui/icons';
import { KeyValue, KeyValueGrid, MonoId } from '@/components/ui/mono';
import { PageHeader } from '@/components/ui/page-header';
import { Dash, EmptyState, ErrorState } from '@/components/ui/states';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';

const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  AUTHENTICATION_ERROR: 'Authentication error',
  AUTHORIZATION_ERROR: 'Authorization error',
  TOKEN_ERROR: 'Token error',
  SIGNALING_ERROR: 'Signaling error',
  ICE_ERROR: 'ICE error',
  TURN_ERROR: 'TURN error',
  SFU_ERROR: 'SFU error',
  NETWORK_ERROR: 'Network error',
  CLIENT_ERROR: 'Client error',
  UNKNOWN_ERROR: 'Unknown error',
};

export default async function ErrorDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; errorId: string }>;
}) {
  const { projectId, errorId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let error;
  try {
    error = await ravenApi.getError(token, projectId, errorId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    if (err instanceof ApiError && err.status === 404) {
      return (
        <EmptyState
          title="Error not found"
          description="This error id doesn't exist under this project. It may have aged out under the project's retention policy, or it belongs to a different project."
          action={
            <ButtonLink href={`${base}/errors`} variant="primary">
              Back to errors
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this error"
        description="The Control API is unreachable right now. Your telemetry is unaffected — retry in a moment."
        retryHref={`${base}/errors/${errorId}`}
      />
    );
  }

  const hasDiagnosis = error.likelyCause !== null || error.suggestedAction !== null;
  const connection = error.connection;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumb={{ label: 'All errors', href: `${base}/errors` }}
        title={CATEGORY_LABEL[error.category] ?? 'Error'}
        meta={<ErrorCategoryBadge category={error.category} />}
        actions={
          connection ? (
            <ButtonLink href={`${base}/connections/${connection.publicId}`} variant="secondary">
              Open connection
            </ButtonLink>
          ) : undefined
        }
      />

      <Card>
        <p className="text-base leading-relaxed text-fg">{error.message}</p>
        <p className="mt-3 text-xs text-muted">
          Reported{' '}
          <time dateTime={error.timestamp} title={formatDateTime(error.timestamp)} className="tabular">
            {formatRelative(error.timestamp)}
          </time>{' '}
          · {formatDateTime(error.timestamp)}
        </p>
      </Card>

      {hasDiagnosis && (
        <section>
          <SectionHeader
            title="Diagnosis"
            subtitle="Best effort. Livqeno infers this from the error category and the payload the SDK sent — treat it as a starting point, not a verdict."
          />
          <Card>
            <div className="flex flex-col gap-4">
              {error.likelyCause && (
                <div>
                  <h3 className="text-xs font-medium text-muted">Likely cause</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg">{error.likelyCause}</p>
                </div>
              )}
              {error.suggestedAction && (
                <div>
                  <h3 className="text-xs font-medium text-muted">Suggested action</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg">{error.suggestedAction}</p>
                </div>
              )}
            </div>
          </Card>
        </section>
      )}

      <section>
        <SectionHeader title="Details" subtitle="Exactly what was recorded with this report — nothing inferred." />
        <Card>
          <KeyValueGrid>
            <KeyValue label="Error ID">
              <span className="inline-flex items-center gap-1.5">
                <span className="truncate font-mono text-xs" title={error.publicId}>
                  {error.publicId}
                </span>
                <CopyButton value={error.publicId} iconOnly label="Copy error ID" />
              </span>
            </KeyValue>
            <KeyValue label="Reported at">
              <time dateTime={error.timestamp} className="tabular">
                {formatDateTime(error.timestamp)}
              </time>
            </KeyValue>
            <KeyValue label="SDK version" mono>
              {error.sdkVersion ?? <Dash />}
            </KeyValue>
            <KeyValue label="Platform">{error.platform ?? <Dash />}</KeyValue>
            <KeyValue label="Connection">
              {error.connectionId ? (
                <MonoId value={error.connectionId} href={`${base}/connections/${error.connectionId}`} />
              ) : (
                <Dash />
              )}
            </KeyValue>
            <KeyValue label="Room">
              {error.roomId ? <MonoId value={error.roomId} href={`${base}/rooms/${error.roomId}`} /> : <Dash />}
            </KeyValue>
            <KeyValue label="Participant" mono>
              {error.participantId ?? <Dash />}
            </KeyValue>
          </KeyValueGrid>
        </Card>
      </section>

      <section>
        <SectionHeader title="Connection" subtitle="The RTC session this error was reported against." />
        {connection ? (
          <Card padded={false}>
            <div className="p-5">
              <CardHeader
                title={<span className="font-mono text-xs">{connection.publicId}</span>}
                subtitle={`${connection.participantIdentity} in ${connection.roomName}`}
                action={<ConnectionStateBadge state={connection.state} />}
              />
              <KeyValueGrid>
                <KeyValue label="Participant">{connection.participantIdentity}</KeyValue>
                <KeyValue label="Room">{connection.roomName}</KeyValue>
                <KeyValue label="Duration">
                  <span className="tabular">{formatDuration(connection.durationMs)}</span>
                </KeyValue>
                <KeyValue label="Region">{connection.region ?? <Dash />}</KeyValue>
                <KeyValue label="Started">
                  <time dateTime={connection.startedAt} className="tabular">
                    {formatDateTime(connection.startedAt)}
                  </time>
                </KeyValue>
                <KeyValue label="Reconnects">
                  <span className="tabular">{connection.reconnectCount}</span>
                </KeyValue>
              </KeyValueGrid>
            </div>
            <div className="border-t border-line px-5 py-3">
              <a
                href={`${base}/connections/${connection.publicId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
              >
                Full connection timeline
                <IconChevronRight className="size-3" />
              </a>
            </div>
          </Card>
        ) : error.connectionId ? (
          <Card>
            <p className="text-sm leading-relaxed text-muted">
              This error references connection{' '}
              <span className="font-mono text-xs text-fg">{error.connectionId}</span>, but its record is no longer
              available — most likely it aged out under this project&apos;s retention policy.
            </p>
          </Card>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-muted">
              This error was reported outside a connection — typically during token minting or before the client reached
              the signaling gateway, so there is no RTC session to inspect.
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}
