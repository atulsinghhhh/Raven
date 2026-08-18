"""Rooms are control-plane records, not persistent infrastructure — ``delete()``
closes a room (soft-close, sets status to CLOSED) rather than destroying
history, matching the actual API (Phase 10 spec Section 18).
"""

from __future__ import annotations

from typing import cast

from .._http import RavenHttpClient
from .._async_http import AsyncRavenHttpClient
from .._types import LiveParticipantInfo, Room


class RoomParticipantsResource:
    """Real join/leave participant *history* isn't wired up in the Control API
    yet — this always reflects the SFU's current live state (Phase 10 spec
    Section 19), never a stored roster. ``None`` means the SFU couldn't be
    reached, distinct from a genuinely empty room (``[]``) — never coerced to one.
    """

    def __init__(self, http: RavenHttpClient) -> None:
        self._http = http

    def list(self, room_id: str) -> list[LiveParticipantInfo] | None:
        result = self._http.request(f"/v1/rooms/{room_id}/participants")
        return cast("list[LiveParticipantInfo] | None", result)

    def get(self, room_id: str, identity: str) -> LiveParticipantInfo | None:
        participants = self.list(room_id)
        if participants is None:
            return None
        return next((p for p in participants if p.get("identity") == identity), None)


class AsyncRoomParticipantsResource:
    def __init__(self, http: AsyncRavenHttpClient) -> None:
        self._http = http

    async def list(self, room_id: str) -> list[LiveParticipantInfo] | None:
        result = await self._http.request(f"/v1/rooms/{room_id}/participants")
        return cast("list[LiveParticipantInfo] | None", result)

    async def get(self, room_id: str, identity: str) -> LiveParticipantInfo | None:
        participants = await self.list(room_id)
        if participants is None:
            return None
        return next((p for p in participants if p.get("identity") == identity), None)


class RoomsResource:
    def __init__(self, http: RavenHttpClient) -> None:
        self._http = http
        self.participants = RoomParticipantsResource(http)

    def list(self) -> list[Room]:
        return cast("list[Room]", self._http.request("/v1/rooms"))

    def get(self, room_id: str) -> Room:
        return cast(Room, self._http.request(f"/v1/rooms/{room_id}"))

    def create(self, name: str) -> Room:
        return cast(Room, self._http.request("/v1/rooms", method="POST", body={"name": name}))

    def delete(self, room_id: str) -> None:
        self._http.request(f"/v1/rooms/{room_id}", method="DELETE")


class AsyncRoomsResource:
    def __init__(self, http: AsyncRavenHttpClient) -> None:
        self._http = http
        self.participants = AsyncRoomParticipantsResource(http)

    async def list(self) -> list[Room]:
        return cast("list[Room]", await self._http.request("/v1/rooms"))

    async def get(self, room_id: str) -> Room:
        return cast(Room, await self._http.request(f"/v1/rooms/{room_id}"))

    async def create(self, name: str) -> Room:
        return cast(Room, await self._http.request("/v1/rooms", method="POST", body={"name": name}))

    async def delete(self, room_id: str) -> None:
        await self._http.request(f"/v1/rooms/{room_id}", method="DELETE")
