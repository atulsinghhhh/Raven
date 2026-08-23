import type {
  AuditLogEntry,
  ChatConnectionSummary,
  ConnectionSummary,
  ErrorSummary,
  WebhookDeliveryRecord,
} from './api-client';

export type LogProduct = 'rtc' | 'chat' | 'webhook' | 'audit';
export type LogStatus = 'success' | 'failed';

/**
 * Every row here links back to the real record it came from — a
 * connection, an error, a webhook delivery, an audit entry. There is no
 * synthetic "log line" resource in the Control API, so this is a
 * client-visible merge of the sources that already exist, not a new
 * backend concept pretending to be one.
 */
export interface LogEntry {
  id: string;
  product: LogProduct;
  event: string;
  status: LogStatus;
  timestamp: string;
  requestId: string | null;
  summary: string;
  href: string;
  /**
   * The real underlying record, verbatim — used by the Events explorer's
   * JSON view. Never includes a secret: none of the five source types
   * (ConnectionSummary, ErrorSummary, ChatConnectionSummary,
   * WebhookDeliveryRecord, AuditLogEntry) carry one — API key secrets,
   * webhook signing secrets, and chat message content are all separate
   * resources this merge never touches.
   */
  payload: Record<string, unknown>;
}

// Matches components/ui/badge.tsx's own CONNECTION_STATE tone map —
// only FAILED reads as a failure there; DISCONNECTED is a neutral,
// expected end state, not an error.
const FAILED_STATES = new Set(['FAILED']);

export function buildLogEntries(
  base: string,
  data: {
    connections?: ConnectionSummary[];
    errors?: ErrorSummary[];
    chatConnections?: ChatConnectionSummary[];
    webhookDeliveries?: WebhookDeliveryRecord[];
    auditLogs?: AuditLogEntry[];
  },
): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const c of data.connections ?? []) {
    entries.push({
      id: `rtc-connection-${c.id}`,
      product: 'rtc',
      event: `rtc.connection.${c.state.toLowerCase()}`,
      status: FAILED_STATES.has(c.state) ? 'failed' : 'success',
      timestamp: c.startedAt,
      requestId: null,
      summary: `${c.participantIdentity} · ${c.roomName}`,
      href: `${base}/connections/${c.publicId}`,
      payload: c as unknown as Record<string, unknown>,
    });
  }

  for (const e of data.errors ?? []) {
    entries.push({
      id: `rtc-error-${e.id}`,
      product: 'rtc',
      event: `rtc.error.${e.category.toLowerCase()}`,
      status: 'failed',
      timestamp: e.timestamp,
      requestId: null,
      summary: e.message,
      href: `${base}/errors/${e.publicId}`,
      payload: e as unknown as Record<string, unknown>,
    });
  }

  for (const c of data.chatConnections ?? []) {
    entries.push({
      id: `chat-connection-${c.id}`,
      product: 'chat',
      event: `chat.connection.${c.state.toLowerCase()}`,
      status: FAILED_STATES.has(c.state) ? 'failed' : 'success',
      timestamp: c.connectedAt ?? c.createdAt,
      requestId: null,
      summary: `${c.userId} · ${c.messagesSent} message${c.messagesSent === 1 ? '' : 's'} sent`,
      href: `${base}/chat/connections`,
      payload: c as unknown as Record<string, unknown>,
    });
  }

  for (const d of data.webhookDeliveries ?? []) {
    entries.push({
      id: `webhook-delivery-${d.id}`,
      product: 'webhook',
      event: `webhook.${d.event.type}`,
      status: d.status === 'DELIVERED' ? 'success' : 'failed',
      timestamp: d.createdAt,
      requestId: null,
      summary: d.status === 'DELIVERED' ? `Delivered (HTTP ${d.responseStatus ?? '—'})` : d.lastError ?? 'Delivery failed',
      href: `${base}/webhooks`,
      payload: d as unknown as Record<string, unknown>,
    });
  }

  for (const a of data.auditLogs ?? []) {
    entries.push({
      id: `audit-${a.id}`,
      product: 'audit',
      event: a.action,
      status: 'success',
      timestamp: a.createdAt,
      requestId: a.requestId,
      summary: `${a.actorEmail} · ${a.resourceType}`,
      href: `${base}/audit`,
      payload: a as unknown as Record<string, unknown>,
    });
  }

  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
