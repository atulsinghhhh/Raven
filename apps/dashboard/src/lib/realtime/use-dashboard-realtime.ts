'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DashboardRealtimeTransport,
  type DashboardRealtimeSocketFactory,
  TOKEN_EXPIRED_CLOSE_CODE,
} from './dashboard-realtime-transport';
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

  useEffect(() => {
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
  }, [projectId]);

  // No page reads `status` today (it exists for a future indicator), so
  // "reconnecting" — the common, self-healing case — stays silent to avoid
  // toast spam on a flaky connection. Only the terminal state is worth
  // interrupting the user for: reconnect attempts are exhausted or the
  // gateway closed for a reason retrying won't fix, and live updates on
  // this page have stopped until they reload.
  useEffect(() => {
    if (status === 'failed') {
      toast.warning('Live updates disconnected. Reload the page to reconnect.');
    }
  }, [status]);

  return { status };
}
