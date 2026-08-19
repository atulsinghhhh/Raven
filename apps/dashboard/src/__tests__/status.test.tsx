import { render, screen } from '@testing-library/react';
import {
  Badge,
  ConnectionStateBadge,
  deriveSystemStatus,
  StatusBadge,
  SystemStatusIndicator,
} from '@/components/ui/badge';

describe('deriveSystemStatus', () => {
  it('is operational only when every dependency is up', () => {
    expect(deriveSystemStatus({ database: 'up', redis: 'up', sfu: 'up', turn: 'up' })).toBe('operational');
  });

  it('degrades on a single failing dependency', () => {
    expect(deriveSystemStatus({ database: 'up', redis: 'up', sfu: 'down', turn: 'up' })).toBe('degraded');
  });

  it('escalates to a partial outage once more than one is down', () => {
    expect(deriveSystemStatus({ database: 'up', redis: 'down', sfu: 'down', turn: 'up' })).toBe('partial_outage');
  });

  it('reports unavailable when everything is down', () => {
    expect(deriveSystemStatus({ database: 'down', redis: 'down' })).toBe('unavailable');
  });

  // A failed health check is not a healthy system — it must never
  // optimistically render as operational.
  it('reports unknown when health could not be read at all', () => {
    expect(deriveSystemStatus(undefined)).toBe('unknown');
    expect(deriveSystemStatus({})).toBe('unknown');
  });
});

describe('status indicators', () => {
  it('pairs the system status colour with a text label', () => {
    render(<SystemStatusIndicator status="degraded" />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('announces what the indicator is describing to screen readers', () => {
    render(<SystemStatusIndicator status="operational" />);
    expect(screen.getByText('System status:')).toBeInTheDocument();
  });

  it('renders dependency status as words, not colour alone', () => {
    const { rerender } = render(<StatusBadge status="up" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    rerender(<StatusBadge status="down" />);
    expect(screen.getByText('Down')).toBeInTheDocument();

    rerender(<StatusBadge status="unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('gives each badge tone a distinct glyph so it survives greyscale', () => {
    const { container: success } = render(<Badge tone="success">ok</Badge>);
    const { container: danger } = render(<Badge tone="danger">bad</Badge>);
    expect(success.textContent).not.toBe(danger.textContent);
  });

  it('labels connection states in words rather than raw enum values', () => {
    render(<ConnectionStateBadge state="RECONNECTING" />);
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  it('falls back to the raw state for values it does not recognise', () => {
    render(<ConnectionStateBadge state="SOMETHING_NEW" />);
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });
});
