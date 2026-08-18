"""Typed models mirroring the real Control API 1:1 (see apps/api's controllers/DTOs).

Response shapes are ``TypedDict`` (``total=False`` — every field optional for IDE
hinting; the API is the source of truth for what's actually present). Request
parameters are ``dataclasses`` with real defaults, since those are constructed
by the developer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, TypedDict

ProjectStatus = Literal["ACTIVE", "ARCHIVED"]
RoomStatus = Literal["ACTIVE", "CLOSED"]
ConnectionState = Literal["CONNECTING", "CONNECTED", "RECONNECTING", "DISCONNECTED", "FAILED"]
ErrorCategory = Literal[
    "AUTHENTICATION_ERROR",
    "AUTHORIZATION_ERROR",
    "TOKEN_ERROR",
    "SIGNALING_ERROR",
    "ICE_ERROR",
    "TURN_ERROR",
    "SFU_ERROR",
    "NETWORK_ERROR",
    "CLIENT_ERROR",
    "UNKNOWN_ERROR",
]
DependencyStatus = Literal["up", "down"]
MetricsRange = Literal["15m", "1h", "24h", "7d"]


class Project(TypedDict, total=False):
    id: str
    name: str
    description: str | None
    status: ProjectStatus
    ownerId: str
    createdAt: str
    updatedAt: str


class Room(TypedDict, total=False):
    id: str
    projectId: str
    name: str
    status: RoomStatus
    createdAt: str
    updatedAt: str


class LiveTrackInfo(TypedDict, total=False):
    sid: str
    kind: str
    name: str
    muted: bool


class LiveParticipantInfo(TypedDict, total=False):
    identity: str
    joinedAt: str
    tracks: list[LiveTrackInfo]


class IceServer(TypedDict, total=False):
    urls: str
    username: str
    credential: str


class IssuedToken(TypedDict, total=False):
    id: str
    token: str
    livekitUrl: str
    roomId: str
    roomName: str
    participantIdentity: str
    permissions: dict[str, bool]
    iceServers: list[IceServer]
    telemetryUrl: str
    expiresAt: str
    createdAt: str


class ConnectionSummary(TypedDict, total=False):
    id: str
    publicId: str
    projectId: str
    roomId: str | None
    roomName: str
    participantId: str | None
    participantIdentity: str
    state: ConnectionState
    disconnectReason: str | None
    region: str | None
    sdkVersion: str | None
    platform: str | None
    browser: str | None
    networkType: str | None
    iceConnectionState: str | None
    signalingState: str | None
    reconnectCount: int
    startedAt: str
    connectedAt: str | None
    disconnectedAt: str | None
    durationMs: int | None
    createdAt: str
    updatedAt: str


class ConnectionEventEntry(TypedDict, total=False):
    id: str
    type: str
    data: dict[str, Any] | None
    timestamp: str


class ErrorSummary(TypedDict, total=False):
    id: str
    publicId: str
    projectId: str
    connectionId: str | None
    roomId: str | None
    participantId: str | None
    category: ErrorCategory
    message: str
    likelyCause: str | None
    suggestedAction: str | None
    sdkVersion: str | None
    platform: str | None
    timestamp: str


class ConnectionDetail(ConnectionSummary, total=False):
    events: list[ConnectionEventEntry]
    errors: list[ErrorSummary]


class ErrorDetail(ErrorSummary, total=False):
    connection: ConnectionSummary | None


class MetricsOverview(TypedDict, total=False):
    range: str
    activeRooms: int
    activeParticipants: int
    connections: int
    connectionSuccessRate: float | None
    reconnectionRate: float | None
    averageConnectionDurationMs: int | None
    errors: int


class ProjectDiagnosticsDependencies(TypedDict, total=False):
    signaling: DependencyStatus
    sfu: DependencyStatus
    turn: DependencyStatus


class ProjectDiagnostics(TypedDict, total=False):
    project: dict[str, str]
    api: Literal["up"]
    authentication: Literal["ok"]
    dependencies: ProjectDiagnosticsDependencies
    connections: dict[str, int]


@dataclass
class TokenPermissions:
    join: bool | None = None
    subscribe: bool | None = None
    publish: bool | None = None
    publish_audio: bool | None = None
    publish_video: bool | None = None
    publish_data: bool | None = None

    def to_json(self) -> dict[str, bool]:
        mapping = {
            "join": self.join,
            "subscribe": self.subscribe,
            "publish": self.publish,
            "publishAudio": self.publish_audio,
            "publishVideo": self.publish_video,
            "publishData": self.publish_data,
        }
        return {key: value for key, value in mapping.items() if value is not None}


@dataclass
class CreateTokenParams:
    room: str
    """The room's ID (from ``rooms.create()``/``rooms.list()``) — not its display name."""
    identity: str
    """Unique within the room. Letters, numbers, "-", "_", "." only."""
    permissions: TokenPermissions | None = None
    expires_in: int | None = None
    """Token lifetime in seconds (30-21600). Defaults to the API's own default — always short-lived, never permanent."""
    metadata: str | None = None


@dataclass
class ListConnectionsParams:
    room_id: str | None = None
    state: ConnectionState | None = None
    limit: int | None = None


@dataclass
class ListErrorsParams:
    category: ErrorCategory | None = None
    connection_id: str | None = None
    limit: int | None = None


__all__ = [
    "ConnectionDetail",
    "ConnectionEventEntry",
    "ConnectionState",
    "ConnectionSummary",
    "CreateTokenParams",
    "DependencyStatus",
    "ErrorCategory",
    "ErrorDetail",
    "ErrorSummary",
    "IceServer",
    "IssuedToken",
    "LiveParticipantInfo",
    "LiveTrackInfo",
    "ListConnectionsParams",
    "ListErrorsParams",
    "MetricsOverview",
    "MetricsRange",
    "Project",
    "ProjectDiagnostics",
    "ProjectStatus",
    "Room",
    "RoomStatus",
    "TokenPermissions",
]
