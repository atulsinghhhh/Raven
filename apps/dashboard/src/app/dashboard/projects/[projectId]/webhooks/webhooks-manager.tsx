'use client';

import { useState } from 'react';
import type { CreatedWebhookEndpoint, WebhookEndpointSummary } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/states';
import { IconWebhooks } from '@/components/ui/icons';
import { formatRelative } from '@/lib/format';

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
}: {
  projectId: string;
  initialEndpoints: WebhookEndpointSummary[];
}) {
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedWebhookEndpoint>();
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

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
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.message ?? 'Could not create the webhook endpoint');
        return;
      }

      setJustCreated(payload);
      setEndpoints((previous) => [payload, ...previous]);
      setUrl('');
      setSelectedEvents([]);
    } catch {
      setError('Could not reach the server.');
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
      if (response.ok) {
        const updated = (await response.json()) as WebhookEndpointSummary;
        setEndpoints((previous) => previous.map((e) => (e.publicId === updated.publicId ? updated : e)));
      }
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(endpoint: WebhookEndpointSummary) {
    setBusyId(endpoint.publicId);
    try {
      const response = await fetch(`/api/projects/${projectId}/webhooks/${endpoint.publicId}`, { method: 'DELETE' });
      if (response.ok) {
        setEndpoints((previous) => previous.filter((e) => e.publicId !== endpoint.publicId));
      }
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

          {error && <p className="text-sm text-danger-text">{error}</p>}
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
              <li
                key={endpoint.publicId}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-sm text-fg">{endpoint.url}</span>
                    <Badge tone={endpoint.status === 'ACTIVE' ? 'success' : 'danger'}>
                      {endpoint.status.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-subtle">
                    {endpoint.enabledEvents.length === 0 ? 'All events' : endpoint.enabledEvents.join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-subtle">
                    {endpoint.lastDeliveryAt
                      ? `Last delivery ${formatRelative(endpoint.lastDeliveryAt)}`
                      : 'No deliveries yet'}
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
                      Livqeno disabled this endpoint after repeated failures. Fix it, then re-enable — re-enabling also
                      clears the failure count.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    disabled={busyId === endpoint.publicId}
                    onClick={() => void updateStatus(endpoint, endpoint.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}
                  >
                    {endpoint.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busyId === endpoint.publicId}
                    onClick={() => void remove(endpoint)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
