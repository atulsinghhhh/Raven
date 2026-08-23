import { ravenApi } from './api-client';

export const LOG_SCAN_LIMIT = 100;
// Fetching every webhook's full delivery history would be unbounded —
// cap both dimensions so this can never turn into an accidental
// N-times-M fan-out against the Control API.
export const WEBHOOK_FANOUT_LIMIT = 5;

/**
 * The one place Logs and Events both pull from — same sources, same
 * caps, so the two pages can never silently disagree about what "the
 * last 100 of each" means.
 */
export async function fetchLogSources(token: string, projectId: string) {
  const [connectionsResult, errorsResult, chatConnectionsResult, webhooksResult, auditLogsResult] =
    await Promise.allSettled([
      ravenApi.listConnections(token, projectId, { limit: LOG_SCAN_LIMIT }),
      ravenApi.listErrors(token, projectId, { limit: LOG_SCAN_LIMIT }),
      ravenApi.listChatConnections(token, projectId, { limit: LOG_SCAN_LIMIT }),
      ravenApi.listWebhooks(token, projectId),
      ravenApi.listAuditLogs(token, projectId, { limit: LOG_SCAN_LIMIT }),
    ]);

  const webhooks = webhooksResult.status === 'fulfilled' ? webhooksResult.value : [];
  const deliveryLists = await Promise.allSettled(
    webhooks.slice(0, WEBHOOK_FANOUT_LIMIT).map((w) => ravenApi.listWebhookDeliveries(token, projectId, w.id)),
  );
  const webhookDeliveries = deliveryLists.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const anySourceFailed = [
    connectionsResult,
    errorsResult,
    chatConnectionsResult,
    webhooksResult,
    auditLogsResult,
  ].some((r) => r.status === 'rejected');

  return {
    connections: connectionsResult.status === 'fulfilled' ? connectionsResult.value : [],
    errors: errorsResult.status === 'fulfilled' ? errorsResult.value : [],
    chatConnections: chatConnectionsResult.status === 'fulfilled' ? chatConnectionsResult.value : [],
    webhookDeliveries,
    auditLogs: auditLogsResult.status === 'fulfilled' ? auditLogsResult.value : [],
    webhooksScanned: webhooks.slice(0, WEBHOOK_FANOUT_LIMIT).length,
    webhooksTotal: webhooks.length,
    anySourceFailed,
    unauthorized: connectionsResult.status === 'rejected' ? connectionsResult.reason : undefined,
  };
}
