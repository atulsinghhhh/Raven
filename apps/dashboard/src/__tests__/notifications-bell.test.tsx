import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationsBell } from '@/components/shell/notifications-bell';
import type { NotificationSummary } from '@/lib/api-client';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';

jest.mock('@/lib/session-expiry', () => ({ handleSessionExpiry: jest.fn() }));

function notification(id: string, overrides: Partial<NotificationSummary> = {}): NotificationSummary {
  return {
    id,
    projectId: 'proj-1',
    type: 'WEBHOOK_DELIVERY_FAILED',
    title: 'Webhook delivery failing',
    message: 'https://example.com/hook has failed 3 times in a row.',
    payload: { endpointId: 'whe_1' },
    read: false,
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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

type FetchResult = { ok: boolean; status?: number; json?: () => Promise<unknown> };

function mockFetch(
  opts: {
    list?: () => Promise<FetchResult>;
    unreadCount?: () => Promise<FetchResult>;
    markRead?: () => Promise<FetchResult>;
    markAllRead?: () => Promise<FetchResult>;
  } = {},
) {
  const mock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/dashboard-ws-token')) return Promise.resolve(mockTokenResponse());
    if (url.includes('/unread-count')) {
      return opts.unreadCount ? opts.unreadCount() : Promise.resolve({ ok: true, json: async () => ({ count: 0 }) });
    }
    if (method === 'PATCH' && url.includes('/read')) {
      return opts.markRead ? opts.markRead() : Promise.resolve({ ok: true, json: async () => notification('n1', { read: true }) });
    }
    if (method === 'POST' && url.includes('/read-all')) {
      return opts.markAllRead ? opts.markAllRead() : Promise.resolve({ ok: true, status: 204 });
    }
    if (method === 'GET' && url.includes('/notifications')) {
      return opts.list ? opts.list() : Promise.resolve({ ok: true, json: async () => ({ data: [], nextCursor: null, hasMore: false }) });
    }
    return Promise.reject(new Error(`unmocked fetch in test: ${method} ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function listResult(items: NotificationSummary[]) {
  return { ok: true, json: async () => ({ data: items, nextCursor: null, hasMore: false }) };
}
function countResult(count: number) {
  return { ok: true, json: async () => ({ count }) };
}

function renderWithSocket(props: Partial<React.ComponentProps<typeof NotificationsBell>> = {}) {
  const sockets: FakeSocket[] = [];
  const utils = render(
    <NotificationsBell
      projectId="proj-1"
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

describe('NotificationsBell', () => {
  beforeEach(() => {
    mockFetch();
    jest.spyOn(toast, 'error').mockImplementation(() => 'toast_test');
    (handleSessionExpiry as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('the trigger has no accessible name at all when there is nothing unread', async () => {
    mockFetch({ list: () => Promise.resolve(listResult([])), unreadCount: () => Promise.resolve(countResult(0)) });
    render(<NotificationsBell projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument());
  });

  it('the unread count reaches the accessible name, not just the visual badge', async () => {
    // Menu sets aria-label directly on the trigger button, which replaces
    // its text content for accessible-name purposes rather than merging
    // with it — a sr-only span inside the trigger claiming the count would
    // never actually be read by a screen reader. The count has to be in
    // the label string itself.
    mockFetch({
      list: () => Promise.resolve(listResult([notification('n1')])),
      unreadCount: () => Promise.resolve(countResult(3)),
    });
    render(<NotificationsBell projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument());
    // The visually-hidden duplicate that never reached assistive tech is gone.
    expect(screen.queryByText('3 unread notifications')).not.toBeInTheDocument();
  });

  it('shows a loading state before the initial fetch resolves', async () => {
    let resolveList!: (value: FetchResult) => void;
    mockFetch({ list: () => new Promise((resolve) => (resolveList = resolve)) });

    const user = userEvent.setup();
    render(<NotificationsBell projectId="proj-1" />);
    await user.click(screen.getByRole('button', { name: /^Notifications/ }));

    // Phase 6B: shape-matching skeleton, not bare "Loading…" text.
    expect(screen.queryByText('Nothing to report right now.')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load notifications')).not.toBeInTheDocument();
    await act(async () => {
      resolveList(listResult([]));
    });
  });

  it('shows the unread count badge and the notification list once loaded', async () => {
    mockFetch({ list: () => Promise.resolve(listResult([notification('n1')])), unreadCount: () => Promise.resolve(countResult(1)) });

    const user = userEvent.setup();
    render(<NotificationsBell projectId="proj-1" />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument()); // badge

    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(screen.getByText('Webhook delivery failing')).toBeInTheDocument();
  });

  it('shows the empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    render(<NotificationsBell projectId="proj-1" />);

    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    await waitFor(() => expect(screen.getByText('Nothing to report right now.')).toBeInTheDocument());
  });

  it('shows an error state when the initial fetch fails', async () => {
    mockFetch({ list: () => Promise.resolve({ ok: false, status: 500 }) });

    const user = userEvent.setup();
    render(<NotificationsBell projectId="proj-1" />);
    await user.click(screen.getByRole('button', { name: /^Notifications/ }));

    await waitFor(() => expect(screen.getByText('Could not load notifications')).toBeInTheDocument());
  });

  it('retries the fetch when the retry button is clicked after a failure', async () => {
    let listCallCount = 0;
    mockFetch({
      list: () => {
        listCallCount += 1;
        return listCallCount === 1
          ? Promise.resolve({ ok: false, status: 500 })
          : Promise.resolve(listResult([notification('n1')]));
      },
    });

    const user = userEvent.setup();
    render(<NotificationsBell projectId="proj-1" />);
    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    await waitFor(() => expect(screen.getByText('Could not load notifications')).toBeInTheDocument());

    // Clicking anything inside the menu closes it (Menu's own behavior, same
    // as clicking a notification row) — the retry itself isn't visible until
    // reopening, but it did fire in the background.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listCallCount).toBe(2));

    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    await waitFor(() => expect(screen.getByText('Webhook delivery failing')).toBeInTheDocument());
    expect(screen.queryByText('Could not load notifications')).not.toBeInTheDocument();
  });

  it('defers to handleSessionExpiry when the initial fetch gets a 401, instead of the generic error state', async () => {
    (handleSessionExpiry as jest.Mock).mockReturnValue(true);
    mockFetch({ list: () => Promise.resolve({ ok: false, status: 401, json: async () => ({ code: 'UNAUTHORIZED', message: 'Not signed in' }) }) });

    render(<NotificationsBell projectId="proj-1" />);

    await waitFor(() => expect(handleSessionExpiry).toHaveBeenCalled());
  });

  it('ArrowDown moves roving focus between notification items, the same contract Menu documents for every other menu', async () => {
    mockFetch({
      list: () => Promise.resolve(listResult([notification('n1'), notification('n2')])),
      unreadCount: () => Promise.resolve(countResult(2)),
    });
    const user = userEvent.setup();
    render(<NotificationsBell projectId="proj-1" />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);

    // Menu's own arrow-key handling only finds items marked role="menuitem"
    // (see menu.tsx's onMenuKeyDown) — without it on these notification
    // links, ArrowDown/ArrowUp silently did nothing. Focused directly
    // rather than via Tab: "Mark all read" is a real, earlier tab stop
    // whenever there's something unread (as here), and how many Tabs it
    // takes to reach the first item isn't what this test is about.
    items[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
  });

  describe('mark read / mark all read', () => {
    it('marks one notification read optimistically and calls the PATCH endpoint', async () => {
      const markRead = jest.fn().mockResolvedValue({ ok: true, json: async () => notification('n1', { read: true }) });
      mockFetch({
        list: () => Promise.resolve(listResult([notification('n1')])),
        unreadCount: () => Promise.resolve(countResult(1)),
        markRead,
      });

      const user = userEvent.setup();
      render(<NotificationsBell projectId="proj-1" />);
      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /^Notifications/ }));

      await user.click(screen.getByText('Webhook delivery failing'));

      expect(markRead).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument()); // badge cleared
    });

    it('reverts and toasts when marking read fails', async () => {
      mockFetch({
        list: () => Promise.resolve(listResult([notification('n1')])),
        unreadCount: () => Promise.resolve(countResult(1)),
        markRead: () => Promise.resolve({ ok: false, status: 500 }),
      });

      const user = userEvent.setup();
      render(<NotificationsBell projectId="proj-1" />);
      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /^Notifications/ }));
      await user.click(screen.getByText('Webhook delivery failing'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not mark that notification read.'));
      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument()); // badge restored
    });

    it('marks all notifications read and clears the badge', async () => {
      const markAllRead = jest.fn().mockResolvedValue({ ok: true, status: 204 });
      mockFetch({
        list: () => Promise.resolve(listResult([notification('n1'), notification('n2')])),
        unreadCount: () => Promise.resolve(countResult(2)),
        markAllRead,
      });

      const user = userEvent.setup();
      render(<NotificationsBell projectId="proj-1" />);
      await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /^Notifications/ }));

      await user.click(screen.getByRole('button', { name: 'Mark all read' }));

      expect(markAllRead).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText('2')).not.toBeInTheDocument());
    });
  });

  describe('realtime (Phase 5F)', () => {
    it('a notification.created event triggers a refetch — new notification and updated count appear', async () => {
      mockFetch({ list: () => Promise.resolve(listResult([])), unreadCount: () => Promise.resolve(countResult(0)) });
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      mockFetch({
        list: () => Promise.resolve(listResult([notification('n1')])),
        unreadCount: () => Promise.resolve(countResult(1)),
      });
      act(() => sockets[0].receive({ type: 'notification.created' }));

      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    });

    it('ignores an unrelated event type without refetching', async () => {
      const fetchMock = mockFetch();
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      const callsAtOpen = fetchMock.mock.calls.length;

      act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(fetchMock.mock.calls.length).toBe(callsAtOpen);
    });

    it('duplicate notification.created events are safe — a burst collapses into one refetch', async () => {
      mockFetch();
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      const fetchMock = mockFetch({
        list: () => Promise.resolve(listResult([notification('n1')])),
        unreadCount: () => Promise.resolve(countResult(1)),
      });
      act(() => sockets[0].receive({ type: 'notification.created' }));
      act(() => sockets[0].receive({ type: 'notification.created' }));
      act(() => sockets[0].receive({ type: 'notification.created' }));

      await new Promise((resolve) => setTimeout(resolve, 600));
      const listCalls = fetchMock.mock.calls.filter(([url]) => {
        const u = String(url);
        return u.includes('/notifications') && !u.includes('unread-count') && !u.includes('dashboard-ws-token');
      });
      expect(listCalls).toHaveLength(1);
    });

    it('reconnect refreshes the snapshot — catches up on a notification created entirely while disconnected', async () => {
      mockFetch({ list: () => Promise.resolve(listResult([])), unreadCount: () => Promise.resolve(countResult(0)) });
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      mockFetch({
        list: () => Promise.resolve(listResult([notification('n1')])),
        unreadCount: () => Promise.resolve(countResult(1)),
      });
      act(() => sockets[0].serverClose(1006, 'abnormal closure'));
      await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
      act(() => sockets[1].open());

      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());
    });
  });

  describe('project switching', () => {
    it('switching projectId clears the previous project\'s state and fetches a fresh snapshot for the new one', async () => {
      mockFetch({
        list: () => Promise.resolve(listResult([notification('n1', { projectId: 'proj-1' })])),
        unreadCount: () => Promise.resolve(countResult(1)),
      });
      const { rerender } = render(<NotificationsBell projectId="proj-1" />);
      await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());

      mockFetch({
        list: () => Promise.resolve(listResult([])),
        unreadCount: () => Promise.resolve(countResult(0)),
      });
      rerender(<NotificationsBell projectId="proj-2" />);

      // No stale project-1 badge lingers, even momentarily, once the
      // effect for the new project has run.
      await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument());
    });
  });
});
