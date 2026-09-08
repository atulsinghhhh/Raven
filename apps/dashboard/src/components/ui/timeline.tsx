import { formatClockTime, formatDateTime } from '@/lib/format';

/**
 * Connection event timeline. The vocabulary is fixed by the ingest
 * endpoint (see observability.constants.ts on the API side), so events
 * get real labels, not the raw snake_case type, but anything
 * unrecognised still renders, humanised, instead of being dropped.
 */
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const EVENT_META: Record<string, { label: string; tone: Tone }> = {
  connection_started: { label: 'Connection started', tone: 'accent' },
  connected: { label: 'Connected', tone: 'success' },
  reconnecting: { label: 'Reconnecting', tone: 'warning' },
  reconnected: { label: 'Reconnected', tone: 'success' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  connection_failed: { label: 'Connection failed', tone: 'danger' },
  ice_state_changed: { label: 'ICE state changed', tone: 'neutral' },
  signaling_state_changed: { label: 'Signaling state changed', tone: 'neutral' },
  participant_joined: { label: 'Participant joined', tone: 'accent' },
  participant_left: { label: 'Participant left', tone: 'neutral' },
  participant_reconnected: { label: 'Participant reconnected', tone: 'success' },
  participant_connection_failed: { label: 'Participant connection failed', tone: 'danger' },
  participant_connection_quality_changed: { label: 'Connection quality changed', tone: 'warning' },
  track_published: { label: 'Track published', tone: 'accent' },
  track_unpublished: { label: 'Track unpublished', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-surface border-line-strong',
  success: 'bg-success-subtle border-success',
  warning: 'bg-warning-subtle border-warning',
  danger: 'bg-danger-subtle border-danger',
  accent: 'bg-accent-subtle border-accent',
};

export interface TimelineEvent {
  id: string;
  type: string;
  timestamp: string;
  data?: Record<string, unknown> | null;
}

function humanise(type: string): string {
  return type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Renders the event's payload as compact key=value pairs, skipping empties. */
function DataPairs({ data }: { data: Record<string, unknown> }) {
  const pairs = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (pairs.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {pairs.map(([k, v]) => (
        <span key={k} className="font-mono text-[0.6875rem] text-subtle">
          {k}=<span className="text-muted">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </span>
      ))}
    </div>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative flex flex-col">
      {events.map((event, i) => {
        const meta = EVENT_META[event.type] ?? { label: humanise(event.type), tone: 'neutral' as Tone };
        const isLast = i === events.length - 1;

        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast && <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px bg-line" />}
            <span
              aria-hidden="true"
              className={`relative z-10 mt-1.5 size-[11px] shrink-0 rounded-full border-2 ${DOT[meta.tone]}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-fg">{meta.label}</span>
                <time
                  dateTime={event.timestamp}
                  className="tabular shrink-0 font-mono text-[0.6875rem] text-subtle"
                  title={formatDateTime(event.timestamp)}
                >
                  {formatClockTime(event.timestamp)}
                </time>
              </div>
              {event.data && <DataPairs data={event.data} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
