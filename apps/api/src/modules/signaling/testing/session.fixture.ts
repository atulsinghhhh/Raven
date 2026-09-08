import { Environment } from '../../../shared/environment/environment.constants';
import { RtcPermissions } from '../../rtc-tokens/rtc-token.claims';
import { ParticipantSession } from '../interfaces/participant-session.interface';

/**
 * A believable authenticated session, for tests.
 *
 * Shared instead of redefined per spec file: `ParticipantSession` gained
 * five fields during the SFU migration, and three near-identical copies of
 * this fixture all had to be found and updated. One copy means the next
 * field is added once.
 */
export function makeSession(overrides: Partial<ParticipantSession> = {}): ParticipantSession {
  const grant: RtcPermissions = {
    join: true,
    subscribe: true,
    publish: true,
    publishAudio: true,
    publishVideo: true,
    publishData: true,
  };

  return {
    connectionId: 'conn-1',
    tokenId: 'rtc-token-1',
    participantId: 'alice',
    projectId: 'project-1',
    environment: Environment.DEVELOPMENT,
    roomId: 'room-1',
    roomName: 'demo-room',
    permissions: { ...grant },
    grant,
    socket: {} as never,
    joinedRoom: false,
    joinedAt: null,
    isAlive: true,
    messageTimestamps: [],
    ...overrides,
  };
}

/**
 * Narrows a session's permissions, keeping `permissions` and `grant` in
 * step.
 *
 * They are the same grant in two shapes: the public DTO and the
 * SFU-facing one, and a test that set only `permissions` would authorize
 * at the control plane while telling the node something different, which
 * is not a state the real system can be in.
 */
export function withPermissions(
  session: ParticipantSession,
  permissions: Partial<RtcPermissions>,
): ParticipantSession {
  const grant: RtcPermissions = { ...session.grant, ...permissions };
  return { ...session, grant, permissions: { ...grant } };
}
