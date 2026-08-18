"""Minimal FastAPI backend for a frontend that joins Raven rooms and chats —
the canonical flow: Browser -> your backend -> raven-sdk -> Raven -> a
short-lived token -> back to the browser -> @raven/rtc or @raven/chat.

RAVEN_API_KEY never leaves this process. Never send it to the browser.

RTC and chat are separate planes with separate credentials, so this
mints them separately. Neither token works on the other plane.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.requests import Request
from pydantic import BaseModel

from raven import (
    CreateChatTokenParams,
    CreateConversationParams,
    CreateTokenParams,
    Raven,
    RavenError,
    TokenPermissions,
)

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ.get("RAVEN_API_URL", "http://localhost:4100"),
)

app = FastAPI()


class TokenRequest(BaseModel):
    room: str
    identity: str


class ChatTokenRequest(BaseModel):
    room: str
    """Conversation name or conv_ id. Created on first use below."""
    user_id: str


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


@app.post("/api/chat/token")
async def create_chat_token(request: ChatTokenRequest) -> dict:
    """Mints a browser-safe chat token, creating the conversation on first use.

    Same caveat as the RTC endpoint above: `user_id` must come from your
    own authenticated session in a real app. Whoever controls it controls
    who Raven attributes messages to.
    """
    if not request.room or not request.user_id:
        raise HTTPException(status_code=400, detail="room and user_id are required")

    try:
        conversation = raven.chat.get_conversation(request.room)
    except RavenError as error:
        if error.status_code != 404:
            raise
        conversation = raven.chat.create_conversation(CreateConversationParams(name=request.room))

    # Membership is what authorizes the user inside the conversation; the
    # token alone isn't enough (docs/chat/overview.md#authorization).
    raven.chat.add_member(conversation["publicId"], request.user_id)

    token = raven.chat.create_token(
        CreateChatTokenParams(
            user_id=request.user_id,
            conversations=[conversation["publicId"]],
            expires_in=3600,
        )
    )
    return {**token, "roomId": conversation["publicId"], "roomName": conversation["name"]}
