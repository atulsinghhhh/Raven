import { act, render, screen, waitFor } from '@testing-library/react';
import { StreamDetail } from '@/app/dashboard/projects/[projectId]/live-streaming/streams/[streamId]/stream-detail';
import type { LiveStreamSummary } from '@/lib/api-client';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';

function stream(overrides: Partial<LiveStreamSummary> = {}): LiveStreamSummary {
  return {
    id: 'stream_1',
    title: 'My Stream',
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

function mockFetch(detail?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const mock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard-ws-token')) return Promise.resolve(mockTokenResponse());
    if (detail) return detail();
    return Promise.reject(new Error(`unmocked fetch in test: ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function detailFetchCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(
    ([url]) => String(url).includes('/live-streams/') && !String(url).includes('dashboard-ws-token'),
  );
}

function renderWithSocket(props: Partial<React.ComponentProps<typeof StreamDetail>> = {}) {
  const sockets: FakeSocket[] = [];
  const utils = render(
    <StreamDetail
      projectId="proj-1"
      streamId="stream_1"
      basePath="/dashboard/projects/proj-1/live-streaming/streams"
      initialStream={stream()}
      messages={undefined}
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

describe('StreamDetail', () => {
  beforeEach(() => {
    mockFetch();
  });

  it('renders the initial SSR-provided snapshot, including the live status badge in the header', () => {
    render(
      <StreamDetail
        projectId="proj-1"
        streamId="stream_1"
        basePath="/dashboard/projects/proj-1/live-streaming/streams"
        initialStream={stream({ title: 'Launch Day' })}
        messages={undefined}
      />,
    );
    expectVisible('Launch Day');
    expectVisible('Created');
  });

  describe('realtime (Phase 5E)', () => {
    it('a live_stream.started event for this stream refreshes it — status and viewer count update', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => stream({ status: 'LIVE', startedAt: '2026-01-01T00:05:00.000Z', viewerCount: 3 }),
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expectVisible('Created');

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 'stream_1' }));

      await waitFor(() => expectVisible('Live'));
      expectVisible('3'); // the refreshed live viewer count
    });

    it('a live_stream.ended event for this stream refreshes it', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => stream({ status: 'ENDED', endedAt: '2026-01-01T00:10:00.000Z' }),
      }));
      const { sockets } = renderWithSocket({ initialStream: stream({ status: 'LIVE' }) });
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expectVisible('Live');

      act(() => sockets[0].receive({ type: 'live_stream.ended', streamId: 'stream_1' }));

      await waitFor(() => expectVisible('Ended'));
    });

    it('ignores an event about a different stream — the RTC boundary scoping rule, applied per-stream', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => stream({ status: 'LIVE' }) }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 'some-other-stream' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(detailFetchCalls(fetchMock)).toHaveLength(0);
      expectVisible('Created'); // unchanged
    });

    it('ignores an unrelated event type without refetching', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => stream({ status: 'LIVE' }) }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'webhook.delivery_failed', endpointId: 'whe_1', failureCount: 1 }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(detailFetchCalls(fetchMock)).toHaveLength(0);
    });

    it('duplicate events are safe — replaying the same nudge twice settles on the same state', async () => {
      mockFetch(async () => ({ ok: true, json: async () => stream({ status: 'LIVE', viewerCount: 5 }) }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      const frame = { type: 'live_stream.started', streamId: 'stream_1' };
      act(() => sockets[0].receive(frame));
      act(() => sockets[0].receive(frame));

      await waitFor(() => expectVisible('Live'));
      expectVisible('5');
    });

    it('a burst of events within the debounce window collapses into one refetch', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => stream({ status: 'LIVE' }) }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      for (let i = 0; i < 5; i += 1) {
        act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 'stream_1' }));
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(detailFetchCalls(fetchMock)).toHaveLength(1);
    });

    it('reconnect refreshes the current snapshot — the missed-events recovery path', async () => {
      mockFetch(async () => ({ ok: true, json: async () => stream({ status: 'LIVE', viewerCount: 7 }) }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expectVisible('Created');

      act(() => sockets[0].serverClose(1006, 'abnormal closure'));
      await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
      act(() => sockets[1].open());

      await waitFor(() => expectVisible('Live'));
      expectVisible('7');
    });

    it('a failed background refetch preserves the current view and never throws', async () => {
      mockFetch(async () => ({ ok: false, status: 500 }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'live_stream.started', streamId: 'stream_1' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expectVisible('Created'); // unchanged
    });
  });
});
