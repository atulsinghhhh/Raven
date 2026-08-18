# CLI workflow: zero to a joined room

The canonical path through `@raven/cli`, exactly as verified end-to-end
against a real local Raven deployment (`docker compose up`, `apps/api`
on `:4100`, dashboard on `:3000`). Every command below is real — no
placeholders elided for brevity beyond your own project name.

```bash
# 1. Install (local build, this phase doesn't publish to npm)
cd packages/cli && pnpm install && pnpm build
# expose ./dist/index.js as `raven` on your PATH

# 2. Authenticate — opens your browser, no password in the terminal
raven login
# ✔ Waiting for browser authentication…
# ✔ Logged in as dev@example.com

# 3. Confirm identity
raven whoami
# dev@example.com
# Projects: 0
# Environment: development

# 4. Create a project
raven projects create my-video-app
# ✔ Created project "my-video-app" (proj_...)

# 5. Link the current directory to it
mkdir my-video-app && cd my-video-app
raven init
# ? Select a project: my-video-app
# ✔ Linked this directory to "my-video-app". Wrote raven.json
# Next: raven sdk install

# 6. Install the browser SDK
raven sdk install
# (auto-detects npm/pnpm/yarn/bun and runs the install)

# 7. Sanity-check the setup
raven status
# Project: my-video-app
# Database:  Healthy
# Redis:     Healthy
# SFU:       Healthy
# TURN:      Healthy

# 8. Create an API key for your backend (shown once — save it now)
raven keys create --name dev-key
# rvk_xxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy

# 9. Create a room
raven rooms create my-room
# ✔ Created room "my-room" (a1b2c3d4-...)

raven rooms list
# NAME       LIVE PARTICIPANTS  STATUS
# my-room    0                  idle

# 10. Mint a short-lived RTC token from YOUR OWN BACKEND using the API
#     key from step 8 — never mint tokens in the browser, and the CLI
#     itself never mints a permanent one either:
curl -X POST http://localhost:4100/v1/rooms/a1b2c3d4-.../rtc-tokens \
  -H "Authorization: Bearer rvk_xxxxxxxxxxxx.yyyy..." \
  -H "Content-Type: application/json" \
  -d '{"participantIdentity": "alice", "permissions": {"join": true, "subscribe": true, "publish": true, "publishAudio": true, "publishVideo": true}}'

# 11. Run examples/video-call, paste that token JSON, click "Join Room"
python3 -m http.server 8900 --directory examples/video-call
open http://localhost:8900/index.html

# 12. Repeat steps 10-11 with a second identity ("bob") in a second tab
#     to see both participants join the same room.

# 13. Verified outcome: Terminal → Raven CLI → Raven API → Raven
#     infrastructure → a real RTC application, end to end.
```

## What this proves

- `raven login` reuses the dashboard's real session auth — no separate
  password flow.
- `raven projects create` / `raven init` / `raven keys create` /
  `raven rooms create` all hit the same Control API the dashboard uses —
  there is no CLI-only backend.
- The API key minted by the CLI mints a real, working RTC token from the
  Control API, which a real browser SDK client (`@raven/rtc`) can use to
  join and connect to the actual LiveKit SFU — confirmed live via
  `Status: connected` and correct remote-participant discovery in both
  browser tabs, with real LiveKit signaling visible in the browser
  console.

## A note on step 11 in an automated/headless environment

Camera/microphone capture requires a real, human-granted browser
permission prompt (native browser UI, outside the page). In an
automated test harness without a way to click "Allow" on that OS-level
dialog, connection/signaling can be fully verified (as above) while
actual frame capture cannot — that's a property of the test
environment, not of the CLI or SDK. On a real developer machine, the
browser prompts normally and camera/microphone work as documented in
`docs/sdk.md`.
