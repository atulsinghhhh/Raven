## 0.1.0

Initial release (Raven Phase 14).

* `RavenLiveStream.join()` — joins a stream's room and connects its chat,
  composing `raven_rtc` and `raven_chat` rather than reimplementing either.
* `role` / `isHost`, `room`, `chat`, `react()`, `leave()`.
* Typed credentials (`RavenLiveStreamCredentials.fromJson`) mirroring
  `@corvidhq/client`'s `LiveStreamCredentials` field-for-field.
