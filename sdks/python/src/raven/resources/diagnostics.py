"""Authenticated, project-scoped diagnostics (Phase 9) — signaling/SFU/TURN
health plus this project's real active-connection count. There is no
client-side (browser ICE/signaling state) diagnostic here — that only exists
inside a running ``@raven/rtc`` client (``room.getDiagnostics()``), which a
backend has no way to observe.
"""

from __future__ import annotations

from typing import cast

from .._http import RavenHttpClient
from .._async_http import AsyncRavenHttpClient
from .._types import ProjectDiagnostics


class DiagnosticsResource:
    def __init__(self, http: RavenHttpClient) -> None:
        self._http = http

    def get(self) -> ProjectDiagnostics:
        return cast(ProjectDiagnostics, self._http.request("/v1/diagnostics"))


class AsyncDiagnosticsResource:
    def __init__(self, http: AsyncRavenHttpClient) -> None:
        self._http = http

    async def get(self) -> ProjectDiagnostics:
        return cast(ProjectDiagnostics, await self._http.request("/v1/diagnostics"))
