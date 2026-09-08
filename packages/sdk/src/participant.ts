import type { LocalTrack, RemoteTrack } from './track';

/** Fields the local user and remote participants have in common. */
export abstract class Participant {
  private _identity: string;
  /** Opaque application metadata set when the RTC token was minted. */
  readonly metadata?: string;

  constructor(identity: string, metadata?: string) {
    this._identity = identity;
    this.metadata = metadata;
  }

  /** The RTC token's participant identity. Stable for the whole session. */
  get identity(): string {
    return this._identity;
  }

  /**
   * @internal Called once by the SFU adapter just after connect() resolves.
   * The constructor runs before the server has confirmed identity, so this
   * patches it in afterwards.
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
