import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FleetTable } from '@/app/dashboard/projects/[projectId]/servers/fleet-table';
import type { RtcServer } from '@/lib/api-client';

function makeServer(overrides: Partial<RtcServer> = {}): RtcServer {
  return {
    id: 'srv-1',
    name: 'sfu-local-01',
    region: 'local',
    status: 'HEALTHY',
    publicHost: '127.0.0.1',
    internalUrl: 'http://sfu:7000',
    capacity: 100,
    activeRooms: 3,
    activeParticipants: 7,
    cpuPercent: 41.5,
    memoryPercent: 62,
    networkInBps: 1_500_000,
    networkOutBps: 4_200_000,
    version: '0.1.0',
    lastHeartbeatAt: '2026-09-07T12:00:00.000Z',
    registeredAt: '2026-09-07T11:00:00.000Z',
    updatedAt: '2026-09-07T12:00:00.000Z',
    ...overrides,
  };
}

/** The desktop table is hidden below `sm`; both render, so scope queries to one. */
function desktop(): HTMLElement {
  const table = document.querySelector('table');
  if (!table) throw new Error('no table rendered');
  return table as HTMLElement;
}

describe('FleetTable', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('shows a node with its region, status and load', () => {
    render(<FleetTable initialServers={[makeServer()]} />);
    const table = within(desktop());

    expect(table.getByText('sfu-local-01')).toBeInTheDocument();
    expect(table.getByText('local')).toBeInTheDocument();
    expect(table.getByText('Healthy')).toBeInTheDocument();
    expect(table.getByText('0.1.0')).toBeInTheDocument();
    expect(table.getByText('41.5%')).toBeInTheDocument();
    expect(table.getByText('62%')).toBeInTheDocument();
  });

  it('never renders the node’s internal address', () => {
    // A client that learned an SFU's address could connect to it directly,
    // and then the media plane could not change without breaking it. The
    // dashboard does not need it either, so it is not put on the page.
    render(<FleetTable initialServers={[makeServer()]} />);
    expect(screen.queryByText(/sfu:7000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/http:\/\//)).not.toBeInTheDocument();
  });

  it('shows an unreported figure as a dash, never as zero', () => {
    // "This node did not tell us its CPU" and "this node is idle" are
    // different facts, and an operator must not have to guess which.
    render(<FleetTable initialServers={[makeServer({ cpuPercent: null, memoryPercent: null })]} />);
    const table = within(desktop());

    expect(table.queryByText('0%')).not.toBeInTheDocument();
    expect(table.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('drains a node, sending the target state explicitly', async () => {
    const drained = makeServer({ status: 'DRAINING' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => drained,
    });

    render(<FleetTable initialServers={[makeServer()]} />);
    await userEvent.click(within(desktop()).getByRole('button', { name: 'Drain' }));

    await waitFor(() => {
      expect(within(desktop()).getByText('Draining')).toBeInTheDocument();
    });

    // `draining, true`, not a toggle: two operators on stale pages must
    // not be able to flip a node by each clicking "the other way".
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ draining: true });
    // The row now offers the inverse action.
    expect(within(desktop()).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('offers Resume for a draining node, and sends draining: false', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeServer({ status: 'HEALTHY' }),
    });

    render(<FleetTable initialServers={[makeServer({ status: 'DRAINING' })]} />);
    await userEvent.click(within(desktop()).getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ draining: false });
    });
  });

  it('offers no action for a node that is not answering', () => {
    // It is already out of the allocation pool because it stopped
    // heartbeating; un-draining it would be a claim the control plane
    // overwrites on its next sweep.
    render(<FleetTable initialServers={[makeServer({ status: 'UNHEALTHY' })]} />);
    const table = within(desktop());

    expect(table.queryByRole('button')).not.toBeInTheDocument();
    expect(table.getByText('Not answering')).toBeInTheDocument();
  });

  it('surfaces the API’s own message when draining is refused', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'RTC_SERVER_NOT_FOUND', message: 'Unknown node' }),
    });

    render(<FleetTable initialServers={[makeServer()]} />);
    await userEvent.click(within(desktop()).getByRole('button', { name: 'Drain' }));

    await waitFor(() => {
      expect(screen.getByText('Unknown node')).toBeInTheDocument();
    });
    // The row is unchanged: a failed action must not look like it worked.
    expect(within(desktop()).getByText('Healthy')).toBeInTheDocument();
  });

  it('reports an unreachable Control API rather than failing silently', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));

    render(<FleetTable initialServers={[makeServer()]} />);
    await userEvent.click(within(desktop()).getByRole('button', { name: 'Drain' }));

    await waitFor(() => {
      expect(screen.getByText('Could not reach the Control API.')).toBeInTheDocument();
    });
  });

  it('shows a node that has never heartbeated as Never, not as fresh', () => {
    render(<FleetTable initialServers={[makeServer({ lastHeartbeatAt: null })]} />);
    expect(within(desktop()).getByText('Never')).toBeInTheDocument();
  });
});
