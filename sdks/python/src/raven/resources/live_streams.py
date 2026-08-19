"""Raven Live Streaming, server-side (Phase 14). A stream composes an RTC
room and a chat conversation — this resource only owns lifecycle and role
bookkeeping on top of them, the same reuse discipline the backend itself
follows.

``add_host()``/``create_viewer_token()`` are the security-critical methods:
the role your caller ends up with is entirely determined by which method
you call, never by a field the request body accepts. A viewer token is
always subscribe-only; there is no way to ask this SDK for anything else —
``add_host()`` (called from your own backend, after your own auth check) is
the only path to publish access.
"""

from __future__ import annotations

from typing import Any, cast

from .._async_http import AsyncRavenHttpClient
from .._http import RavenHttpClient
from .._types import (
    AddHostParams,
    CreateLiveStreamParams,
    IssuedStreamCredential,
    LiveStream,
    LiveStreamStatus,
    UpdateLiveStreamParams,
)


def _drop_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def _create_body(params: CreateLiveStreamParams) -> dict[str, Any]:
    return _drop_none(
        {
            "title": params.title,
            "hostIdentity": params.host_identity,
            "description": params.description,
            "thumbnailUrl": params.thumbnail_url,
            "category": params.category,
            "tags": params.tags,
            "language": params.language,
            "visibility": params.visibility,
            "metadata": params.metadata,
            "scheduledAt": params.scheduled_at,
        }
    )


def _update_body(params: UpdateLiveStreamParams) -> dict[str, Any]:
    return _drop_none(
        {
            "title": params.title,
            "description": params.description,
            "thumbnailUrl": params.thumbnail_url,
            "category": params.category,
            "tags": params.tags,
            "language": params.language,
            "visibility": params.visibility,
            "metadata": params.metadata,
        }
    )


def _host_body(params: AddHostParams) -> dict[str, Any]:
    return _drop_none({"identity": params.identity, "role": params.role})


class LiveStreamsResource:
    def __init__(self, http: RavenHttpClient) -> None:
        self._http = http

    def create(self, params: CreateLiveStreamParams) -> LiveStream:
        result = self._http.request("/v1/live-streams", method="POST", body=_create_body(params))
        return cast(LiveStream, result)

    def list(self, status: LiveStreamStatus | None = None) -> list[LiveStream]:
        query = _drop_none({"status": status})
        return cast("list[LiveStream]", self._http.request("/v1/live-streams", query=query))

    def get(self, stream_id: str) -> LiveStream:
        """Includes the stream's live viewer count — ``list()`` does not, to avoid one SFU round trip per row."""
        return cast(LiveStream, self._http.request(f"/v1/live-streams/{stream_id}"))

    def update(self, stream_id: str, params: UpdateLiveStreamParams) -> LiveStream:
        result = self._http.request(f"/v1/live-streams/{stream_id}", method="PATCH", body=_update_body(params))
        return cast(LiveStream, result)

    def start(self, stream_id: str) -> LiveStream:
        """CREATED -> LIVE."""
        return cast(LiveStream, self._http.request(f"/v1/live-streams/{stream_id}/start", method="POST"))

    def end(self, stream_id: str) -> LiveStream:
        """LIVE -> ENDED, terminal. An ended stream cannot be restarted — create a new one."""
        return cast(LiveStream, self._http.request(f"/v1/live-streams/{stream_id}/end", method="POST"))

    def add_host(self, stream_id: str, params: AddHostParams) -> IssuedStreamCredential:
        """Registers a host/co-host and mints full-publish RTC + moderator-or-above chat credentials in one call.

        Call again with the same identity to re-mint fresh credentials.
        """
        result = self._http.request(f"/v1/live-streams/{stream_id}/hosts", method="POST", body=_host_body(params))
        return cast(IssuedStreamCredential, result)

    def remove_host(self, stream_id: str, identity: str) -> None:
        """Soft removal — the host's chat history in the stream is preserved."""
        self._http.request(f"/v1/live-streams/{stream_id}/hosts/{identity}", method="DELETE")

    def create_viewer_token(self, stream_id: str, identity: str) -> IssuedStreamCredential:
        """Always subscribe-only on RTC and MEMBER on chat — see the module doc."""
        result = self._http.request(
            f"/v1/live-streams/{stream_id}/viewer-tokens", method="POST", body={"identity": identity}
        )
        return cast(IssuedStreamCredential, result)

    def leave(self, stream_id: str, identity: str) -> None:
        """A clean-leave signal for ``live_stream.viewer_left``, not a disconnect detector.

        Raven has no way to observe an abrupt viewer disconnect in this phase.
        """
        self._http.request(f"/v1/live-streams/{stream_id}/leave", method="POST", body={"identity": identity})


class AsyncLiveStreamsResource:
    def __init__(self, http: AsyncRavenHttpClient) -> None:
        self._http = http

    async def create(self, params: CreateLiveStreamParams) -> LiveStream:
        result = await self._http.request("/v1/live-streams", method="POST", body=_create_body(params))
        return cast(LiveStream, result)

    async def list(self, status: LiveStreamStatus | None = None) -> list[LiveStream]:
        query = _drop_none({"status": status})
        return cast("list[LiveStream]", await self._http.request("/v1/live-streams", query=query))

    async def get(self, stream_id: str) -> LiveStream:
        return cast(LiveStream, await self._http.request(f"/v1/live-streams/{stream_id}"))

    async def update(self, stream_id: str, params: UpdateLiveStreamParams) -> LiveStream:
        result = await self._http.request(f"/v1/live-streams/{stream_id}", method="PATCH", body=_update_body(params))
        return cast(LiveStream, result)

    async def start(self, stream_id: str) -> LiveStream:
        return cast(LiveStream, await self._http.request(f"/v1/live-streams/{stream_id}/start", method="POST"))

    async def end(self, stream_id: str) -> LiveStream:
        return cast(LiveStream, await self._http.request(f"/v1/live-streams/{stream_id}/end", method="POST"))

    async def add_host(self, stream_id: str, params: AddHostParams) -> IssuedStreamCredential:
        result = await self._http.request(
            f"/v1/live-streams/{stream_id}/hosts", method="POST", body=_host_body(params)
        )
        return cast(IssuedStreamCredential, result)

    async def remove_host(self, stream_id: str, identity: str) -> None:
        await self._http.request(f"/v1/live-streams/{stream_id}/hosts/{identity}", method="DELETE")

    async def create_viewer_token(self, stream_id: str, identity: str) -> IssuedStreamCredential:
        result = await self._http.request(
            f"/v1/live-streams/{stream_id}/viewer-tokens", method="POST", body={"identity": identity}
        )
        return cast(IssuedStreamCredential, result)

    async def leave(self, stream_id: str, identity: str) -> None:
        await self._http.request(f"/v1/live-streams/{stream_id}/leave", method="POST", body={"identity": identity})
