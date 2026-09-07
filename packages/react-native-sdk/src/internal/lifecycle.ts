import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

export type RavenAppState = 'active' | 'background' | 'inactive';

export interface LifecycleHandlers {
  onForeground(): void;
  onBackground(): void;
  /** iOS only — a transient state during a phone call, Control Centre, or the app switcher. */
  onInactive?(): void;
}

/**
 * Watches the OS app lifecycle so the SDK can react to a call being
 * backgrounded.
 *
 * What this deliberately does *not* do is tear the connection down when
 * the app goes to the background. On both platforms a backgrounded app
 * with an active audio session keeps running, and dropping the socket
 * would turn "switched to Messages for four seconds" into "left the
 * meeting". Video capture is what actually stops — iOS suspends the
 * camera, and Android does the same without a foreground service — so the
 * useful thing to do on return is re-check state, not reconnect.
 *
 * Anything stronger than that belongs to the app, not the SDK: whether a
 * backgrounded user should stay in the room is a product decision, and
 * making it here would take it away from the developer.
 */
export class LifecycleWatcher {
  private subscription?: NativeEventSubscription;
  private current: AppStateStatus = AppState.currentState;

  constructor(private readonly handlers: LifecycleHandlers) {}

  start(): void {
    if (this.subscription) {
      return;
    }
    this.subscription = AppState.addEventListener('change', this.handleChange);
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = undefined;
  }

  get state(): RavenAppState {
    return normalize(this.current);
  }

  private handleChange = (next: AppStateStatus): void => {
    const previous = normalize(this.current);
    const upcoming = normalize(next);
    this.current = next;

    if (previous === upcoming) {
      return;
    }

    if (upcoming === 'active') {
      this.handlers.onForeground();
      return;
    }
    if (upcoming === 'background') {
      this.handlers.onBackground();
      return;
    }
    this.handlers.onInactive?.();
  };
}

function normalize(status: AppStateStatus): RavenAppState {
  if (status === 'active') return 'active';
  // iOS reports 'inactive' during a call or the app switcher; Android
  // never does. Everything else ('extension', 'unknown') is treated as
  // backgrounded, which is the conservative reading.
  if (status === 'inactive') return 'inactive';
  return 'background';
}

/**
 * Watches connectivity so a Wi-Fi → cellular handover can be turned into
 * a deliberate reconnect rather than a slow timeout.
 *
 * `@react-native-community/netinfo` is an *optional* peer dependency. It's
 * the standard way to observe connectivity in React Native, but it is
 * another native module to link, and Raven works without it — ICE
 * eventually notices a dead path on its own. Having it just makes
 * recovery faster, so this resolves it lazily and degrades to a no-op
 * when it isn't installed.
 */
export class NetworkWatcher {
  private unsubscribe?: () => void;
  private lastReachable = true;

  constructor(private readonly onReconnected: () => void) {}

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    const netInfo = loadNetInfo();
    if (!netInfo) {
      return;
    }

    this.unsubscribe = netInfo.addEventListener((state) => {
      const reachable = state.isConnected !== false;
      const regained = reachable && !this.lastReachable;
      this.lastReachable = reachable;

      // Only fire on the transition back to connectivity. Firing on every
      // NetInfo event would reconnect on a signal-strength change.
      if (regained) {
        this.onReconnected();
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** True when connectivity observation is actually available. */
  get isObserving(): boolean {
    return this.unsubscribe !== undefined;
  }
}

interface NetInfoLike {
  addEventListener(listener: (state: { isConnected: boolean | null }) => void): () => void;
}

function loadNetInfo(): NetInfoLike | undefined {
  try {
    // Resolved at runtime on purpose: a static import would make an
    // optional peer dependency mandatory at bundle time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo');
    const candidate = (mod?.default ?? mod) as NetInfoLike | undefined;
    return typeof candidate?.addEventListener === 'function' ? candidate : undefined;
  } catch {
    return undefined;
  }
}
