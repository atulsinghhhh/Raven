import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionsList } from '@/app/dashboard/projects/[projectId]/connections/connections-list';
import type { ConnectionSummary } from '@/lib/api-client';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';

jest.mock('@/lib/session-expiry', () => ({ handleSessionExpiry: jest.fn() }));

function connection(publicId: string, overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: publicId,
    publicId,
    projectId: 'proj-1',
    roomId: 'room-1',
    roomName: 'demo-room',
    participantId: publicId,
    participantIdentity: `user-${publicId}`,
    state: 'CONNECTED',
    disconnectReason: null,
    region: null,
    sdkVersion: null,
    platform: null,
    browser: null,
    networkType: null,
    iceConnectionState: null,
    signalingState: null,
    reconnectCount: 0,
    connectionQuality: null,
    rttMs: null,
    jitterMs: null,
    packetLossPercent: null,
    bitrateBps: null,
    codec: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    connectedAt: '2026-01-01T00:00:01.000Z',
    disconnectedAt: null,
    durationMs: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Every row renders twice — once in the desktop table, once in the
// mobile list (both present in jsdom; only CSS hides one, and jsdom
// doesn't apply CSS) — so a participant identity is never unique in the
// DOM. getAllByText/queryAllByText instead of the singular forms
// throughout this file, for that reason.
function expectVisible(text: string) {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}
function expectAbsent(text: string) {
  expect(screen.queryAllByText(text)).toHaveLength(0);
}

/**
 * ConnectionsList now also mounts useDashboardRealtime (Phase 5C), which
 * fires its own `fetch` to `/api/.../dashboard-ws-token` on every mount —
 * before any Load More click. A plain `jest.fn().mockResolvedValueOnce()`
 * queue can't tell that call apart from the one a test is actually
 * asserting on, so every fetch mock here is URL-aware instead: the
 * dashboard-ws-token endpoint always fails closed (no token, no socket,
 * no interference — the realtime hook settles into 'failed' and does
 * nothing further), and `connections` supplies whatever this particular
 * test wants the `/connections` endpoint to return.
 */
function mockFetch(connections?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const mock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard-ws-token')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
    }
    if (connections) return connections();
    return Promise.reject(new Error(`unmocked fetch in test: ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

/** Finds the call this test actually cares about among the fetch mock's calls, ignoring the realtime token mint. */
function connectionsFetchCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(([url]) => String(url).includes('/connections'));
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

/** Same as mockFetch, but the token mint succeeds — for tests that need a real (fake) socket to actually open. */
function mockFetchWithRealtime(
  connections?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>,
) {
  const mock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard-ws-token')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          token: 'a-token',
          tokenId: 'dwt_1',
          userId: 'user-1',
          projectId: 'proj-1',
          wsUrl: 'wss://api.example.com/v1/dashboard/ws',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      });
    }
    if (connections) return connections();
    return Promise.reject(new Error(`unmocked fetch in test: ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function renderWithSocket(props: Partial<React.ComponentProps<typeof ConnectionsList>> = {}) {
  const sockets: FakeSocket[] = [];
  const utils = render(
    <ConnectionsList
      projectId="proj-1"
      initialConnections={[connection('c1')]}
      initialNextCursor={null}
      initialHasMore={false}
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

describe('ConnectionsList', () => {
  beforeEach(() => {
    mockFetch();
    jest.spyOn(toast, 'error').mockImplementation(() => 'toast_test');
    (handleSessionExpiry as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows "Load more" when the initial page reports hasMore', () => {
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
      />,
    );
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    expect(screen.queryByText('No more connections.')).not.toBeInTheDocument();
  });

  it('shows "No more connections." instead of a button when hasMore is false — never a dead-end Load More', () => {
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor={null}
        initialHasMore={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText('No more connections.')).toBeInTheDocument();
  });

  it('sends the previous page cursor and appends the next page without replacing existing rows', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ data: [connection('c2'), connection('c3')], nextCursor: 'c3', hasMore: false }),
    }));
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expectVisible('user-c3'));
    // Appended, not replaced — the first page's row is still there.
    expectVisible('user-c1');
    expectVisible('user-c2');

    const [url] = connectionsFetchCalls(global.fetch as jest.Mock)[0];
    expect(url).toBe('/api/projects/proj-1/connections?cursor=c1');
  });

  it('hides "Load more" once the newly-fetched page reports hasMore: false — end of dataset', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ data: [connection('c2')], nextCursor: null, hasMore: false }),
    }));
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getByText('No more connections.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('carries the current state/room filters into the Load More request, alongside the cursor', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ data: [], nextCursor: null, hasMore: false }),
    }));
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
        state="CONNECTED"
        room="room-9"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(connectionsFetchCalls(global.fetch as jest.Mock).length).toBeGreaterThan(0));
    const [url] = connectionsFetchCalls(global.fetch as jest.Mock)[0];
    const params = new URL(url, 'http://localhost').searchParams;
    expect(params.get('state')).toBe('CONNECTED');
    expect(params.get('room')).toBe('room-9');
    expect(params.get('cursor')).toBe('c1');
  });

  it('re-applies the current text search to newly-loaded rows, same as the initial page', async () => {
    mockFetch(async () => ({
      ok: true,
      // A mixed batch: one row matches "alice", one doesn't.
      json: async () => ({
        data: [connection('c2', { participantIdentity: 'alice' }), connection('c3', { participantIdentity: 'bob' })],
        nextCursor: null,
        hasMore: false,
      }),
    }));
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1', { participantIdentity: 'alice-initial' })]}
        initialNextCursor="c1"
        initialHasMore
        q="alice"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expectVisible('alice'));
    expectAbsent('bob');
  });

  it('shows a toast and keeps the existing rows when Load More fails, without a duplicate inline error', async () => {
    mockFetch(async () => ({ ok: false, status: 502 }));
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load more connections.'));
    expectVisible('user-c1');
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument(); // still there — can retry
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // no second, inline error UI for the same failure
  });

  it('defers to handleSessionExpiry when Load More gets a 401, without the generic failure toast', async () => {
    (handleSessionExpiry as jest.Mock).mockReturnValue(true);
    mockFetch(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 'UNAUTHORIZED', message: 'Not signed in' }),
    }));
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(handleSessionExpiry).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    expectVisible('user-c1');
  });

  it('cannot fire a second Load More request while one is already in flight', async () => {
    let resolveFetch!: (value: { ok: boolean; status?: number; json?: () => Promise<unknown> }) => void;
    mockFetch(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <ConnectionsList
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
      />,
    );

    const button = screen.getByRole('button', { name: 'Load more' });
    await user.click(button);
    expect(button).toBeDisabled(); // Button's `loading` prop disables it while in flight

    // A second click while disabled cannot dispatch through the DOM; this
    // asserts only one Load More request was ever made (the realtime
    // token mint is a separate call, not counted here).
    await user.click(button);
    expect(connectionsFetchCalls(global.fetch as jest.Mock)).toHaveLength(1);

    resolveFetch({ ok: true, json: async () => ({ data: [], nextCursor: null, hasMore: false }) });
    await waitFor(() => expect(screen.getByText('No more connections.')).toBeInTheDocument());
  });

  it('a filter change discards accumulated pages instead of appending onto the old cursor', async () => {
    // Mirrors what page.tsx actually does: `key={state:room:q}` on
    // <ConnectionsList> forces React to unmount and remount rather than
    // reuse the instance when a filter changes, so old useState (loaded
    // pages, cursor) can never survive into the new query (spec §7).
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ data: [connection('c2')], nextCursor: 'c2', hasMore: false }),
    }));
    const user = userEvent.setup();
    const { unmount } = render(
      <ConnectionsList
        key="state=CONNECTED"
        projectId="proj-1"
        initialConnections={[connection('c1')]}
        initialNextCursor="c1"
        initialHasMore
        state="CONNECTED"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expectVisible('user-c2'));

    // The filter changed — page.tsx would render a new key with the fresh
    // SSR page for the new filter, which in practice unmounts this
    // instance. Simulated here directly since ConnectionsList itself has
    // no filter-change handling of its own — that's page.tsx's job.
    unmount();
    render(
      <ConnectionsList
        key="state=FAILED"
        projectId="proj-1"
        initialConnections={[connection('c9')]}
        initialNextCursor={null}
        initialHasMore={false}
        state="FAILED"
      />,
    );

    expectVisible('user-c9');
    expectAbsent('user-c1');
    expectAbsent('user-c2');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  describe('realtime (Phase 5C)', () => {
    it('a connection.state_changed event triggers a refetch that merges the updated record in', async () => {
      mockFetchWithRealtime(async () => ({
        ok: true,
        json: async () => ({ data: [connection('c1', { state: 'DISCONNECTED' })], nextCursor: null, hasMore: false }),
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      // Initial render: c1 is CONNECTED (the default from connection()).
      expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);

      act(() =>
        sockets[0].receive({
          type: 'connection.state_changed',
          connectionId: 'c1',
          roomId: 'room-1',
          state: 'DISCONNECTED',
        }),
      );

      await waitFor(() => expect(screen.getAllByText('Disconnected').length).toBeGreaterThan(0));
      expectVisible('user-c1'); // same row, updated in place — not duplicated
    });

    it('ignores an event for a different resource type without refetching', async () => {
      const fetchMock = mockFetchWithRealtime(async () => ({
        ok: true,
        json: async () => ({ data: [], nextCursor: null, hasMore: false }),
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' }));

      await new Promise((resolve) => setTimeout(resolve, 500)); // past the debounce window
      expect(connectionsFetchCalls(fetchMock)).toHaveLength(0);
    });

    it('a room-filtered view skips the refetch for an event about a different room', async () => {
      const fetchMock = mockFetchWithRealtime(async () => ({
        ok: true,
        json: async () => ({ data: [], nextCursor: null, hasMore: false }),
      }));
      const { sockets } = renderWithSocket({ room: 'room-1' });
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() =>
        sockets[0].receive({
          type: 'connection.state_changed',
          connectionId: 'c9',
          roomId: 'a-different-room',
          state: 'CONNECTED',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(connectionsFetchCalls(fetchMock)).toHaveLength(0);
    });

    it('duplicate events do not corrupt the UI — replaying the same nudge twice changes nothing further', async () => {
      mockFetchWithRealtime(async () => ({
        ok: true,
        json: async () => ({ data: [connection('c1', { state: 'FAILED' })], nextCursor: null, hasMore: false }),
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      const frame = { type: 'connection.state_changed', connectionId: 'c1', roomId: 'room-1', state: 'FAILED' };
      act(() => sockets[0].receive(frame));
      act(() => sockets[0].receive(frame));

      await waitFor(() => expect(screen.getAllByText('Failed').length).toBeGreaterThan(0));
      // Still exactly one row for c1 (desktop + mobile = 2 DOM nodes, not 4).
      expect(screen.getAllByText('user-c1')).toHaveLength(2);
    });

    it('reconnect refreshes the snapshot — the "missed events while disconnected" recovery path', async () => {
      mockFetchWithRealtime(async () => ({
        ok: true,
        json: async () => ({ data: [connection('c1', { state: 'DISCONNECTED' })], nextCursor: null, hasMore: false }),
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);

      // Drop, then the transport's own backoff reopens a new socket — no
      // event was ever delivered for the state change that happened
      // while disconnected; the reconnect itself is what triggers the
      // catch-up refetch.
      act(() => sockets[0].serverClose(1006, 'abnormal closure'));
      await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
      act(() => sockets[1].open());

      await waitFor(() => expect(screen.getAllByText('Disconnected').length).toBeGreaterThan(0));
    });

    it("never touches nextCursor/hasMore — a realtime refresh must not disturb Load More's position", async () => {
      mockFetchWithRealtime(async () => ({
        ok: true,
        json: async () => ({ data: [connection('c1')], nextCursor: 'should-be-ignored', hasMore: true }),
      }));
      const { sockets } = renderWithSocket({ initialNextCursor: null, initialHasMore: false });
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() =>
        sockets[0].receive({
          type: 'connection.state_changed',
          connectionId: 'c1',
          roomId: 'room-1',
          state: 'CONNECTED',
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 500));
      // initialHasMore was false — if the realtime refresh had applied
      // the fresh page's hasMore/nextCursor, "Load more" would now be
      // showing. It must not.
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
      expect(screen.getByText('No more connections.')).toBeInTheDocument();
    });
  });
});
