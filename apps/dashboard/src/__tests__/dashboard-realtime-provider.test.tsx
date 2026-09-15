import { act, render, screen, waitFor } from '@testing-library/react';
import { DashboardRealtimeProvider } from '@/lib/realtime/dashboard-realtime-provider';
import { useDashboardRealtime } from '@/lib/realtime/use-dashboard-realtime';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';

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

/** Stands in for NotificationsBell/ConnectionsList/etc — a page-level consumer of realtime. */
function Consumer({
  label,
  onFrame,
}: {
  label: string;
  onFrame: (label: string, frame: Record<string, unknown>) => void;
}) {
  const { status } = useDashboardRealtime('project-1', {
    onEvent: (frame) => onFrame(label, frame),
  });
  return <span data-testid={`status-${label}`}>{status}</span>;
}

describe('DashboardRealtimeProvider', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens exactly one socket for two consumers mounted under the same provider, not one each', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];
    const received: Array<[string, Record<string, unknown>]> = [];

    render(
      <DashboardRealtimeProvider
        projectId="project-1"
        socketFactory={(url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket;
        }}
      >
        <Consumer label="bell" onFrame={(label, frame) => received.push([label, frame])} />
        <Consumer label="list" onFrame={(label, frame) => received.push([label, frame])} />
      </DashboardRealtimeProvider>,
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    // Only one token mint too — the actual per-tab cost this is meant to avoid.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);

    act(() => sockets[0].open());
    expect(screen.getByTestId('status-bell')).toHaveTextContent('open');
    expect(screen.getByTestId('status-list')).toHaveTextContent('open');

    act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1' }));

    // The one frame reached both subscribers off the one socket.
    expect(received).toEqual([
      ['bell', { type: 'room.created', roomId: 'r1' }],
      ['list', { type: 'room.created', roomId: 'r1' }],
    ]);
  });

  it('a consumer unmounting early leaves the shared connection and the other subscriber alone', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];
    const received: Array<[string, Record<string, unknown>]> = [];

    function Wrapper({ showList }: { showList: boolean }) {
      return (
        <DashboardRealtimeProvider
          projectId="project-1"
          socketFactory={(url) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
          }}
        >
          <Consumer label="bell" onFrame={(label, frame) => received.push([label, frame])} />
          {showList && <Consumer label="list" onFrame={(label, frame) => received.push([label, frame])} />}
        </DashboardRealtimeProvider>
      );
    }

    const { rerender } = render(<Wrapper showList />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());

    rerender(<Wrapper showList={false} />);
    // Unsubscribing "list" must not tear down the shared socket "bell" still needs.
    expect(sockets[0].closedWith).toBeUndefined();

    act(() => sockets[0].receive({ type: 'room.created', roomId: 'r2' }));
    expect(received).toEqual([['bell', { type: 'room.created', roomId: 'r2' }]]);
  });

  it('without a provider ancestor, a consumer still opens its own connection (existing standalone behavior)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockTokenResponse('project-1'));
    const sockets: FakeSocket[] = [];

    function StandaloneConsumer() {
      const { status } = useDashboardRealtime('project-1', {
        socketFactory: (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket;
        },
      });
      return <span data-testid="status">{status}</span>;
    }

    render(<StandaloneConsumer />);
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].open());
    expect(screen.getByTestId('status')).toHaveTextContent('open');
  });
});
