---
title: 'Tutorial: build a video call'
description: A complete two-participant video call, from empty folder to working call, with nothing hidden.
---

This builds a working two-person video call from scratch. Every file is
shown in full — nothing is elided, and there's no starter template to
clone. At the end you'll have two browser tabs seeing and hearing each
other.

You need Node 20+, a Livqeno control plane running locally (see
[Installing from source](/getting-started/installing-from-source)), and
about fifteen minutes.

## What you're building

```
your-app/
├── server.js      Express — holds the API key, mints tokens
└── public/
    └── index.html The call UI — never sees the API key
```

The split matters and isn't ceremony: the API key is a permanent
project-wide credential. If it reaches the browser, anyone can mint a
token as any user. So the server mints; the browser receives.

## Step 1 — Set up the project

```bash
mkdir raven-call && cd raven-call
npm init -y
npm install express
```

Then link the SDKs from your Livqeno checkout — they aren't published yet:

```bash
npm install file:../Raven/packages/server-sdk file:../Raven/packages/sdk
```

Adjust `../Raven` to wherever you cloned it. This gives you
`@ravenkash/server` (backend) and `@ravenkash/rtc` (browser).

## Step 2 — Get an API key

```bash
raven login
raven projects create my-first-call
raven keys create --name local-dev --environment development
```

The key prints exactly once:

```
rvk_dev_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk
```

Export it — never paste it into a file you might commit:

```bash
export RAVEN_API_KEY="rvk_dev_8Kd2nQxwYtLm.aG9wZXlvdWFyZWhhdmluZ2Fsb3ZlbHlkYXk"
```

## Step 3 — The server

Create `server.js`:

```js
import express from 'express';
import { Raven } from '@ravenkash/server';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const raven = new Raven({
  apiKey: process.env.RAVEN_API_KEY,
  baseUrl: 'http://localhost:4100', // your local control plane
});

// Create the room once at startup. In a real app you'd create rooms in
// response to something — a meeting being scheduled, a support chat
// opening — and store the id alongside whatever that thing is.
let roomId;
app.listen(3000, async () => {
  const room = await raven.rooms.create({ name: 'tutorial-room' });
  roomId = room.id;
  console.log('Ready on http://localhost:3000');
});

app.post('/api/token', async (req, res) => {
  // In a real app, `identity` comes from YOUR session — req.user.id, a
  // decoded JWT, a database lookup. Never from the request body, which
  // is exactly what the client controls. Taking it from the body here
  // is the tutorial's one shortcut, and it is not safe in production.
  const identity = req.body.identity;

  if (!identity) {
    return res.status(400).json({ error: 'identity is required' });
  }

  const token = await raven.tokens.create({
    room: roomId,
    identity,
    permissions: { join: true, publish: true, subscribe: true },
    expiresIn: 3600,
  });

  // Forward the whole response — token, endpoint, and iceServers are
  // all needed by the browser, and iceServers especially must never be
  // hand-constructed.
  res.json(token);
});
```

Add `"type": "module"` to your `package.json` so the `import` syntax
works.

## Step 4 — The browser

Create `public/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Livqeno call</title>
    <style>
      body { font-family: system-ui; max-width: 800px; margin: 2rem auto; }
      video { width: 320px; background: #000; border-radius: 8px; margin: 0.5rem; }
      button { padding: 0.5rem 1rem; margin-right: 0.5rem; }
    </style>
  </head>
  <body>
    <h1>Livqeno call</h1>

    <p>
      <input id="name" placeholder="Your name" />
      <button id="join">Join</button>
      <button id="leave" disabled>Leave</button>
    </p>
    <p>Status: <strong id="status">not joined</strong></p>

    <div>
      <h2>You</h2>
      <div id="local"></div>
      <h2>Others</h2>
      <div id="remote"></div>
    </div>

    <script type="module" src="/call.js"></script>
  </body>
</html>
```

## Step 5 — The call logic

Create `public/call.js`. This is the whole thing:

```js
import { createRTCClient } from '@ravenkash/rtc';

const statusEl = document.getElementById('status');
const localEl = document.getElementById('local');
const remoteEl = document.getElementById('remote');

let client;
let room;

document.getElementById('join').onclick = async () => {
  const identity = document.getElementById('name').value.trim();
  if (!identity) return alert('Enter a name first');

  // 1. Ask YOUR server for a token. The browser never talks to Livqeno's
  //    control plane directly, and never holds an API key.
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity }),
  });
  const auth = await res.json();

  // 2. Build a client from exactly what the server returned.
  client = createRTCClient({
    token: auth.token,
    endpoint: auth.endpoint,
    iceServers: auth.iceServers,
  });

  // 3. Join. Events live on the room, not the client — wire them up
  //    immediately after, before doing anything else.
  room = await client.join(auth.roomName);

  room.on('connectionStateChanged', (state) => {
    statusEl.textContent = state;
  });

  room.on('error', (error) => {
    console.error(error.code, error.message);
  });

  // Someone else's track arrived — attach it to a <video>.
  room.on('trackSubscribed', (track, participant) => {
    const el = track.attach();
    el.id = `track-${participant.identity}-${track.kind}`;
    remoteEl.appendChild(el);
  });

  room.on('trackUnsubscribed', (track) => {
    track.detach().forEach((el) => el.remove());
  });

  room.on('participantLeft', (participant) => {
    // Clean up anything still on screen for them.
    remoteEl
      .querySelectorAll(`[id^="track-${participant.identity}-"]`)
      .forEach((el) => el.remove());
  });

  // 4. Anyone already in the room when you joined won't fire
  //    trackSubscribed — they're available synchronously instead.
  for (const participant of room.remoteParticipants) {
    for (const track of participant.tracks) {
      remoteEl.appendChild(track.attach());
    }
  }

  // 5. Publish your own camera and mic.
  const camera = await room.enableCamera();
  await room.enableMicrophone();

  if (camera) {
    const el = camera.attach();
    el.muted = true; // never play your own audio back at yourself
    localEl.appendChild(el);
  }

  document.getElementById('join').disabled = true;
  document.getElementById('leave').disabled = false;
};

document.getElementById('leave').onclick = async () => {
  await room?.leave();
  localEl.innerHTML = '';
  remoteEl.innerHTML = '';
  statusEl.textContent = 'not joined';
  document.getElementById('join').disabled = false;
  document.getElementById('leave').disabled = true;
};
```

Because this uses a bare `import` specifier, serve it through a bundler
(Vite, esbuild) or change the import to a path your browser can resolve.
The fastest way to try it as-is:

```bash
npx vite public --port 3001
```

## Step 6 — Run it

```bash
node server.js
```

Open **two** browser tabs at `http://localhost:3000`, enter a different
name in each, and click Join in both. Each tab should show its own
camera under "You" and the other tab's under "Others".

## What just happened

```
Tab A                   Your server              Livqeno              Tab B
  │  POST /api/token         │                     │                  │
  ├─────────────────────────►│                     │                  │
  │                          │  tokens.create()    │                  │
  │                          ├────────────────────►│                  │
  │                          │◄────────────────────┤                  │
  │◄─────────────────────────┤   token             │                  │
  │                                                │                  │
  │  join(room) — token only, never the API key    │                  │
  ├───────────────────────────────────────────────►│                  │
  │                                                │◄─────────────────┤
  │◄────────────── media flows between tabs ──────────────────────────┤
```

Your server held the API key. Each tab got a token scoped to one
identity, one room, and an explicit permission set, expiring in an hour.

## Common problems

**"Cannot find module '@ravenkash/rtc'"** — the packages need building
first: `pnpm --filter "./packages/*" run build` in your Livqeno checkout.

**Camera works, but the other tab sees nothing** — check that both tabs
used *different* identities. Two participants with the same identity in
one room conflict.

**Black video with no error** — a denied camera permission. Browsers
don't always throw; check the address-bar permission icon.

**Works locally, fails over a network** — you dropped `iceServers`.
Without TURN, connections fail across most real NATs. Always forward it.

## Next

- [Add chat to this call](/chat) — the same pattern, a chat
  token instead of an RTC one.
- [Diagnostics](/rtc/diagnostics) — RTT, jitter, and packet loss for a
  live call.
- [React SDK](/sdk/react) — the same thing with hooks, far less code.
- [Authentication](/authentication) — what to fix before
  this goes near production.
