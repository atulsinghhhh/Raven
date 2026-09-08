import type { RavenHttpClient } from '../http-client';
import type { LiveParticipantInfo, Room } from '../types';

/**
 * Rooms are control-plane records, not persistent infrastructure. So
 * `delete()` closes a room, a soft-close setting status to CLOSED, rather
 * than destroying history. Matches what the API actually does (Phase 10
 * spec §18).
 */
export class RoomsResource {
  readonly participants: RoomParticipantsResource;

  constructor(private readonly http: RavenHttpClient) {
    this.participants = new RoomParticipantsResource(http);
  }

  list(): Promise<Room[]> {
    return this.http.request<Room[]>('/v1/rooms');
  }

  get(roomId: string): Promise<Room> {
    return this.http.request<Room>(`/v1/rooms/${roomId}`);
  }

  create(params: { name: string }): Promise<Room> {
    return this.http.request<Room>('/v1/rooms', { method: 'POST', body: params });
  }

  /** Soft-closes the room, setting status to CLOSED. Never a hard delete. */
  delete(roomId: string): Promise<void> {
    return this.http.request<void>(`/v1/rooms/${roomId}`, { method: 'DELETE' });
  }
}

/**
 * Real join/leave participant *history* isn't wired up in the Control API
 * yet. This always reflects the SFU's current live state (Phase 10 §19),
 * never a stored roster.
 *
 * `null` means the SFU couldn't be reached. That's a different thing from a
 * genuinely empty room (`[]`), and the two never get collapsed into one
 * number.
 */
export class RoomParticipantsResource {
  constructor(private readonly http: RavenHttpClient) {}

  async list(roomId: string): Promise<LiveParticipantInfo[] | null> {
    return this.http.request<LiveParticipantInfo[] | null>(`/v1/rooms/${roomId}/participants`);
  }

  async get(roomId: string, identity: string): Promise<LiveParticipantInfo | null> {
    const participants = await this.list(roomId);
    return participants?.find((p) => p.identity === identity) ?? null;
  }
}
