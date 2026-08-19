"""Minimal FastAPI backend for the media demo — mints RTC tokens and
surfaces real project diagnostics, both through `raven-sdk`.

RAVEN_API_KEY never leaves this process. Never send it to the browser.

This is what replaced the old workflow of curling the Control API by
hand and pasting the JSON response into the page: the browser now asks
this server for a token, exactly like a real app's backend would.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.requests import Request
from pydantic import BaseModel

from raven import CreateTokenParams, Raven, RavenError, TokenPermissions

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ.get("RAVEN_API_URL", "http://localhost:4100"),
)

app = FastAPI()

# The demo page is served separately (`python3 -m http.server`), on a
# different origin than this API — see the README. Fine for a local demo;
# a real app would either serve both from the same origin or scope this
# to its actual frontend origin.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class TokenRequest(BaseModel):
    room: str
    """A room name — created on first use if it doesn't exist yet, same as the chat example's conversations."""
    identity: str


@app.exception_handler(RavenError)
async def raven_error_handler(_request: Request, error: RavenError) -> JSONResponse:
    print(f"Raven request failed [{error.code}] (request {error.request_id or 'n/a'})")
    return JSONResponse(status_code=error.status_code or 502, content={"error": error.message, "code": error.code})


def _room_id_for(name: str) -> str:
    """Finds the room by name, creating it if this is the first time anyone's asked for it.

    `CreateTokenParams.room` wants a room *ID*, not its display name (see
    ``tokens.py``), so every caller needs this lookup regardless of
    whether the room already existed.
    """
    try:
        room = raven.rooms.create(name)
    except RavenError as error:
        if error.status_code != 409:  # not "a room with this name already exists"
            raise
        room = next((r for r in raven.rooms.list() if r.get("name") == name), None)
        if room is None:
            # The 409 named a real conflict, but it's gone by the time we
            # looked — surface that plainly rather than a confusing None.
            raise RavenError(f'Room "{name}" reported as existing but could not be found', code="RAVEN_NOT_FOUND")
    return room["id"]


@app.post("/api/rtc/token")
async def create_token(request: TokenRequest) -> dict:
    if not request.room or not request.identity:
        raise HTTPException(status_code=400, detail="room and identity are required")

    # `identity` should come from your own authenticated session in a real
    # app, never trusted verbatim from the request body — see
    # docs/security/server-sdk.md#authorization-model. Kept simple here to
    # focus the example on the Raven SDK calls themselves.
    room_id = _room_id_for(request.room)
    token = raven.tokens.create(
        CreateTokenParams(
            room=room_id,
            identity=request.identity,
            permissions=TokenPermissions(join=True, subscribe=True, publish=True, publish_audio=True, publish_video=True),
            expires_in=3600,
        )
    )
    return token


@app.get("/api/diagnostics")
async def get_diagnostics() -> dict:
    """Real signaling/SFU/TURN health and this project's active-connection
    count — `raven.diagnostics.get()` from ``raven/resources/diagnostics.py``,
    passed straight through. This is what the page's "Project diagnostics"
    panel polls, replacing the old approach of reaching into
    `livekit-client`'s undocumented internals to guess at connection health
    from inside the browser.
    """
    return raven.diagnostics.get()
