import { act, render, screen, waitFor } from '@testing-library/react';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';
import { toast } from '@/lib/toast';

class FakeSocket implements DashboardRealtimeSocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closedWith: { code?: number; reason?: string } | undefined;

  constructor(public url: string) {}

  send() {}

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
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

function mockTokenResponse(projectId: string) {
  return {
    ok: true,
    json: async () => ({
      token: `token-for-${projectId}`,
      tokenId: 'dwt_1',
      userId: 'user-1',
      projectId,
      wsUrl: 'wss://api.example.com/v1/dashboard/ws',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  };
}

function Probe({ projectId, sockets }: { projectId: string; sockets: FakeSocket[] }) {
  const { status } = useDashboardRealtime(projectId, {
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return <span data-testid="status">{status}</span>;
}

function ProbeWithCallbacks({
  projectId,
  sockets,
  onEvent,
  onReconnected,
}: {
  projectId: string;
  sockets: FakeSocket[];
  onEvent: (frame: Record<string, unknown>) => void;
  onReconnected: () => void;
}) {
  const { status } = useDashboardRealtime(projectId, {
    onEvent,
    onReconnected,
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return <span data-testid="status">{status}</span>;
}

describe('useDashboardRealtime', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.spyOn(toast, 'warning').mockImplementation(() => 'toast_test');
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects: mints a token for the project, then opens a socket and reports open', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];

    render(<Probe projectId="project-1" sockets={sockets} />);

    expect(screen.getByTestId('status')).toHaveTextContent('connecting');

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1/dashboard-ws-token', expect.objectContaining({ method: 'POST' }));
    expect(sockets[0].url).toContain('token=token-for-project-1');

    act(() => sockets[0].open());
    expect(screen.getByTestId('status')).toHaveTextContent('open');
  });

  it('reports failed when the token mint request itself fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
    const sockets: FakeSocket[] = [];

    render(<Probe projectId="project-1" sockets={sockets} />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));
    expect(sockets).toHaveLength(0); // never attempted a socket without a token
  });

  it('project change: closes the old socket and opens a fresh one scoped to the new project, never reusing the old token', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const projectId = url.match(/projects\/([^/]+)\//)?.[1] ?? 'unknown';
      return Promise.resolve(mockTokenResponse(projectId));
    });
    const sockets: FakeSocket[] = [];

    const { rerender } = render(<Probe projectId="project-a" sockets={sockets} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());
    expect(sockets[0].url).toContain('token=token-for-project-a');
    expect(sockets[0].closedWith).toBeUndefined();

    rerender(<Probe projectId="project-b" sockets={sockets} />);

    // The effect's cleanup closes project-a's socket immediately, before
    // project-b's token mint even resolves.
    expect(sockets[0].closedWith).toBeDefined();

    await waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets[1].url).toContain('token=token-for-project-b');
    expect(sockets[1].url).not.toContain('token-for-project-a');
  });

  it('cleanup: unmounting closes the socket and mints no further tokens', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];

    const { unmount } = render(<Probe projectId="project-1" sockets={sockets} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    const fetchCallsBeforeUnmount = (global.fetch as jest.Mock).mock.calls.length;
    unmount();

    expect(sockets[0].closedWith).toBeDefined();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCallsBeforeUnmount);
  });

  it('terminal close does not endlessly reconnect: status settles on failed and mints no further tokens', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];

    render(<Probe projectId="project-1" sockets={sockets} />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    // DASHBOARD_WS_CLOSE_AUTH_FAILED — retrying could never have helped.
    act(() => sockets[0].onclose?.({ code: 4801, reason: 'INVALID_TOKEN' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));

    const fetchCallsAtFailure = (global.fetch as jest.Mock).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sockets).toHaveLength(1); // no reconnect attempt was ever scheduled
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCallsAtFailure);

    // A permanently failed connection is otherwise invisible: no caller reads
    // `status`, so this is the only user-facing signal that live updates stopped.
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('disconnected'));

    // Phase 6H: the one intentional console line for this rare, terminal
    // path — a developer diagnosing over a screenshare has something to
    // go on. Names the project, never the token or wsUrl.
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const [loggedLine] = consoleWarnSpy.mock.calls[0];
    expect(loggedLine).toContain('project-1');
    expect(loggedLine).not.toContain('token-for-project-1');
  });

  it('onEvent: forwards every server frame to the consumer, including product events (Phase 5C)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];
    const received: Record<string, unknown>[] = [];

    render(
      <ProbeWithCallbacks projectId="project-1" sockets={sockets} onEvent={(frame) => received.push(frame)} onReconnected={() => {}} />,
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    act(() =>
      sockets[0].receive({ type: 'connection.state_changed', connectionId: 'conn_abc', roomId: 'room-1', state: 'CONNECTED' }),
    );
    act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' }));

    expect(received).toEqual([
      { type: 'connection.state_changed', connectionId: 'conn_abc', roomId: 'room-1', state: 'CONNECTED' },
      { type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' },
    ]);
  });

  it('onReconnected: fires when the socket re-opens after a drop, never on the initial connect', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];
    const reconnectCalls: number[] = [];
    let calls = 0;

    render(
      <ProbeWithCallbacks
        projectId="project-1"
        sockets={sockets}
        onEvent={() => {}}
        onReconnected={() => reconnectCalls.push(++calls)}
      />,
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    // Initial connect: no reconnect callback yet.
    expect(reconnectCalls).toHaveLength(0);

    // Drop, then the transport's own backoff reopens a new socket.
    act(() => sockets[0].serverClose(1006, 'abnormal closure'));
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
    act(() => sockets[1].open());

    expect(reconnectCalls).toEqual([1]);
    // A recoverable drop is self-healing and common on a flaky connection —
    // only the terminal 'failed' state is worth interrupting the user for.
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('onReconnected: does not fire again just because another frame arrives on the same still-open connection', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];
    let reconnectCount = 0;

    render(
      <ProbeWithCallbacks
        projectId="project-1"
        sockets={sockets}
        onEvent={() => {}}
        onReconnected={() => (reconnectCount += 1)}
      />,
    );
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());
    act(() => sockets[0].receive({ type: 'connection.state_changed', connectionId: 'conn_abc', roomId: 'room-1', state: 'CONNECTED' }));
    act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' }));

    expect(reconnectCount).toBe(0);
  });
});
