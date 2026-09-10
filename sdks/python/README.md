# raven-sdk

Raven's official **Python server SDK** — mint short-lived RTC and chat
tokens, manage rooms and live streams, and read connection/error
diagnostics from your own backend.

Raven is open-source real-time communication infrastructure: video, voice,
chat and data for your app, without running WebRTC or WebSocket servers
yourself. Full project: <https://github.com/atulsinghhhh/Raven>

> **Backend only.** This package holds a permanent project API key. It must
> never be imported into browser, mobile or any other client-side code. The
> browser talks to Raven with a short-lived token that *this* SDK mints.

## Requirements

- Python **3.10+**
- A Raven project API key

## Install

```bash
# Not on PyPI yet. `pip install raven-sdk` installs an UNRELATED third-party
# package of that name ("Async Kafka and HTTP producer SDK for Raven AI
# logs"), not this SDK — see docs/releases.md#python--raven-sdk.
pip install "git+https://github.com/atulsinghhhh/Raven.git#subdirectory=sdks/python"
```

## Mint a token

Identity comes from *your* session — never from the request body, or any
caller can claim to be anyone.

```python
import os
from raven import Raven, CreateTokenParams

raven = Raven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ["RAVEN_API_URL"],  # https://api.ravenstack.online
)

grant = raven.tokens.create(CreateTokenParams(room="room-1", identity="user-42"))

# grant is a TypedDict, keyed exactly as the API returns it:
#   grant["token"]        short-lived, safe to hand to a browser
#   grant["endpoint"]     Raven's signaling WebSocket
#   grant["iceServers"]   never hand-build STUN/TURN config
#   grant["expiresAt"]
```

Hand `grant` to your frontend, which passes it to `@ravenkash/rtc`. See
[docs/sdk.md](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk.md).

## Async

Every resource has an async twin with the same shape.

```python
from raven import AsyncRaven, CreateTokenParams

async with AsyncRaven(
    api_key=os.environ["RAVEN_API_KEY"],
    base_url=os.environ["RAVEN_API_URL"],  # https://api.ravenstack.online
) as raven:
    grant = await raven.tokens.create(CreateTokenParams(room="room-1", identity="user-42"))
```

## Resources

`tokens` · `rooms` · `projects` · `connections` · `errors` · `diagnostics`
· `metrics` · `chat` · `live_streams`

## Errors

Every non-2xx response and every transport failure raises `RavenError`,
carrying the API's error code and HTTP status so you can branch on the
cause rather than parse a message. It is built only from the parsed error
body and response metadata, so it can never carry your API key.

```python
from raven import Raven, RavenError

try:
    raven.rooms.get("no-such-room")
except RavenError as err:
    print(err.code, err.status_code, err.request_id)
```

Codes are listed in
[docs/error-codes.md](https://github.com/atulsinghhhh/Raven/blob/main/docs/error-codes.md).

## Documentation

- [Python server SDK reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/sdk/server/python.md)
- [Server SDK security model](https://github.com/atulsinghhhh/Raven/blob/main/docs/security/server-sdk.md)
- [Runnable example](https://github.com/atulsinghhhh/Raven/tree/main/examples/python-server)

## Development

From `sdks/python/`:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

ruff format --check .    # formatting
ruff check .             # lint
mypy src                 # strict type check
pytest                   # tests
python -m build          # sdist + wheel
```

CI runs all of the above against Python 3.10–3.13 on every pull request
(`.github/workflows/ci.yml`).

## License

MIT — see [LICENSE](https://github.com/atulsinghhhh/Raven/blob/main/LICENSE).
