## 0.2.0

* **Requires `raven_rtc` >= 0.2.0.** A live-stream viewer's tile for the
  host never rendered: it decoded the host's video for the whole stream
  and showed a placeholder over it. The defect and its fix are in
  `raven_rtc`'s `RavenVideoView`, but the constraint here was what
  decided whether an application could reach the fix at all — `^0.1.8`
  means `>=0.1.8 <0.2.0` to pub, so publishing the fix as 0.2.0 would
  have left every `raven_live` application on a version that cannot show
  a viewer anything. Nothing in this package's own API changed.

## 0.1.0

Initial release (Livqeno Phase 14).

* `RavenLiveStream.join()` — joins a stream's room and connects its chat,
  composing `raven_rtc` and `raven_chat` rather than reimplementing either.
* `role` / `isHost`, `room`, `chat`, `react()`, `leave()`.
* Typed credentials (`RavenLiveStreamCredentials.fromJson`) mirroring
  `@ravenkash/client`'s `LiveStreamCredentials` field-for-field.
