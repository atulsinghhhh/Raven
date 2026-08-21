import type { AuditLogEntry, ProjectDiagnostics, WebhookEndpointSummary } from './api-client';

/**
 * Every notification here is derived from a real record already fetched
 * elsewhere in this app — diagnostics, audit log, webhook health. There
 * is no synthetic "you have 3 new alerts" placeholder; a quiet project
 * produces an empty list, not a fake one.
 */
export interface DashboardNotification {
  id: string;
  kind: 'system' | 'webhook' | 'audit';
  severity: 'warning' | 'info';
  title: string;
  description: string;
  timestamp: string;
  href?: string;
}

const DEPENDENCY_LABEL: Record<string, string> = {
  signaling: 'Signaling',
  sfu: 'SFU',
  turn: 'TURN',
};

export function buildNotifications({
  projectId,
  diagnostics,
  auditLogs,
  webhooks,
}: {
  projectId: string;
  diagnostics?: ProjectDiagnostics;
  auditLogs?: AuditLogEntry[];
  webhooks?: WebhookEndpointSummary[];
}): DashboardNotification[] {
  const base = `/dashboard/projects/${projectId}`;
  const notifications: DashboardNotification[] = [];

  if (diagnostics) {
    for (const [key, state] of Object.entries(diagnostics.dependencies)) {
      if (state !== 'down') continue;
      notifications.push({
        id: `system-${key}`,
        kind: 'system',
        severity: 'warning',
        title: `${DEPENDENCY_LABEL[key] ?? key} is down`,
        description: 'This dependency is currently unreachable — see Diagnostics for what depends on it.',
        timestamp: new Date().toISOString(),
        href: `${base}/rooms`,
      });
    }
  }

  for (const webhook of webhooks ?? []) {
    if (webhook.consecutiveFailures === 0) continue;
    notifications.push({
      id: `webhook-${webhook.id}`,
      kind: 'webhook',
      severity: 'warning',
      title: `Webhook delivery failing`,
      description: `${webhook.url} has failed ${webhook.consecutiveFailures} ${
        webhook.consecutiveFailures === 1 ? 'time' : 'times'
      } in a row.`,
      timestamp: webhook.lastDeliveryAt ?? webhook.updatedAt,
      href: `${base}/webhooks`,
    });
  }

  for (const entry of auditLogs ?? []) {
    notifications.push({
      id: `audit-${entry.id}`,
      kind: 'audit',
      severity: 'info',
      title: humanizeAction(entry.action),
      description: `${entry.actorEmail} · ${entry.resourceType}${entry.resourceId ? ` ${entry.resourceId}` : ''}`,
      timestamp: entry.createdAt,
      href: `${base}/audit`,
    });
  }

  return notifications.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function humanizeAction(action: string): string {
  // "api_key.revoked" -> "Api key revoked"
  const [resource, verb] = action.split('.');
  const words = `${resource?.replace(/_/g, ' ') ?? action} ${verb ?? ''}`.trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
