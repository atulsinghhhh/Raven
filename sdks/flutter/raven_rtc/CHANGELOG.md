## 0.1.0

Initial release (Livqeno Phase 13).

* `Raven` / `RavenRoom` — join, leave, camera, microphone, screen share,
  front/rear camera switch.
* `RavenVideoView` — renders a participant, follows track changes, and
  disposes its native texture with the widget.
* `RavenPermissions` — camera and microphone prompts without an extra
  plugin.
* Typed errors (`RavenException`, `RavenPermissionException`) sharing the
  web SDK's vocabulary.
* Adaptive streaming and dynacast on by default, which the web SDK leaves
  off — a phone pays for resolution it isn't showing.
