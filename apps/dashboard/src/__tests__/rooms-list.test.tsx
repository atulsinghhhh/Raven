import { act, render, screen, waitFor } from '@testing-library/react';
import { RoomsList } from '@/app/dashboard/projects/[projectId]/rooms/rooms-list';
import type { RoomWithLiveState } from '@/lib/api-client';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';

function room(id: string, overrides: Partial<RoomWithLiveState> = {}): RoomWithLiveState {
  return {
    id,
    projectId: 'proj-1',
    name: `room-${id}`,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    liveParticipantCount: 0,
    ...overrides,
  };
}

// Every room renders twice (desktop table + mobile list, both present in
// jsdom — see connections-list.test.tsx for the same note), so a room
// name is never unique in the DOM.
function expectVisible(text: string) {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}
function expectAbsent(text: string) {
  expect(screen.queryAllByText(text)).toHaveLength(0);
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

/**
 * RoomsList mounts useDashboardRealtime (Phase 5C), which fires its own
 * `fetch` to the dashboard-ws-token endpoint on mount, then (once the
 * fake socket opens) refetches `/rooms` on a `room.created` nudge. Every
 * fetch mock here is URL-aware for that reason: the token endpoint always
 * succeeds so the socket can actually open, and `rooms` supplies whatever
 * this particular test wants `/rooms` to return.
 */
function mockFetch(rooms?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const mock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard-ws-token')) {
      return Promise.resolve(mockTokenResponse());
    }
    if (rooms) return rooms();
    return Promise.reject(new Error(`unmocked fetch in test: ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function roomsFetchCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(([url]) => String(url).includes('/rooms'));
}

function renderWithSocket(props: Partial<React.ComponentProps<typeof RoomsList>> = {}) {
  const sockets: FakeSocket[] = [];
  const utils = render(
    <RoomsList
      projectId="proj-1"
      initialRooms={[room('r1')]}
      connections={undefined}
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

describe('RoomsList', () => {
  beforeEach(() => {
    mockFetch();
  });

  it('renders the initial SSR-provided snapshot', () => {
    render(<RoomsList projectId="proj-1" initialRooms={[room('r1'), room('r2')]} connections={undefined} />);
    expectVisible('room-r1');
    expectVisible('room-r2');
  });

  it('realtime event triggers a refetch that merges in a newly created room', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => [room('r1'), room('r2', { name: 'brand-new-room' })],
    }));
    const { sockets } = renderWithSocket();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());
    expectAbsent('brand-new-room');

    act(() =>
      sockets[0].receive({ type: 'room.created', roomId: 'r2', name: 'brand-new-room', environment: 'development' }),
    );

    await waitFor(() => expectVisible('brand-new-room'));
    expectVisible('room-r1'); // the original room survives the merge
  });

  it('ignores an event for a different resource type without refetching', async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [room('r1')] }));
    const { sockets } = renderWithSocket();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    act(() =>
      sockets[0].receive({
        type: 'connection.state_changed',
        connectionId: 'conn_abc',
        roomId: 'r1',
        state: 'CONNECTED',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 500)); // past the debounce window
    expect(roomsFetchCalls(fetchMock)).toHaveLength(0);
  });

  it('duplicate events do not corrupt the UI — two identical nudges settle on the same, non-duplicated list', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => [room('r1'), room('r2', { name: 'brand-new-room' })],
    }));
    const { sockets } = renderWithSocket();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    const frame = { type: 'room.created', roomId: 'r2', name: 'brand-new-room', environment: 'development' };
    act(() => sockets[0].receive(frame));
    act(() => sockets[0].receive(frame));

    await waitFor(() => expectVisible('brand-new-room'));
    // Exactly one row for the new room, not two — the merge is
    // upsert-by-id, so replaying the same nudge is a no-op the second
    // time.
    expect(screen.getAllByText('brand-new-room')).toHaveLength(2); // desktop table + mobile list, not 4
  });

  it('a burst of several nudges within the debounce window collapses into one refetch, not one per event', async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [room('r1')] }));
    const { sockets } = renderWithSocket();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    for (let i = 0; i < 5; i += 1) {
      act(() =>
        sockets[0].receive({ type: 'room.created', roomId: `r${i}`, name: `room-${i}`, environment: 'development' }),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 600)); // past the 400ms debounce
    expect(roomsFetchCalls(fetchMock)).toHaveLength(1);
  });

  it('reconnect refreshes the snapshot — the "missed events while disconnected" recovery path', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => [room('r1'), room('r2', { name: 'created-while-disconnected' })],
    }));
    const { sockets } = renderWithSocket();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());
    expectAbsent('created-while-disconnected');

    // Drop, then the transport's own backoff reopens a new socket — no
    // event was ever delivered for the room that appeared while it was
    // down, since there is no replay (Phase 5A's model).
    act(() => sockets[0].serverClose(1006, 'abnormal closure'));
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
    act(() => sockets[1].open());

    await waitFor(() => expectVisible('created-while-disconnected'));
  });

  it('preserves an existing room not present in a fresh (smaller) page instead of dropping it', async () => {
    mockFetch(async () => ({ ok: true, json: async () => [room('r1')] }));
    const { sockets } = renderWithSocket({ initialRooms: [room('r1'), room('r2'), room('r3')] });
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'room-r1', environment: 'development' }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    expectVisible('room-r1');
    expectVisible('room-r2');
    expectVisible('room-r3');
  });

  it('shows Unknown for the live-participant column when the SFU could not be reached for that room', () => {
    render(
      <RoomsList
        projectId="proj-1"
        initialRooms={[room('r1', { liveParticipantCount: null })]}
        connections={undefined}
      />,
    );
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('a failed background refetch preserves existing rows and never throws — errors preserve existing behavior', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }));
    const { sockets } = renderWithSocket();
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    act(() => sockets[0].receive({ type: 'room.created', roomId: 'r2', name: 'new-room', environment: 'development' }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    expectVisible('room-r1'); // untouched — the failed refetch changed nothing
    expectAbsent('new-room');
  });
});
