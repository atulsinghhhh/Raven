'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DashboardRealtimeTransport,
  type DashboardRealtimeSocketFactory,
  TOKEN_EXPIRED_CLOSE_CODE,
} from './dashboard-realtime-transport';
import { useDashboardRealtimeContext } from './dashboard-realtime-context';
import { toast } from '../toast';

export type DashboardRealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export interface UseDashboardRealtimeResult {
  status: DashboardRealtimeStatus;
}

interface UseDashboardRealtimeOptions {
  /**
   * Called for every frame the gateway sends, including the transport's
   * own `connected`/`pong`/`error` frames — a page decides what it cares
   * about by switching on `frame.type` (e.g. `connection.state_changed`,
   * `room.created`; see apps/api's dashboard-ws-events.ts). This hook
   * stays a thin transport: it never interprets a product event itself.
   */
  onEvent?: (frame: Record<string, unknown>) => void;
  /**
   * Called when the socket re-opens after having been open before — never
   * on the very first connect. This is the hook's half of Phase 5A's
   * "missed events" answer: there is no replay, so a page that wants to
   * catch up after a drop refetches its REST snapshot here.
   */
  onReconnected?: () => void;
  /** Test-only seam for a fake socket. Never set in application code. */
  socketFactory?: DashboardRealtimeSocketFactory;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 15_000;

interface MintedToken {
  token: string;
  wsUrl: string;
}

async function mintToken(projectId: string, signal: AbortSignal): Promise<MintedToken> {
  const res = await fetch(`/api/projects/${projectId}/dashboard-ws-token`, { method: 'POST', signal });
  if (!res.ok) {
    throw new Error(`dashboard-ws-token mint failed: ${res.status}`);
  }
  const body = (await res.json()) as { token: string; wsUrl: string };
  return { token: body.token, wsUrl: body.wsUrl };
}

/**
 * The dashboard realtime transport foundation (Phase 5B). Connects to
 * DashboardWsGateway (`/v1/dashboard/ws`) scoped to exactly `projectId`,
 * with reconnect/backoff/jitter and a heartbeat proving the connection is
 * alive. Carries no product event yet — `status` is the entire surface.
 *
 * Deliberately NOT part of ProjectProvider (see lib/project-context.tsx):
 * that context is identity/capabilities only, resolved once per
 * server-rendered navigation. This hook owns genuinely ephemeral,
 * client-only state that would have no server-rendered equivalent, so it
 * stays in its own layer. A future phase wiring an actual realtime
 * *feature* mounts this hook (or a thin wrapper around it) in the
 * specific client component that needs it — this file is the transport,
 * not a place to accumulate product state.
 */
export function useDashboardRealtime(projectId: string, options: UseDashboardRealtimeOptions = {}): UseDashboardRealtimeResult {
  const [status, setStatus] = useState<DashboardRealtimeStatus>('connecting');
  const { socketFactory } = options;

  // A DashboardRealtimeProvider ancestor (mounted once per AppShell) already
  // owns the one real connection for this project — every list/detail page
  // that also calls this hook (Connections, Rooms, Streams, Stream Detail,
  // Webhooks, alongside NotificationsBell) would otherwise each mint their
  // own token and open their own socket to the same gateway for the same
  // project. `shared` is null only when no such provider is mounted above —
  // which is also exactly the case in every existing unit test for this
  // hook and its callers, so their standalone-connection behavior is
  // unchanged.
  const shared = useDashboardRealtimeContext();

  // Always-latest refs for the two callbacks, so a caller passing a new
  // inline function every render doesn't force this effect to tear down
  // and reopen the socket — only `projectId` does that. Updated after
  // every render (not during it), same reasoning as avoiding a direct
  // setState call in an effect body: a ref write belongs in an effect,
  // not render itself.
  const onEventRef = useRef(options.onEvent);
  const onReconnectedRef = useRef(options.onReconnected);
  useEffect(() => {
    onEventRef.current = options.onEvent;
    onReconnectedRef.current = options.onReconnected;
  });

  // Shared-connection path: register against the provider's one socket
  // instead of opening a second. Reads through the refs above, so it only
  // needs to (re)subscribe when the shared connection itself changes.
  useEffect(() => {
    if (!shared) return;
    return shared.subscribe(
      (frame) => onEventRef.current?.(frame),
      () => onReconnectedRef.current?.(),
    );
  }, [shared]);

  useEffect(() => {
    // The provider above already has a real connection open — this effect
    // is what opens one, so there is nothing left for it to do.
    if (shared) return;

    let cancelled = false;
    let transport: DashboardRealtimeTransport | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let hasConnectedBefore = false;
    const mintController = new AbortController();

    function clearHeartbeat() {
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    }

    async function refreshAndSetToken(): Promise<void> {
      try {
        const minted = await mintToken(projectId, mintController.signal);
        if (!cancelled) transport?.setToken(minted.token);
      } catch {
        // The transport's own reconnect timer still fires with the stale
        // token; the gateway rejects it and the normal terminal/backoff
        // path takes over from there. Never worse than not refreshing.
      }
    }

    async function start() {
      // Reset to 'connecting' for this effect run (a fresh projectId, or
      // the initial mount). Done here rather than as a direct statement in
      // the effect body: a setState call sitting synchronously in an
      // effect body triggers cascading renders and the
      // react-hooks/set-state-in-effect lint rule; nesting it one function
      // deeper avoids that while keeping the same observable timing —
      // `start()` still runs synchronously up to its first `await`.
      if (!cancelled) setStatus('connecting');

      let minted: MintedToken;
      try {
        minted = await mintToken(projectId, mintController.signal);
      } catch {
        if (!cancelled) setStatus('failed');
        return;
      }
      if (cancelled) return;

      transport = new DashboardRealtimeTransport(
        {
          wsUrl: minted.wsUrl,
          token: minted.token,
          maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
          initialReconnectDelayMs: INITIAL_RECONNECT_DELAY_MS,
          maxReconnectDelayMs: MAX_RECONNECT_DELAY_MS,
          socketFactory,
        },
        {
          onOpen: () => {
            if (cancelled) return;
            setStatus('open');
            // The first open is the initial connect — there is nothing to
            // catch up on. Every open after that followed a drop, and
            // Phase 5A's model has no replay: refetching REST here is the
            // entire "missed events" story.
            if (hasConnectedBefore) {
              onReconnectedRef.current?.();
            }
            hasConnectedBefore = true;
          },
          onFrame: (frame) => {
            // The handshake tells us how often to send an
            // application-level ping — transport plumbing, handled here
            // regardless of whether a consumer is listening.
            if (frame.type === 'connected' && typeof frame.heartbeatIntervalMs === 'number') {
              clearHeartbeat();
              heartbeatTimer = setInterval(() => transport?.send({ type: 'ping' }), frame.heartbeatIntervalMs);
            }
            onEventRef.current?.(frame);
          },
          onReconnecting: () => {
            if (!cancelled) setStatus('reconnecting');
          },
          onClose: (info) => {
            clearHeartbeat();
            if (cancelled) return;
            if (info.terminal) {
              setStatus('failed');
              return;
            }
            if (!info.willReconnect) {
              setStatus('closed');
              return;
            }
            // Recoverable, and a reconnect is already scheduled. A token
            // expiry needs a fresh credential before that reconnect lands,
            // or the gateway rejects it again for the same reason.
            if (info.code === TOKEN_EXPIRED_CLOSE_CODE) {
              void refreshAndSetToken();
            }
          },
          onError: () => {
            // Surfaced via `status`, not a separate error channel: Phase
            // 5B has no UI consuming this yet, and status already
            // distinguishes reconnecting/closed/failed.
          },
        },
      );
      transport.connect();
    }

    void start();

    return () => {
      cancelled = true;
      mintController.abort();
      clearHeartbeat();
      transport?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- socketFactory is a test-only seam, stable in application code
  }, [projectId, shared]);

  // No page reads `status` today (it exists for a future indicator), so
  // "reconnecting" — the common, self-healing case — stays silent to avoid
  // toast spam on a flaky connection. Only the terminal state is worth
  // interrupting the user for: reconnect attempts are exhausted or the
  // gateway closed for a reason retrying won't fix, and live updates on
  // this page have stopped until they reload.
  // Local `status` only — when `shared` is set this component never calls
  // its own setStatus, so this never fires from a subscribing instance.
  // The provider's own internal call (where `shared` is null) is the one
  // and only instance that toasts, instead of every subscriber doing it
  // in unison the moment the one real connection fails.
  useEffect(() => {
    if (status === 'failed') {
      toast.warning('Live updates disconnected. Reload the page to reconnect.');
      // One line, only on this terminal/rare path — not a general client
      // logging system (Phase 6H explicitly rules that out). The toast is
      // the user-facing signal; this is the one thing a developer looking
      // at devtools during a support session has to go on, since nothing
      // else about a WS connection is ever otherwise logged client-side.
      // No token, no wsUrl (query-string-embedded credential) — project id
      // only, which is already visible in the page's own URL.
      console.warn(`[dashboard-realtime] connection failed for project ${projectId} — see the toast for the user-facing message`);
    }
  }, [status, projectId]);

  return { status: shared ? shared.status : status };
}
