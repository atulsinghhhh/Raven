'use client';

import { useCallback, useRef, useState } from 'react';
import type { CreatedWebhookEndpoint, WebhookEndpointSummary } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { IconWebhooks } from '@/components/ui/icons';
import { formatRelative } from '@/lib/format';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';
import { errorMessage, readJson } from '@/lib/client-fetch';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import { useDebouncedRefetch } from '@/lib/realtime/use-debounced-refetch';
import type { DashboardRealtimeSocketFactory } from '@/lib/realtime/dashboard-realtime-transport';

/** The event types the API will accept. Kept in sync with WEBHOOK_EVENT_TYPES server-side. */
const EVENT_TYPES = [
  'message.created',
  'message.updated',
  'message.deleted',
  'reaction.added',
  'reaction.removed',
  'room.created',
  'participant.joined',
  'participant.left',
] as const;

/**
 * Like an API key's secret, a webhook's signing secret is shown exactly
 * once: it exists in this UI for a single render after creation and is
 * never retrievable afterwards. Unlike an API key it *is* stored
 * server-side (signing each delivery needs it), which is why the copy
 * panel says so plainly, not implying it's unrecoverable.
 *
 * Livqeno auto-disables an endpoint after enough consecutive failures, so
 * this component also has to explain that state and offer a way back.
 */
export function WebhooksManager({
  projectId,
  initialEndpoints,
  realtimeSocketFactory,
}: {
  projectId: string;
  initialEndpoints: WebhookEndpointSummary[];
  /** Test-only seam, threaded straight through to useDashboardRealtime. Never set in application code. */
  realtimeSocketFactory?: DashboardRealtimeSocketFactory;
}) {
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedWebhookEndpoint>();
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  /**
   * Refetches the endpoint list and merges it in — same "REST stays
   * authoritative, WS is only a nudge" model as Connections/Rooms.
   * Upsert-by-publicId: an endpoint whose failure count or status just
   * changed server-side is replaced with the fresh copy; anything this
   * tab doesn't know about yet (created from elsewhere) is prepended.
   * Never touches `justCreated`/`error`/`creating`/`busyId` — those are
   * this tab's own in-flight-action state, untouched by a background
   * nudge about what any tab (including another developer's) triggered.
   */
  const refetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/webhooks`);
      if (!res.ok) return; // background nudge — fails silently, same as Connections/Rooms
      const fresh = (await res.json()) as WebhookEndpointSummary[];

      setEndpoints((prev) => {
        const freshById = new Map(fresh.map((e) => [e.publicId, e]));
        const updatedPrev = prev.map((e) => freshById.get(e.publicId) ?? e);
        const newOnes = fresh.filter((e) => !prev.some((p) => p.publicId === e.publicId));
        return [...newOnes, ...updatedPrev];
      });
    } catch {
      // Silent, same reasoning as Connections/Rooms: a background nudge
      // failing must not toast at the user for something they never
      // asked for. The next successful nudge/reconnect/reload catches up.
    }
  }, [projectId]);

  const scheduleRefetch = useDebouncedRefetch(refetchLatest);

  const handleRealtimeEvent = useCallback(
    (frame: Record<string, unknown>) => {
      if (frame.type !== 'webhook.delivery_failed' && frame.type !== 'webhook.endpoint_disabled') return;
      scheduleRefetch();
    },
    [scheduleRefetch],
  );

  // No replay on reconnect (Phase 5A's model) — refetch instead, same as
  // any other nudge, so a run of failures that happened entirely while
  // disconnected is still caught up on.
  useDashboardRealtime(projectId, {
    onEvent: handleRealtimeEvent,
    onReconnected: refetchLatest,
    socketFactory: realtimeSocketFactory,
  });

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(undefined);
    setJustCreated(undefined);

    try {
      const response = await fetch(`/api/projects/${projectId}/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // An empty list means "every event", which is the API's own
        // default, so we send undefined rather than [].
        body: JSON.stringify({ url, events: selectedEvents.length > 0 ? selectedEvents : undefined }),
      });
      if (handleSessionExpiry(response)) return;
      const payload = await readJson<CreatedWebhookEndpoint>(response);

      if (!response.ok || !payload) {
        const message = errorMessage(payload, 'Could not create the webhook endpoint');
        setError(message);
        toast.error(message);
        return;
      }

      setJustCreated(payload);
      setEndpoints((previous) => [payload, ...previous]);
      setUrl('');
      setSelectedEvents([]);
      toast.success('Webhook endpoint created');
    } catch {
      setError('Could not reach the server.');
      toast.error('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(endpoint: WebhookEndpointSummary, status: 'ACTIVE' | 'DISABLED') {
    setBusyId(endpoint.publicId);
    try {
      const response = await fetch(`/api/projects/${projectId}/webhooks/${endpoint.publicId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (handleSessionExpiry(response)) return;
      if (response.ok) {
        const updated = (await response.json()) as WebhookEndpointSummary;
        setEndpoints((previous) => previous.map((e) => (e.publicId === updated.publicId ? updated : e)));
        toast.success(status === 'ACTIVE' ? 'Webhook endpoint enabled' : 'Webhook endpoint disabled');
      } else {
        const payload = await readJson(response);
        toast.error(errorMessage(payload, 'Could not update the webhook endpoint'));
      }
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(endpoint: WebhookEndpointSummary) {
    // The confirm gate lives in the row itself (InlineConfirm, same as
    // API key revoke/rotate and member remove) — restating a permanent
    // action before it fires, without an unstyled native confirm().
    setBusyId(endpoint.publicId);
    try {
      const response = await fetch(`/api/projects/${projectId}/webhooks/${endpoint.publicId}`, { method: 'DELETE' });
      if (handleSessionExpiry(response)) return;
      if (response.ok || response.status === 204) {
        setEndpoints((previous) => previous.filter((e) => e.publicId !== endpoint.publicId));
        toast.success('Webhook endpoint removed');
      } else {
        const payload = await readJson(response);
        toast.error(errorMessage(payload, 'Could not remove the webhook endpoint'));
      }
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Add an endpoint"
          subtitle="Livqeno POSTs each event as JSON, signed with HMAC-SHA256. Delivery is asynchronous and retried with exponential backoff — a slow endpoint never delays a message."
        />
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Field
            label="Endpoint URL"
            id="webhook-url"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://api.example.com/raven/webhooks"
            hint="Must be https:// in production. Loopback and private-network addresses are rejected outside local dev."
          />

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">
              Events <span className="text-subtle">(none selected = receive everything)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map((eventType) => {
                const checked = selectedEvents.includes(eventType);
                return (
                  <label
                    key={eventType}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                      checked
                        ? 'border-accent bg-accent-subtle text-accent-text'
                        : 'border-line text-muted hover:text-fg'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() =>
                        setSelectedEvents((previous) =>
                          previous.includes(eventType)
                            ? previous.filter((value) => value !== eventType)
                            : [...previous, eventType],
                        )
                      }
                    />
                    {eventType}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <Button type="submit" disabled={creating || !url}>
              {creating ? 'Creating…' : 'Create endpoint'}
            </Button>
          </div>

          {error && (
            <div className="mt-1">
              <ErrorState description={error} />
            </div>
          )}
        </form>
      </Card>

      {justCreated && (
        <Card className="border-accent">
          <CardHeader
            title="Signing secret"
            subtitle="Shown once. Verify every delivery against it — an unverified webhook endpoint will accept anything anyone POSTs to it."
          />
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-raised p-3">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{justCreated.signingSecret}</code>
            <CopyButton value={justCreated.signingSecret} label="Copy signing secret" />
          </div>
          <p className="mt-3 text-xs text-muted">
            Livqeno signs each delivery as{' '}
            <code className="font-mono">Raven-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code> over{' '}
            <code className="font-mono">&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</code>. Reject any delivery whose
            timestamp is more than five minutes old — that&apos;s what stops a captured request being replayed. See{' '}
            <span className="font-mono">docs/chat/webhooks.md</span>.
          </p>
        </Card>
      )}

      {endpoints.length === 0 ? (
        <EmptyState
          icon={<IconWebhooks className="size-7" />}
          title="No webhook endpoints"
          description="Webhooks let your backend react to chat events without polling — a message posted, a reaction added, a participant joining."
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {endpoints.map((endpoint) => (
              <EndpointRow
                key={endpoint.publicId}
                endpoint={endpoint}
                busy={busyId === endpoint.publicId}
                onToggleStatus={() => void updateStatus(endpoint, endpoint.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                onRemove={() => void remove(endpoint)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function EndpointRow({
  endpoint,
  busy,
  onToggleStatus,
  onRemove,
}: {
  endpoint: WebhookEndpointSummary;
  busy: boolean;
  onToggleStatus: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Stays mounted across both the action-buttons state and the confirm
  // state (only its children swap) — see InlineConfirm's doc comment for
  // why restoring focus here, not inside InlineConfirm, is this
  // component's job.
  const actionsRef = useRef<HTMLDivElement>(null);

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm text-fg">{endpoint.url}</span>
          <Badge tone={endpoint.status === 'ACTIVE' ? 'success' : 'danger'}>{endpoint.status.toLowerCase()}</Badge>
        </div>
        <p className="mt-1 text-xs text-subtle">
          {endpoint.enabledEvents.length === 0 ? 'All events' : endpoint.enabledEvents.join(', ')}
        </p>
        <p className="mt-1 text-xs text-subtle">
          {endpoint.lastDeliveryAt ? `Last delivery ${formatRelative(endpoint.lastDeliveryAt)}` : 'No deliveries yet'}
          {endpoint.consecutiveFailures > 0 && (
            <span className="text-danger-text">
              {' '}
              · {endpoint.consecutiveFailures} consecutive failure
              {endpoint.consecutiveFailures === 1 ? '' : 's'}
            </span>
          )}
        </p>
        {endpoint.status === 'DISABLED' && (
          <p className="mt-1 text-xs text-danger-text">
            Livqeno disabled this endpoint after repeated failures. Fix it, then re-enable — re-enabling also clears the
            failure count.
          </p>
        )}
      </div>

      <div ref={actionsRef} tabIndex={-1} className="shrink-0 outline-none">
        {confirming ? (
          <InlineConfirm
            message={`Delete the webhook endpoint for ${endpoint.url}? It stops receiving events immediately.`}
            confirmLabel="Confirm delete"
            busyLabel="Deleting…"
            busy={busy}
            onCancel={() => {
              setConfirming(false);
              actionsRef.current?.focus();
            }}
            onConfirm={() => {
              onRemove();
              setConfirming(false);
              actionsRef.current?.focus();
            }}
          />
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={onToggleStatus}>
              {endpoint.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
