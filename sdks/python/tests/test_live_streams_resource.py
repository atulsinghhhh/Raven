from __future__ import annotations

from unittest.mock import MagicMock

from raven._types import AddHostParams, CreateLiveStreamParams, UpdateLiveStreamParams
from raven.resources.live_streams import AsyncLiveStreamsResource, LiveStreamsResource


def _fake_http(return_value=None):
    http = MagicMock()
    http.request.return_value = return_value
    return http


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


def test_create_posts_the_wire_field_names() -> None:
    http = _fake_http({"id": "stream_1"})
    resource = LiveStreamsResource(http)

    resource.create(CreateLiveStreamParams(title="Friday Q&A", host_identity="user-123"))

    http.request.assert_called_once_with(
        "/v1/live-streams",
        method="POST",
        body={"title": "Friday Q&A", "hostIdentity": "user-123"},
    )


def test_create_omits_unset_fields_rather_than_sending_null() -> None:
    http = _fake_http({"id": "stream_1"})
    resource = LiveStreamsResource(http)

    resource.create(
        CreateLiveStreamParams(title="Friday Q&A", host_identity="user-123", thumbnail_url="https://example.com/t.png")
    )

    _, kwargs = http.request.call_args
    assert kwargs["body"] == {
        "title": "Friday Q&A",
        "hostIdentity": "user-123",
        "thumbnailUrl": "https://example.com/t.png",
    }


def test_list_without_status_sends_no_query() -> None:
    http = _fake_http([])
    resource = LiveStreamsResource(http)

    resource.list()

    http.request.assert_called_once_with("/v1/live-streams", query={})


def test_list_filters_by_status() -> None:
    http = _fake_http([])
    resource = LiveStreamsResource(http)

    resource.list(status="LIVE")

    http.request.assert_called_once_with("/v1/live-streams", query={"status": "LIVE"})


def test_get_includes_the_live_viewer_count() -> None:
    http = _fake_http({"id": "stream_1", "viewerCount": 3})
    resource = LiveStreamsResource(http)

    stream = resource.get("stream_1")

    http.request.assert_called_once_with("/v1/live-streams/stream_1")
    assert stream["viewerCount"] == 3


def test_update_patches_only_given_fields() -> None:
    http = _fake_http({"id": "stream_1"})
    resource = LiveStreamsResource(http)

    resource.update("stream_1", UpdateLiveStreamParams(title="New title"))

    http.request.assert_called_once_with(
        "/v1/live-streams/stream_1", method="PATCH", body={"title": "New title"}
    )


def test_start_posts_to_the_start_endpoint() -> None:
    http = _fake_http({"id": "stream_1", "status": "LIVE"})
    resource = LiveStreamsResource(http)

    resource.start("stream_1")

    http.request.assert_called_once_with("/v1/live-streams/stream_1/start", method="POST")


def test_end_posts_to_the_end_endpoint() -> None:
    http = _fake_http({"id": "stream_1", "status": "ENDED"})
    resource = LiveStreamsResource(http)

    resource.end("stream_1")

    http.request.assert_called_once_with("/v1/live-streams/stream_1/end", method="POST")


# ---------------------------------------------------------------------------
# Hosts and viewer credentials — the security-critical methods
# ---------------------------------------------------------------------------


def test_add_host_posts_identity_and_role() -> None:
    http = _fake_http({"identity": "user-2", "role": "CO_HOST", "rtc": {}, "chat": {}})
    resource = LiveStreamsResource(http)

    resource.add_host("stream_1", AddHostParams(identity="user-2"))

    http.request.assert_called_once_with(
        "/v1/live-streams/stream_1/hosts", method="POST", body={"identity": "user-2"}
    )


def test_add_host_forwards_an_explicit_role() -> None:
    http = _fake_http({"identity": "user-2", "role": "HOST"})
    resource = LiveStreamsResource(http)

    resource.add_host("stream_1", AddHostParams(identity="user-2", role="HOST"))

    _, kwargs = http.request.call_args
    assert kwargs["body"] == {"identity": "user-2", "role": "HOST"}


def test_remove_host_is_a_delete_on_the_identity_path() -> None:
    http = _fake_http(None)
    resource = LiveStreamsResource(http)

    resource.remove_host("stream_1", "user-2")

    http.request.assert_called_once_with("/v1/live-streams/stream_1/hosts/user-2", method="DELETE")


def test_create_viewer_token_sends_only_an_identity_never_a_role() -> None:
    http = _fake_http({"identity": "user-3", "role": "VIEWER", "rtc": {}})
    resource = LiveStreamsResource(http)

    resource.create_viewer_token("stream_1", "user-3")

    http.request.assert_called_once_with(
        "/v1/live-streams/stream_1/viewer-tokens", method="POST", body={"identity": "user-3"}
    )


def test_leave_posts_the_identity_as_a_clean_leave_signal() -> None:
    http = _fake_http(None)
    resource = LiveStreamsResource(http)

    resource.leave("stream_1", "user-3")

    http.request.assert_called_once_with(
        "/v1/live-streams/stream_1/leave", method="POST", body={"identity": "user-3"}
    )


# ---------------------------------------------------------------------------
# Async parity
# ---------------------------------------------------------------------------


class _AsyncHttp:
    """Minimal awaitable stand-in — MagicMock doesn't await cleanly."""

    def __init__(self, return_value=None) -> None:
        self.return_value = return_value
        self.calls: list[tuple[tuple, dict]] = []

    async def request(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.return_value


async def test_async_create_matches_the_sync_body() -> None:
    http = _AsyncHttp({"id": "stream_1"})
    resource = AsyncLiveStreamsResource(http)  # type: ignore[arg-type]

    await resource.create(CreateLiveStreamParams(title="Friday Q&A", host_identity="user-123"))

    args, kwargs = http.calls[0]
    assert args[0] == "/v1/live-streams"
    assert kwargs["body"] == {"title": "Friday Q&A", "hostIdentity": "user-123"}


async def test_async_add_host_matches_the_sync_body() -> None:
    http = _AsyncHttp({"identity": "user-2", "role": "CO_HOST"})
    resource = AsyncLiveStreamsResource(http)  # type: ignore[arg-type]

    await resource.add_host("stream_1", AddHostParams(identity="user-2"))

    args, kwargs = http.calls[0]
    assert args[0] == "/v1/live-streams/stream_1/hosts"
    assert kwargs["body"] == {"identity": "user-2"}


async def test_async_surface_matches_sync_surface() -> None:
    # The two clients must not drift. A method that exists on one and not
    # the other is a bug a user only finds after switching.
    sync_methods = {m for m in dir(LiveStreamsResource) if not m.startswith("_")}
    async_methods = {m for m in dir(AsyncLiveStreamsResource) if not m.startswith("_")}
    assert sync_methods == async_methods
