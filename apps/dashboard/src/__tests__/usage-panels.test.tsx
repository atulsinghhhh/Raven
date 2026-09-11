import { render, screen } from '@testing-library/react';
import { Meter } from '@/components/ui/meter';
import { AllowanceMeter, DailyUsageChart, ExhaustedNotice, UsageHistoryTable } from '@/components/usage/usage-panels';
import type { UsageHistoryEntry, UsageSummary } from '@/lib/api-client';

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    includedMinutes: 20_000,
    usedMinutes: 0,
    remainingMinutes: 20_000,
    usedPercent: 0,
    exhausted: false,
    exhaustedAt: null,
    enforced: true,
    source: 'FREE_TIER',
    grantedAt: '2026-01-01T00:00:00.000Z',
    usedSeconds: 0,
    liveSessions: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<UsageHistoryEntry> = {}): UsageHistoryEntry {
  return {
    id: 'us_1',
    projectId: 'p_1',
    projectName: 'Demo',
    environment: 'PRODUCTION',
    roomName: 'lobby',
    participantIdentity: 'alice',
    kind: 'RTC_PARTICIPANT_MINUTES',
    startedAt: '2026-06-01T10:00:00.000Z',
    endedAt: '2026-06-01T10:05:00.000Z',
    meteredSeconds: 300,
    meteredMinutes: 5,
    closeReason: 'left',
    live: false,
    ...overrides,
  };
}

describe('Meter', () => {
  it('exposes the real quantities to assistive tech, not just a bar width', () => {
    render(<Meter label="Minutes used" valueLabel="5,000 / 20,000" percent={25} value={5_000} max={20_000} />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('value', '5000');
    expect(meter).toHaveAttribute('max', '20000');
  });

  it('clamps a value past the ceiling instead of overflowing the track', () => {
    // A live call is never cut off mid-sentence, so consumption can exceed
    // the allowance. The meter must not render past 100%.
    render(<Meter label="Minutes used" valueLabel="20,600 / 20,000" percent={103} value={20_600} max={20_000} />);

    expect(screen.getByRole('meter')).toHaveAttribute('value', '20000');
  });
});

describe('AllowanceMeter', () => {
  it('shows the granted, used and remaining minutes as reported by the API', () => {
    render(
      <AllowanceMeter
        summary={summary({ usedMinutes: 5_000, remainingMinutes: 15_000, usedPercent: 25, usedSeconds: 300_000 })}
      />,
    );

    // Twice on purpose: the visible reading, and the `<meter>` element's
    // own text content for assistive tech.
    expect(screen.getAllByText('5,000 / 20,000').length).toBe(2);
    expect(screen.getByText(/15,000 minutes remaining/)).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders whatever allowance the account was granted, never a hardcoded figure', () => {
    // A future Admin Portal can raise one developer's allocation. The UI
    // must follow the row, not a constant.
    render(<AllowanceMeter summary={summary({ includedMinutes: 50_000, remainingMinutes: 50_000 })} />);

    expect(screen.getAllByText('0 / 50,000').length).toBeGreaterThan(0);
    expect(screen.getByRole('meter')).toHaveAttribute('max', '50000');
    expect(screen.queryByText(/20,000/)).not.toBeInTheDocument();
  });

  it('warns before the allowance runs out', () => {
    render(<AllowanceMeter summary={summary({ usedMinutes: 17_000, remainingMinutes: 3_000, usedPercent: 85 })} />);

    expect(screen.getByText('Running low')).toBeInTheDocument();
  });

  it('says plainly that the allowance is used up', () => {
    render(
      <AllowanceMeter
        summary={summary({
          usedMinutes: 20_000,
          remainingMinutes: 0,
          usedPercent: 100,
          exhausted: true,
          exhaustedAt: '2026-06-01T10:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText('Exhausted')).toBeInTheDocument();
    expect(screen.getByText(/Free allowance used up/)).toBeInTheDocument();
    expect(screen.getByText(/does not reset/)).toBeInTheDocument();
  });
});

describe('ExhaustedNotice', () => {
  it('renders nothing while there are minutes left', () => {
    const { container } = render(<ExhaustedNotice summary={summary({ usedMinutes: 100 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the exhausted state and names the error code a caller will see', () => {
    render(<ExhaustedNotice summary={summary({ usedMinutes: 20_000, remainingMinutes: 0, exhausted: true })} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('used all 20,000 of its included Livqeno minutes');
    expect(alert).toHaveTextContent('RAVEN_USAGE_LIMIT_EXCEEDED');
    expect(alert).toHaveTextContent('already running were not cut off');
  });

  it('offers no upgrade or payment path, because there is none', () => {
    render(<ExhaustedNotice summary={summary({ usedMinutes: 20_000, remainingMinutes: 0, exhausted: true })} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toMatch(/upgrade|billing|pay|plan|card|subscri/i);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says sessions still run when the deployment does not enforce the limit', () => {
    render(
      <ExhaustedNotice
        summary={summary({ usedMinutes: 20_000, remainingMinutes: 0, exhausted: true, enforced: false })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enforcement is off');
  });
});

describe('UsageHistoryTable', () => {
  it('teaches what fills the list when it is empty, rather than reporting a zero', () => {
    render(<UsageHistoryTable history={[]} />);

    expect(screen.getByText('No metered sessions yet')).toBeInTheDocument();
    expect(screen.getByText(/never reported by the client/)).toBeInTheDocument();
  });

  it('renders a session with its project, room and metered time', () => {
    render(<UsageHistoryTable history={[entry()]} />);

    expect(screen.getAllByText('Demo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('lobby').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5m 0s').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ended').length).toBeGreaterThan(0);
  });

  it('marks a session that is still accruing minutes', () => {
    render(<UsageHistoryTable history={[entry({ endedAt: null, closeReason: null, live: true })]} />);

    expect(screen.getAllByText('Metering').length).toBeGreaterThan(0);
  });

  it('surfaces an abandoned session instead of smoothing it into "ended"', () => {
    // It means Livqeno lost the gateway and credited only up to the last
    // confirmed-alive instant — a developer reconciling minutes needs it.
    render(<UsageHistoryTable history={[entry({ closeReason: 'abandoned' })]} />);

    expect(screen.getAllByText('Abandoned').length).toBeGreaterThan(0);
  });

  it('drops the project column on a project-scoped page', () => {
    render(<UsageHistoryTable history={[entry()]} showProject={false} />);

    expect(screen.queryByRole('columnheader', { name: /project/i })).not.toBeInTheDocument();
  });
});

describe('DailyUsageChart', () => {
  it('plots the buckets and keeps the numbers available as text', () => {
    render(
      <DailyUsageChart
        days={3}
        daily={[
          { date: '2026-05-30', seconds: 0, minutes: 0, sessions: 0 },
          { date: '2026-05-31', seconds: 120, minutes: 2, sessions: 1 },
          { date: '2026-06-01', seconds: 600, minutes: 10, sessions: 4 },
        ]}
      />,
    );

    expect(screen.getByText('Minutes per day — last 3 days')).toBeInTheDocument();
    // The chart carries an sr-only data table: a bar height is not
    // information a screen reader can use.
    expect(screen.getByText('Metered minutes per day')).toBeInTheDocument();
  });

  it('says the window is empty rather than drawing a flat line at zero', () => {
    render(
      <DailyUsageChart
        days={2}
        daily={[
          { date: '2026-05-31', seconds: 0, minutes: 0, sessions: 0 },
          { date: '2026-06-01', seconds: 0, minutes: 0, sessions: 0 },
        ]}
      />,
    );

    expect(screen.getByText('No metered sessions in this window')).toBeInTheDocument();
  });
});
