## 0.1.0

Initial release (Raven Phase 13).

* `RavenChat` — connect, join rooms, send and receive, with bounded
  exponential-backoff reconnection.
* Message history with cursor pagination, editing, soft deletion, threads.
* Presence, typing indicators, reactions, read receipts.
* Idempotent sends: a retry after a reconnect returns the original message
  instead of posting a duplicate.
* Typed errors sharing the web SDK's codes.
