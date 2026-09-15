import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError, ravenApi } from '@/lib/api-client';
import type { LiveStreamSummary } from '@/lib/api-client';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StreamDetail } from './stream-detail';

// Same scan window the conversation detail page uses for message metadata;
// a chat's root message (the one reactions attach to) may fall outside it
// on a very active stream; that's called out explicitly instead of shown
// as a silent zero.
const MESSAGE_SCAN_LIMIT = 100;

/**
 * One live stream: metadata, hosts, viewer counts, and chat *metadata*.
 * Message contents are never shown here, same rule as Chat's conversation
 * detail page: the API this reads from doesn't return them.
 *
 * The interactive body (including the live status badge) lives in
 * stream-detail.tsx, a client component that subscribes to dashboard
 * realtime and refetches this stream on a `live_stream.started`/`ended`
 * nudge for *this* stream (Phase 5E) — this Server Component only does
 * auth, the initial fetch, and error/empty states, same split as every
 * other realtime-enabled page (Connections/Rooms/Webhooks/Streams list).
 */
export default async function LiveStreamDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; streamId: string }>;
}) {
  const { projectId, streamId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  let stream: LiveStreamSummary;
  try {
    stream = await ravenApi.getLiveStream(token, projectId, streamId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="Stream not found"
          description="This stream may have ended and been cleaned up, or it belongs to a different project."
          action={
            <ButtonLink href={`${base}/live-streaming/streams`} variant="primary">
              All streams
            </ButtonLink>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this stream"
        description="The Control API is unreachable right now."
        requestId={error instanceof ApiError ? error.code : undefined}
        retryHref={`${base}/live-streaming/streams/${streamId}`}
      />
    );
  }

  const messages = stream.conversationId
    ? await ravenApi
        .listChatConversationMessages(token, projectId, stream.conversationId, { limit: MESSAGE_SCAN_LIMIT })
        .catch(() => undefined)
    : undefined;

  return (
    <div className="flex flex-col gap-8">
      <StreamDetail
        projectId={projectId}
        streamId={streamId}
        basePath={`${base}/live-streaming/streams`}
        initialStream={stream}
        messages={messages}
      />
    </div>
  );
}
