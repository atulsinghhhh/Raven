export { createRTCClient, RTCClient } from './client';
export type { RTCClientConfig } from './config';

export { Room } from './room';
export type { ConnectionDiagnostics, ConnectionStats, ConnectionState, RoomEventMap } from './room';

export { Participant, LocalParticipant, RemoteParticipant } from './participant';

export { Track, LocalTrack, RemoteTrack } from './track';
export type { TrackKind, TrackStats } from './track';
/**
 * The structural interfaces a `Track` wraps.
 *
 * Exported so a platform SDK (or an application with an unusual media
 * source) can construct a Raven track over something the browser did not
 * hand it. `@corvidhq/react-native` needs these to bridge its Effects
 * integration; they were previously internal, which meant the only way to
 * satisfy them was to guess at the shape.
 */
export type { TrackDelegate, LocalTrackDelegate, RemoteTrackDelegate } from './track';

export { RTCError, isRTCError } from './errors';
export type { RTCErrorCode } from './errors';

export type { LogLevel } from './logger';

export type { ConnectionQuality, DeviceInfo, DeviceKind } from './internal/sfu/types';

export { getBrowserSupportDetails, isBrowserSupported } from './browser-support';
export type { BrowserSupportDetails } from './browser-support';
