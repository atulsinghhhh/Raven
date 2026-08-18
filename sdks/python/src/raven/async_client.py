"""Raven's async server SDK client — same surface as ``Raven``, awaited.

    from raven import AsyncRaven
    raven = AsyncRaven(api_key=os.environ["RAVEN_API_KEY"])
    token = await raven.tokens.create(CreateTokenParams(room=room_id, identity="user-42"))
"""

from __future__ import annotations

from ._async_http import AsyncRavenHttpClient
from ._http_shared import DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_SECONDS
from .resources.connections import AsyncConnectionsResource
from .resources.diagnostics import AsyncDiagnosticsResource
from .resources.errors import AsyncErrorsResource
from .resources.metrics import AsyncMetricsResource
from .resources.projects import AsyncProjectsResource
from .resources.rooms import AsyncRoomsResource
from .resources.tokens import AsyncTokensResource


class AsyncRaven:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        http = AsyncRavenHttpClient(api_key=api_key, base_url=base_url, timeout=timeout, max_retries=max_retries)
        self._http = http
        self.projects = AsyncProjectsResource(http)
        self.tokens = AsyncTokensResource(http)
        self.rooms = AsyncRoomsResource(http)
        self.connections = AsyncConnectionsResource(http)
        self.errors = AsyncErrorsResource(http)
        self.metrics = AsyncMetricsResource(http)
        self.diagnostics = AsyncDiagnosticsResource(http)

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> AsyncRaven:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.close()
