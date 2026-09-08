/**
 * Status is never conveyed by colour alone: every badge and indicator
 * here pairs its colour with a distinct glyph and a text label, so it
 * still reads correctly in greyscale or with a colour-vision deficiency.
 *
 * Badges are 4px rectangles, not pills. The status dot inside
 * each one is still round, which is the point: the round thing is the
 * indicator, not the container.
 */

// Legacy tone names kept alongside semantic ones so older call sites keep
// working; new code should prefer the semantic names.
export type BadgeTone =
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'accent'
  | 'live'
  | 'green'
  | 'red'
  | 'yellow'
  | 'gray';

const TONE: Record<BadgeTone, string> = {
  success: 'bg-success-subtle text-success-text border-success-line',
  green: 'bg-success-subtle text-success-text border-success-line',
  live: 'bg-live-subtle text-live-text border-live-line',
  danger: 'bg-danger-subtle text-danger-text border-danger-line',
  red: 'bg-danger-subtle text-danger-text border-danger-line',
  warning: 'bg-warning-subtle text-warning-text border-warning-line',
  yellow: 'bg-warning-subtle text-warning-text border-warning-line',
  info: 'bg-info-subtle text-info-text border-info-line',
  accent: 'bg-accent-subtle text-accent-text border-accent-line',
  neutral: 'bg-surface-sunken text-muted border-line',
  gray: 'bg-surface-sunken text-muted border-line',
};

const GLYPH: Record<BadgeTone, string> = {
  success: '●',
  green: '●',
  live: '●',
  danger: '✕',
  red: '✕',
  warning: '▲',
  yellow: '▲',
  info: '●',
  accent: '●',
  neutral: '○',
  gray: '○',
};

export function Badge({
  tone = 'neutral',
  children,
  glyph = true,
  className = '',
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  glyph?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {glyph && (
        <span aria-hidden="true" className="text-[0.6rem] leading-none">
          {GLYPH[tone]}
        </span>
      )}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: 'up' | 'down' | 'unknown' }) {
  if (status === 'up') return <Badge tone="success">Healthy</Badge>;
  if (status === 'down') return <Badge tone="danger">Down</Badge>;
  return <Badge tone="neutral">Unknown</Badge>;
}

export type SystemStatus = 'operational' | 'degraded' | 'partial_outage' | 'unavailable' | 'unknown';

const SYSTEM_STATUS: Record<SystemStatus, { label: string; tone: BadgeTone; dot: string }> = {
  operational: { label: 'Operational', tone: 'success', dot: 'bg-success' },
  degraded: { label: 'Degraded', tone: 'warning', dot: 'bg-warning' },
  partial_outage: { label: 'Partial outage', tone: 'danger', dot: 'bg-danger' },
  unavailable: { label: 'Unavailable', tone: 'danger', dot: 'bg-danger' },
  unknown: { label: 'Status unknown', tone: 'neutral', dot: 'bg-subtle' },
};

/**
 * Compact infra health pill for the top bar. The dot only pulses while
 * something is actually wrong: a permanently animating indicator is
 * noise, and stops reading as a signal.
 */
export function SystemStatusIndicator({ status, className = '' }: { status: SystemStatus; className?: string }) {
  const meta = SYSTEM_STATUS[status];
  const alive = status !== 'operational' && status !== 'unknown';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-sm border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted ${className}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot} ${alive ? 'animate-pulse-dot' : ''}`} aria-hidden="true" />
      <span className="sr-only">System status: </span>
      {meta.label}
    </span>
  );
}

/** Derives one headline status from the individual dependency checks. */
export function deriveSystemStatus(deps: Record<string, 'up' | 'down'> | undefined): SystemStatus {
  if (!deps) return 'unknown';
  const values = Object.values(deps);
  if (values.length === 0) return 'unknown';
  const down = values.filter((v) => v === 'down').length;
  if (down === 0) return 'operational';
  if (down === values.length) return 'unavailable';
  // More than one dependency down is an outage, not just degradation.
  return down > 1 ? 'partial_outage' : 'degraded';
}

const CONNECTION_STATE: Record<string, { tone: BadgeTone; label: string }> = {
  CONNECTED: { tone: 'success', label: 'Connected' },
  CONNECTING: { tone: 'warning', label: 'Connecting' },
  RECONNECTING: { tone: 'warning', label: 'Reconnecting' },
  DISCONNECTED: { tone: 'neutral', label: 'Disconnected' },
  FAILED: { tone: 'danger', label: 'Failed' },
};

export function ConnectionStateBadge({ state }: { state: string }) {
  const meta = CONNECTION_STATE[state] ?? { tone: 'neutral' as BadgeTone, label: state };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const CONNECTION_QUALITY: Record<string, { tone: BadgeTone; label: string }> = {
  excellent: { tone: 'success', label: 'Excellent' },
  good: { tone: 'success', label: 'Good' },
  poor: { tone: 'warning', label: 'Poor' },
  lost: { tone: 'danger', label: 'Lost' },
  unknown: { tone: 'neutral', label: 'Unknown' },
};

/**
 * The SFU's own read on a connection's media quality: see
 * `ConnectionQuality` in `@corvidhq/rtc`. `null` (no stats sample received
 * yet) renders nothing rather than a misleading "Unknown" badge, since
 * `'unknown'` is itself a value the SFU can report.
 */
export function ConnectionQualityBadge({ quality }: { quality: string | null }) {
  if (quality === null) return null;
  const meta = CONNECTION_QUALITY[quality] ?? { tone: 'neutral' as BadgeTone, label: quality };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * Error categories are all failures, but they don't all mean the same
 * thing: auth/token problems are the developer's own misconfiguration,
 * network/ICE/TURN ones are usually environmental.
 */
const ERROR_CATEGORY_TONE: Record<string, BadgeTone> = {
  AUTHENTICATION_ERROR: 'danger',
  AUTHORIZATION_ERROR: 'danger',
  TOKEN_ERROR: 'danger',
  SIGNALING_ERROR: 'warning',
  ICE_ERROR: 'warning',
  TURN_ERROR: 'warning',
  SFU_ERROR: 'warning',
  NETWORK_ERROR: 'info',
  CLIENT_ERROR: 'info',
  UNKNOWN_ERROR: 'neutral',
};

export function ErrorCategoryBadge({ category }: { category: string }) {
  return (
    <Badge tone={ERROR_CATEGORY_TONE[category] ?? 'neutral'}>
      <span className="font-mono text-[0.6875rem]">{category.replace(/_/g, ' ').toLowerCase()}</span>
    </Badge>
  );
}
