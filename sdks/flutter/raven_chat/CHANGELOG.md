## 0.1.1

Two fixes from an external integration, both in behaviour the
documentation promised and the code did not deliver.

* **Fixed:** presence was lost on every reconnect. Presence is socket
  state, and the new socket a reconnect opens knows nothing of what was
  set on the old one — so a client that survived a blip went silently
  invisible to everybody else for the rest of the session, while its own
  `connectionState` still read `connected`. `setPresence()` now remembers
  what it was asked for and re-sends it after each reconnect, ahead of
  the room rejoins so the server never processes a join for somebody it
  believes is absent. A client that never called `setPresence()` still
  announces nothing.

* **Fixed:** `startTyping()`'s documentation said it was safe to call on
  every keystroke. The server disagreed — typing frames are limited to 20
  per 10 seconds, which a fast typist passes inside a sentence, and the
  21st came back as an error banner mid-message. The repeats are now
  dropped client-side rather than sent and refused: at most one frame
  every two seconds per room, well inside the limit and well short of the
  indicator's own TTL. `stopTyping()` clears the window, so stopping and
  starting again still signals immediately.

* **Documented:** `connect()` joins a conversation; it does not announce
  the user. Two connected clients each see only themselves until they
  call `setPresence()`. That is deliberate and shared with every other
  Livqeno Chat SDK — a client that reads without appearing is an ordinary
  thing to build — but it was nowhere in the API documentation.

## 0.1.0

Initial release (Livqeno Phase 13).

* `RavenChat` — connect, join rooms, send and receive, with bounded
  exponential-backoff reconnection.
* Message history with cursor pagination, editing, soft deletion, threads.
* Presence, typing indicators, reactions, read receipts.
* Idempotent sends: a retry after a reconnect returns the original message
  instead of posting a duplicate.
* Typed errors sharing the web SDK's codes.
