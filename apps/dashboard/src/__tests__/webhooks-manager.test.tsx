import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebhooksManager } from '@/app/dashboard/projects/[projectId]/webhooks/webhooks-manager';
import type { WebhookEndpointSummary } from '@/lib/api-client';
import type { DashboardRealtimeSocketLike } from '@/lib/realtime/dashboard-realtime-transport';
import { toast } from '@/lib/toast';
import { handleSessionExpiry } from '@/lib/session-expiry';

jest.mock('@/lib/session-expiry', () => ({ handleSessionExpiry: jest.fn() }));

function endpoint(publicId: string, overrides: Partial<WebhookEndpointSummary> = {}): WebhookEndpointSummary {
  return {
    id: publicId,
    publicId,
    projectId: 'proj-1',
    url: `https://example.com/${publicId}`,
    description: null,
    enabledEvents: [],
    status: 'ACTIVE',
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

/**
 * WebhooksManager mounts useDashboardRealtime (Phase 5D), which fires its
 * own `fetch` to the dashboard-ws-token endpoint on mount, then (once the
 * fake socket opens) refetches `/webhooks` on a failure/disabled nudge.
 * Every fetch mock here is URL-aware for that reason — see
 * connections-list.test.tsx / rooms-list.test.tsx for the same pattern.
 */
function mockFetch(webhooks?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const mock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboard-ws-token')) {
      return Promise.resolve(mockTokenResponse());
    }
    if (webhooks) return webhooks();
    return Promise.reject(new Error(`unmocked fetch in test: ${url}`));
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function webhooksFetchCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(([url]) => String(url).includes('/webhooks') && !String(url).includes('dashboard-ws-token'));
}

function renderWithSocket(props: Partial<React.ComponentProps<typeof WebhooksManager>> = {}) {
  const sockets: FakeSocket[] = [];
  const utils = render(
    <WebhooksManager
      projectId="proj-1"
      initialEndpoints={[endpoint('whe_1')]}
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

describe('WebhooksManager', () => {
  beforeEach(() => {
    mockFetch();
    jest.spyOn(toast, 'error').mockImplementation(() => 'toast_test');
    jest.spyOn(toast, 'success').mockImplementation(() => 'toast_test');
    (handleSessionExpiry as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the initial SSR-provided snapshot', () => {
    render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1'), endpoint('whe_2')]} />);
    expect(screen.getByText('https://example.com/whe_1')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/whe_2')).toBeInTheDocument();
  });

  describe('realtime (Phase 5D)', () => {
    it('a webhook.delivery_failed event refreshes the data — the failure count updates without a manual reload', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => [endpoint('whe_1', { consecutiveFailures: 3 })],
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expect(screen.queryByText(/3 consecutive failures/)).not.toBeInTheDocument();

      act(() => sockets[0].receive({ type: 'webhook.delivery_failed', endpointId: 'whe_1', failureCount: 3 }));

      await waitFor(() => expect(screen.getByText(/3 consecutive failures/)).toBeInTheDocument());
    });

    it('a webhook.endpoint_disabled event refreshes the data — status flips to disabled without a manual reload', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => [endpoint('whe_1', { status: 'DISABLED', consecutiveFailures: 50 })],
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());
      expect(screen.getByText('active')).toBeInTheDocument();

      act(() => sockets[0].receive({ type: 'webhook.endpoint_disabled', endpointId: 'whe_1' }));

      await waitFor(() => expect(screen.getByText('disabled')).toBeInTheDocument());
      expect(screen.getByText(/Livqeno disabled this endpoint/)).toBeInTheDocument();
    });

    it('ignores an unrelated event type without refetching', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [endpoint('whe_1')] }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'room.created', roomId: 'r1', name: 'lobby', environment: 'development' }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(webhooksFetchCalls(fetchMock)).toHaveLength(0);
    });

    it('duplicate events are safe — replaying the same nudge twice settles on the same, non-duplicated state', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => [endpoint('whe_1', { consecutiveFailures: 5 })],
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      const frame = { type: 'webhook.delivery_failed', endpointId: 'whe_1', failureCount: 5 };
      act(() => sockets[0].receive(frame));
      act(() => sockets[0].receive(frame));

      await waitFor(() => expect(screen.getByText(/5 consecutive failures/)).toBeInTheDocument());
      // Still exactly one row for whe_1 — the merge is upsert-by-publicId.
      expect(screen.getAllByText('https://example.com/whe_1')).toHaveLength(1);
    });

    it('a burst of failure events within the debounce window collapses into one refetch', async () => {
      const fetchMock = mockFetch(async () => ({ ok: true, json: async () => [endpoint('whe_1')] }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      for (let i = 1; i <= 5; i += 1) {
        act(() => sockets[0].receive({ type: 'webhook.delivery_failed', endpointId: 'whe_1', failureCount: i }));
      }

      await new Promise((resolve) => setTimeout(resolve, 600)); // past the 400ms debounce
      expect(webhooksFetchCalls(fetchMock)).toHaveLength(1);
    });

    it('reconnect refreshes the snapshot — catches up on failures that happened entirely while disconnected', async () => {
      mockFetch(async () => ({
        ok: true,
        json: async () => [endpoint('whe_1', { consecutiveFailures: 4 })],
      }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].serverClose(1006, 'abnormal closure'));
      await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
      act(() => sockets[1].open());

      await waitFor(() => expect(screen.getByText(/4 consecutive failures/)).toBeInTheDocument());
    });

    it('a failed background refetch preserves existing rows and never throws', async () => {
      mockFetch(async () => ({ ok: false, status: 500 }));
      const { sockets } = renderWithSocket();
      await waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].open());

      act(() => sockets[0].receive({ type: 'webhook.delivery_failed', endpointId: 'whe_1', failureCount: 1 }));

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(screen.getByText('https://example.com/whe_1')).toBeInTheDocument();
    });
  });

  describe('existing REST behavior is preserved', () => {
    it('creating an endpoint still shows the signing secret once and prepends the new row', async () => {
      const fetchMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks') && !url.includes('whe_')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ ...endpoint('whe_new'), signingSecret: 'whsec_abc', warning: 'shown once' }),
          });
        }
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[]} />);

      await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/new');
      await user.click(screen.getByRole('button', { name: 'Create endpoint' }));

      await waitFor(() => expect(screen.getByText('whsec_abc')).toBeInTheDocument());
      expect(toast.success).toHaveBeenCalledWith('Webhook endpoint created');
    });

    it('status toggle (Disable/Enable) still works and shows its own toast', async () => {
      mockFetch();
      const patchMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks/whe_1')) {
          return Promise.resolve({ ok: true, json: async () => endpoint('whe_1', { status: 'DISABLED' }) });
        }
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = patchMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1')]} />);

      await user.click(screen.getByRole('button', { name: 'Disable' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Webhook endpoint disabled'));
      expect(screen.getByText('disabled')).toBeInTheDocument();
    });

    it('delete still works and removes the row, with its own toast', async () => {
      const deleteMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks/whe_1')) return Promise.resolve({ ok: true, status: 204 });
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = deleteMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1')]} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      // First click only reveals the restated-consequence confirm row.
      expect(screen.getByText(/Delete the webhook endpoint for .*\? It stops receiving events immediately\./)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Webhook endpoint removed'));
      expect(screen.queryByText('https://example.com/whe_1')).not.toBeInTheDocument();
    });

    it('a failed status-toggle request still shows the existing error toast, unaffected by realtime', async () => {
      const failMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks/whe_1')) {
          return Promise.resolve({ ok: false, status: 502, json: async () => ({ message: 'Could not update the webhook endpoint' }) });
        }
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = failMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1')]} />);

      await user.click(screen.getByRole('button', { name: 'Disable' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update the webhook endpoint'));
      expect(screen.getByText('active')).toBeInTheDocument(); // unchanged
    });

    it('shows the empty state when there are no endpoints', () => {
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[]} />);
      expect(screen.getByText('No webhook endpoints')).toBeInTheDocument();
    });

    it('a failed create shows both the inline error and a toast (Phase 6A: consistent with the other two mutations here)', async () => {
      const fetchMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks') && !url.includes('whe_')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({ code: 'VALIDATION_FAILED', message: 'url is required' }),
          });
        }
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[]} />);

      await user.type(screen.getByLabelText('Endpoint URL'), 'https://example.com/new');
      await user.click(screen.getByRole('button', { name: 'Create endpoint' }));

      await waitFor(() => expect(screen.getByText('url is required')).toBeInTheDocument());
      expect(toast.error).toHaveBeenCalledWith('url is required');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('cancelling the confirmation leaves the endpoint in place and never calls DELETE', async () => {
      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1')]} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('https://example.com/whe_1')).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
      // Back to the trigger button, not stuck on the confirm row.
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('a failed delete leaves the row in place and shows the error toast', async () => {
      const failMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks/whe_1')) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ message: 'Could not remove the webhook endpoint' }) });
        }
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = failMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1')]} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not remove the webhook endpoint'));
      expect(screen.getByText('https://example.com/whe_1')).toBeInTheDocument(); // still there
    });

    it('defers to handleSessionExpiry on a 401 from a mutation, with no toast/inline error of its own', async () => {
      (handleSessionExpiry as jest.Mock).mockReturnValue(true);
      const failMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-ws-token')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        if (url.includes('/webhooks/whe_1')) {
          return Promise.resolve({ ok: false, status: 401, json: async () => ({ code: 'UNAUTHORIZED', message: 'Not signed in' }) });
        }
        return Promise.reject(new Error(`unmocked: ${url}`));
      });
      global.fetch = failMock as unknown as typeof fetch;

      const user = userEvent.setup();
      render(<WebhooksManager projectId="proj-1" initialEndpoints={[endpoint('whe_1')]} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

      await waitFor(() => expect(handleSessionExpiry).toHaveBeenCalled());
      expect(toast.error).not.toHaveBeenCalled();
      expect(screen.getByText('https://example.com/whe_1')).toBeInTheDocument();
    });
  });
});
