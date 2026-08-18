import {
  createRTCClient,
  type ConnectionState,
  type LocalParticipant,
  type RemoteParticipant,
  type Room,
  type RTCClient,
  type RTCClientConfig,
  type RTCError,
} from '@raven/rtc';

/** `'idle'` = `join()` hasn't been called yet — distinct from `'disconnected'`, which means a real connection ended. */
export type RavenConnectionState = ConnectionState | 'idle';

export interface RavenSnapshot {
  connectionState: RavenConnectionState;
  client?: RTCClient;
  room?: Room;
  localParticipant?: LocalParticipant;
  remoteParticipants: RemoteParticipant[];
  error?: RTCError;
  reconnectCount: number;
}

const INITIAL_SNAPSHOT: RavenSnapshot = {
  connectionState: 'idle',
  remoteParticipants: [],
  reconnectCount: 0,
};

/**
 * Owns one `RTCClient`/`Room` pair and exposes it as an immutable
 * snapshot, compatible with `useSyncExternalStore` (Phase 11 spec §30 —
 * "avoid unnecessary rerenders"). Every hook in this package reads from
 * an instance of this via context, each selecting only the slice it
 * needs so a change to (say) `remoteParticipants` never re-renders a
 * component that only reads `connectionState`.
 *
 * All the actual RTC logic still lives in `@raven/rtc` — this class only
 * translates its event stream into React-friendly, referentially-stable
 * snapshots. It never touches LiveKit.
 */
export class RavenStore {
  private snapshot: RavenSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private roomUnsubscribers: Array<() => void> = [];
  private client?: RTCClient;

  getSnapshot = (): RavenSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private patch(partial: Partial<RavenSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  init(config: RTCClientConfig): void {
    this.client = createRTCClient(config);
    this.patch({ client: this.client });
  }

  async join(roomId: string): Promise<void> {
    if (!this.client) {
      throw new Error('RavenStore.init() must be called before join()');
    }
    this.patch({ connectionState: 'connecting', error: undefined });
    try {
      const room = await this.client.join(roomId);
      this.attachRoom(room);
    } catch (error) {
      this.patch({ connectionState: 'failed', error: error as RTCError });
      throw error;
    }
  }

  async leave(): Promise<void> {
    await this.client?.leave();
    this.detachRoom();
    this.patch({ ...INITIAL_SNAPSHOT, connectionState: 'disconnected', client: this.client });
  }

  /** Unsubscribes from room events and stops the underlying client — call on unmount. */
  dispose(): void {
    this.detachRoom();
    void this.client?.leave();
  }

  private attachRoom(room: Room): void {
    this.detachRoom();

    const onState = (state: ConnectionState) => this.patch({ connectionState: state });
    const onReconnecting = () => this.patch({ reconnectCount: this.snapshot.reconnectCount + 1 });
    const onError = (error: RTCError) => this.patch({ error });
    const onParticipantsChanged = () => this.syncParticipants(room);

    room.on('connectionStateChanged', onState);
    room.on('reconnecting', onReconnecting);
    room.on('error', onError);
    room.on('participantJoined', onParticipantsChanged);
    room.on('participantLeft', onParticipantsChanged);
    room.on('trackSubscribed', onParticipantsChanged);
    room.on('trackUnsubscribed', onParticipantsChanged);
    room.on('trackMuted', onParticipantsChanged);
    room.on('trackUnmuted', onParticipantsChanged);
    room.on('localTrackPublished', onParticipantsChanged);
    room.on('localTrackUnpublished', onParticipantsChanged);

    this.roomUnsubscribers = [
      () => room.off('connectionStateChanged', onState),
      () => room.off('reconnecting', onReconnecting),
      () => room.off('error', onError),
      () => room.off('participantJoined', onParticipantsChanged),
      () => room.off('participantLeft', onParticipantsChanged),
      () => room.off('trackSubscribed', onParticipantsChanged),
      () => room.off('trackUnsubscribed', onParticipantsChanged),
      () => room.off('trackMuted', onParticipantsChanged),
      () => room.off('trackUnmuted', onParticipantsChanged),
      () => room.off('localTrackPublished', onParticipantsChanged),
      () => room.off('localTrackUnpublished', onParticipantsChanged),
    ];

    this.patch({
      room,
      connectionState: room.connectionState,
      localParticipant: room.localParticipant,
      remoteParticipants: [...room.remoteParticipants],
    });
  }

  private syncParticipants(room: Room): void {
    // New array/object references each time, on purpose — this is what
    // gives useSyncExternalStore something to Object.is-compare against.
    this.patch({ remoteParticipants: [...room.remoteParticipants], localParticipant: room.localParticipant });
  }

  private detachRoom(): void {
    for (const unsubscribe of this.roomUnsubscribers) unsubscribe();
    this.roomUnsubscribers = [];
  }
}
