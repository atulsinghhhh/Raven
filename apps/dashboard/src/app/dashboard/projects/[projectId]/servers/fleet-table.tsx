'use client';

import { useState, useSyncExternalStore } from 'react';
import type { RtcServer, RtcServerStatus } from '@/lib/api-client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, NoDataYet } from '@/components/ui/states';
import {
  MobileField,
  MobileList,
  MobileRow,
  Table,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/table';
import { formatBitrate, formatCount, formatPercent, formatRelative } from '@/lib/format';

const STATUS_TONE: Record<RtcServerStatus, BadgeTone> = {
  HEALTHY: 'success',
  DRAINING: 'warning',
  UNHEALTHY: 'danger',
};

const STATUS_LABEL: Record<RtcServerStatus, string> = {
  HEALTHY: 'Healthy',
  DRAINING: 'Draining',
  UNHEALTHY: 'Unhealthy',
};

/**
 * The fleet, with the one operator action the Control API backs.
 *
 * # Why this is a client component when Rooms is not
 *
 * Draining is the only mutation in the RTC section, and it is the action
 * you want during an incident: it takes a node out of the allocation pool
 * *without* ending the calls already on it. A full page navigation per
 * click would make a rolling drain across a fleet needlessly slow, so the
 * row updates in place from the response.
 *
 * # What the numbers are, and are not
 *
 * Every load figure here is a snapshot from the node's **last heartbeat**,
 * not a live reading. That is why `lastHeartbeatAt` sits next to them
 * rather than in a details panel: `0 rooms` from a node that last spoke
 * four minutes ago means something different from `0 rooms` reported two
 * seconds ago, and putting them side by side is what makes the difference
 * visible. A node that reported no CPU figure renders as " ", never as 0%.
 */
export function FleetTable({ initialServers }: { initialServers: RtcServer[] }) {
  const [servers, setServers] = useState(initialServers);
  const [pendingName, setPendingName] = useState<string>();
  const [error, setError] = useState<string>();
  const now = useNow();

  async function setDraining(server: RtcServer, draining: boolean) {
    setPendingName(server.name);
    setError(undefined);
    try {
      const res = await fetch(`/api/rtc/servers/${encodeURIComponent(server.name)}/drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sent explicitly rather than as a toggle, so two operators on
        // stale pages cannot flip a node back and forth by each clicking
        // what they think is the opposite action.
        body: JSON.stringify({ draining }),
      });
      const payload = await res.json().catch(() => undefined);
      if (!res.ok) {
        setError(payload?.message ?? 'Could not change this node’s status.');
        return;
      }
      setServers((current) => current.map((s) => (s.name === server.name ? (payload as RtcServer) : s)));
    } catch {
      setError('Could not reach the Control API.');
    } finally {
      setPendingName(undefined);
    }
  }

  return (
    <>
      {error && (
        <div className="mb-4">
          <ErrorState title="Action failed" description={error} />
        </div>
      )}

      {/* Desktop: a real table. Below sm the same records render as cards. */}
      <div className="hidden sm:block">
        <TableWrap>
          <Table>
            <THead>
              <TH>Node</TH>
              <TH>Region</TH>
              <TH>Status</TH>
              <TH align="right">Rooms</TH>
              <TH align="right">Participants</TH>
              <TH align="right">CPU</TH>
              <TH align="right">Memory</TH>
              <TH>Last heartbeat</TH>
              <TH>Version</TH>
              <TH align="right">Allocation</TH>
            </THead>
            <TBody>
              {servers.map((server) => (
                <TR key={server.id}>
                  <TD>
                    <span className="font-mono text-xs text-fg">{server.name}</span>
                  </TD>
                  <TD>
                    <span className="text-muted">{server.region}</span>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[server.status]}>{STATUS_LABEL[server.status]}</Badge>
                  </TD>
                  <TD align="right">
                    <span className="tabular text-fg">
                      {formatCount(server.activeRooms)}
                      <span className="text-subtle"> / {formatCount(server.capacity)}</span>
                    </span>
                  </TD>
                  <TD align="right">
                    <span className="tabular text-muted">{formatCount(server.activeParticipants)}</span>
                  </TD>
                  <TD align="right">
                    <Reported value={formatPercent(server.cpuPercent)} />
                  </TD>
                  <TD align="right">
                    <Reported value={formatPercent(server.memoryPercent)} />
                  </TD>
                  <TD>
                    <Heartbeat at={server.lastHeartbeatAt} now={now} />
                  </TD>
                  <TD>
                    <span className="font-mono text-xs text-muted">{server.version ?? '—'}</span>
                  </TD>
                  <TD align="right">
                    <DrainButton
                      server={server}
                      pending={pendingName === server.name}
                      onChange={setDraining}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      <div className="sm:hidden">
        <MobileList>
          {servers.map((server) => (
            <MobileRow key={server.id}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-xs font-medium text-fg">{server.name}</span>
                <Badge tone={STATUS_TONE[server.status]}>{STATUS_LABEL[server.status]}</Badge>
              </div>
              <MobileField label="Region">{server.region}</MobileField>
              <MobileField label="Rooms">
                <span className="tabular">
                  {formatCount(server.activeRooms)} / {formatCount(server.capacity)}
                </span>
              </MobileField>
              <MobileField label="Participants">
                <span className="tabular">{formatCount(server.activeParticipants)}</span>
              </MobileField>
              <MobileField label="CPU">
                <Reported value={formatPercent(server.cpuPercent)} />
              </MobileField>
              <MobileField label="Network out">
                <Reported value={formatBitrate(server.networkOutBps)} />
              </MobileField>
              <MobileField label="Last heartbeat">
                <Heartbeat at={server.lastHeartbeatAt} now={now} />
              </MobileField>
              <div className="mt-3">
                <DrainButton server={server} pending={pendingName === server.name} onChange={setDraining} />
              </div>
            </MobileRow>
          ))}
        </MobileList>
      </div>
    </>
  );
}

/**
 * A figure the node chose not to report renders as an em dash.
 *
 * Not zero: "this node did not tell us its CPU" and "this node is idle"
 * are different facts, and an operator reading a dashboard during an
 * incident must not have to guess which one they are looking at.
 */
function Reported({ value }: { value: string | null }) {
  if (value === null) return <span className="text-subtle">—</span>;
  return <span className="tabular text-muted">{value}</span>;
}

/**
 * A five-second clock, as an external store instead of an effect.
 *
 * `useSyncExternalStore` is the right primitive here and not merely the
 * one that satisfies the lint rule: the current time is genuinely an
 * external mutable source, and this is how React subscribes to one. It
 * also gives the server snapshot for free, `0`, meaning "unknown", so
 * the server HTML and the first client render agree and nothing hydrates
 * mismatched. Reading `Date.now()` during render would put a different
 * string in each, and for a *heartbeat age* that difference is exactly
 * however long the page took to reach the browser.
 *
 * Ticking is not decoration: an operator watching a node they just
 * drained needs to see whether it is still reporting, and a frozen
 * "12s ago" cannot tell them.
 */
let clockTick = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeToClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  if (!clockTimer) {
    // Set before the first interval fires so the very next snapshot read
    //, which React performs right after subscribing, already has a real
    // time in it, rather than waiting five seconds for one.
    clockTick = Date.now();
    clockTimer = setInterval(() => {
      clockTick = Date.now();
      for (const listener of clockListeners) listener();
    }, 5_000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/** Cached rather than freshly computed: an ever-changing snapshot would re-render forever. */
const readClock = () => clockTick;
const readClockOnServer = () => 0;

function useNow(): number | undefined {
  const tick = useSyncExternalStore(subscribeToClock, readClock, readClockOnServer);
  return tick === 0 ? undefined : tick;
}

/**
 * How long ago the node last spoke, toned by whether that is a problem.
 *
 * The 30-second threshold matches `SFU_HEARTBEAT_TIMEOUT_SECONDS`'s
 * default: past it, the control plane's own sweep will mark the node
 * unhealthy, so a row that looks stale here is about to be one.
 *
 * Untoned until the clock starts, instead of assumed fresh: a warning
 * that appears a moment after load is honest, one that appears and then
 * disappears is not.
 */
function Heartbeat({ at, now }: { at: string | null; now: number | undefined }) {
  if (!at) return <NoDataYet label="Never" />;
  const stale = now !== undefined && now - new Date(at).getTime() > 30_000;
  return (
    <span className={`tabular text-xs ${stale ? 'text-warning-text' : 'text-muted'}`}>
      {formatRelative(at, now)}
    </span>
  );
}

function DrainButton({
  server,
  pending,
  onChange,
}: {
  server: RtcServer;
  pending: boolean;
  onChange: (server: RtcServer, draining: boolean) => void;
}) {
  // An unhealthy node is already out of the pool because it stopped
  // answering, so draining it changes nothing an operator would notice
  // and un-draining it would be a claim the control plane will overwrite
  // on its next sweep.
  if (server.status === 'UNHEALTHY') {
    return <span className="text-xs text-subtle">Not answering</span>;
  }

  const draining = server.status === 'DRAINING';
  return (
    <Button
      size="sm"
      variant={draining ? 'secondary' : 'ghost'}
      loading={pending}
      onClick={() => onChange(server, !draining)}
      title={
        draining
          ? 'Return this node to the allocation pool'
          : `Stop allocating new rooms here. The ${formatCount(server.activeRooms)} room(s) already on this node keep running.`
      }
    >
      {draining ? 'Resume' : 'Drain'}
    </Button>
  );
}
