import type { LocalTrack, RemoteTrack } from './track';

/** Common fields shared by the local user and remote participants. */
export abstract class Participant {
  private _identity: string;
  /** Opaque application metadata set when the RTC token was minted. */
  readonly metadata?: string;

  constructor(identity: string, metadata?: string) {
    this._identity = identity;
    this.metadata = metadata;
  }

  /** The RTC token's participant identity — stable for the session's duration. */
  get identity(): string {
    return this._identity;
  }

  /**
   * @internal Only the SFU adapter calls this, once, right after connect()
   * resolves — the local participant's identity isn't known until the
   * server confirms it, but the constructor runs before that.
   */
  _setIdentity(identity: string): void {
    this._identity = identity;
  }
}

export class LocalParticipant extends Participant {
  /** Tracks this participant has published, in publish order. Mutated by Room. */
  readonly tracks: LocalTrack[] = [];
}

export class RemoteParticipant extends Participant {
  /** Tracks subscribed from this participant, in subscribe order. Mutated by Room. */
  readonly tracks: RemoteTrack[] = [];
}
