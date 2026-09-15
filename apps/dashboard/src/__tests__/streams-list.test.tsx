import { act, render, screen, waitFor } from '@testing-library/react';
import { StreamsList } from '@/app/dashboard/projects/[projectId]/live-streaming/streams/streams-list';
import type { LiveStreamSummary } from '@/lib/api-client';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';

function stream(id: string, overrides: Partial<LiveStreamSummary> = {}): LiveStreamSummary {
  return {
    id,
    title: `Stream ${id}`,
    description: null,
    thumbnailUrl: null,
    category: null,
    tags: [],
    language: null,
    visibility: 'PUBLIC',
    metadata: null,
    status: 'CREATED',
    hosts: [{ identity: 'alice', role: 'HOST', invitedAt: '2026-01-01T00:00:00.000Z' }],
    viewerCount: null,
    peakViewerCount: 0,
    conversationId: null,
    chatRootMessageId: null,
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function expectVisible(text: string) {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}

class FakeSocket implements DashboardRealtimeSocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(undefined);
  }
  receive(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  serverClose(code: number, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function mockTokenResponse() {
  return {
    ok: true,
    json: async () => ({
      token: 'a-token',
      tokenId: 'dwt_1',
      userId: 'user-1',
      projectId: 'proj-1',
      wsUrl: 'wss://api.example.com/v1/dashboard/ws',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  };
}

function mockFetch(streams?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const mock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard-ws-token')) return Promise.resolve(mockTokenResponse());
    if (streams) return streams();
    return Promise.reject(new Error(`unmocked fetch in test: ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function streamsFetchCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(
    ([url]) => String(url).includes('/live-streams') && !String(url).includes('dashboard-ws-token'),
  );
}

function renderWithSocket(props: Partial<React.ComponentProps<typeof StreamsList>> = {}) {
  const sockets: FakeSocket[] = [];
  const utils = render(
    <StreamsList
      projectId="proj-1"
      basePath="/dashboard/projects/proj-1/live-streaming/streams"
      initialStreams={[stream('s1')]}
      realtimeSocketFactory={() => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      }}
      {...props}
    />,
  );
  return { ...utils, sockets };
}

describe('StreamsList', () => {
  beforeEach(() => {
    mockFetch();
  });

  it('renders the initial SSR-provided snapshot', () => {
    render(
      <StreamsList
        projectId="proj-1"
        basePath="/dashboard/projects/proj-1/live-streaming/streams"
        initialStreams={[stream('s1'), stream('s2')]}
      />,
    );
    expectVisible('Stream s1');
    expectVisible('Stream s2');
  });

  describe('realtime (Phase 5E)', () => {
    it('a live_stream.started event refreshes the list — status updates without a manual reload', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => [stream('s1', { status: 'LIVE', startedAt: '2026-01-01T00:05:00.000Z' })],
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expectVisible('Created');

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 's1' }));

      await waitFor(() => expectVisible('Live'));
    });

    it('a live_stream.ended event refreshes the list', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => [stream('s1', { status: 'ENDED', endedAt: '2026-01-01T00:10:00.000Z' })],
      }));
      const { sockets } = renderWithSocket({ initialStreams: [stream('s1', { status: 'LIVE' })] });
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expectVisible('Live');

      act(() => sockets[0].receive({ type: 'live_stream.ended', streamId: 's1' }));

      await waitFor(() => expectVisible('Ended'));
    });

    it('ignores an unrelated event type without refetching', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [stream('s1')] }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(streamsFetchCalls(fetchMock)).toHaveLength(0);
    });

    it('duplicate events are safe — replaying the same nudge twice settles on the same, non-duplicated list', async () => {
      mockFetch(async () => ({ ok: true, json: async () => [stream('s1', { status: 'LIVE' })] }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      const frame = { type: 'live_stream.started', streamId: 's1' };
      act(() => sockets[0].receive(frame));
      act(() => sockets[0].receive(frame));

      await waitFor(() => expectVisible('Live'));
      // Exactly one row for s1 in each of the desktop table and mobile
      // list (both present in jsdom) — not duplicated by the replayed nudge.
      expect(screen.getAllByText('Stream s1')).toHaveLength(2);
    });

    it('a burst of events within the debounce window collapses into one refetch', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [stream('s1')] }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      for (let i = 0; i < 5; i += 1) {
        act(() => sockets[0].receive({ type: 'live_stream.started', streamId: `s${i}` }));
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(streamsFetchCalls(fetchMock)).toHaveLength(1);
    });

    it('reconnect refreshes the snapshot — catches up on a start/end that happened entirely while disconnected', async () => {
      mockFetch(async () => ({ ok: true, json: async () => [stream('s1', { status: 'LIVE' })] }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expectVisible('Created');

      act(() => sockets[0].serverClose(1006, 'abnormal closure'));
      await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
      act(() => sockets[1].open());

      await waitFor(() => expectVisible('Live'));
    });

    it('carries the current status filter into the refetch request', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [stream('s1', { status: 'LIVE' })] }));
      const { sockets } = renderWithSocket({ status: 'LIVE', initialStreams: [stream('s1', { status: 'LIVE' })] });
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 's1' }));

      await waitFor(() => expect(streamsFetchCalls(fetchMock)).toHaveLength(1));
      const [url] = streamsFetchCalls(fetchMock)[0];
      expect(String(url)).toContain('status=LIVE');
    });

    it('a failed background refetch preserves existing rows and never throws', async () => {
      mockFetch(async () => ({ ok: false, status: 500 }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 's1' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expectVisible('Stream s1');
    });

    it('preserves an existing stream not present in a fresh (filtered) page instead of dropping it', async () => {
      mockFetch(async () => ({ ok: true, json: async () => [stream('s1')] }));
      const { sockets } = renderWithSocket({ initialStreams: [stream('s1'), stream('s2'), stream('s3')] });
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 's1' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expectVisible('Stream s1');
      expectVisible('Stream s2');
      expectVisible('Stream s3');
    });
  });
});
