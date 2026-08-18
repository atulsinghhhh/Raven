"""Minimal FastAPI backend for a frontend that joins Raven RTC rooms — the
canonical Phase 10 flow: Browser -> your backend -> raven-sdk -> Raven ->
a short-lived RTC token -> back to the browser -> @raven/rtc.

RAVEN_API_KEY never leaves this process. Never send it to the browser.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.requests import Request
from pydantic import BaseModel

from raven import CreateTokenParams, Raven, RavenError, TokenPermissions

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ.get("RAVEN_API_URL", "http://localhost:4100"),
)

app = FastAPI()


class TokenRequest(BaseModel):
    room: str
    identity: str


@app.exception_handler(RavenError)
async def raven_error_handler(_request: Request, error: RavenError) -> JSONResponse:
    print(f"Raven token creation failed [{error.code}] (request {error.request_id or 'n/a'})")
    return JSONResponse(status_code=error.status_code or 502, content={"error": error.message, "code": error.code})


@app.post("/api/rtc/token")
async def create_token(request: TokenRequest) -> dict:
    if not request.room or not request.identity:
        raise HTTPException(status_code=400, detail="room and identity are required")

    # In a real app, `identity` should come from your own authenticated
    # session, never trusted verbatim from the request body — see
    # docs/security/server-sdk.md#authorization-model. Kept simple here to
    # focus the example on the Raven SDK call itself.
    token = raven.tokens.create(
        CreateTokenParams(
            room=request.room,
            identity=request.identity,
            permissions=TokenPermissions(join=True, subscribe=True, publish=True, publish_audio=True, publish_video=True),
            expires_in=3600,
        )
    )
    return token
