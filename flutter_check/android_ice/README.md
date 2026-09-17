# Android ICE validation harness

Drives real Live Stream host (and host+viewer) sessions on Android
emulators against the production API, for the ICE/TURN reliability work.

- `launch.sh <device>` — starts a **fresh** Flutter process and verifies it.
  `am start` alone returns `START_TASK_TO_FRONT`: the task record survives
  `force-stop`, Android resumes the existing task and `main()` never runs,
  which silently invalidated an earlier round of viewer runs. This uses
  `am start -S -W --activity-clear-task` and then waits for the app's own
  `{"phase":"booting"}` line rather than trusting the launch result.
- `verify.sh <label> <from> <to> [viewer]` — mints credentials, builds and
  installs host/viewer APKs, runs a session, and records host/viewer media
  state, candidate drain counts, ICE restarts, renderer probe and the SFU's
  participant/track view.
- `main_android_live.dart` — the harness app. Copy into a Flutter consumer
  project's `lib/`. Reads credentials from `--dart-define=CREDS=<json>`,
  logs via `debugPrint` (reaches logcat; `developer.log` does not), and
  attaches its own `RTCVideoRenderer` to the first remote video track so
  `srcObject` and decoded frame dimensions can be read back on device.

Needs `flutter_webrtc` as a direct dependency of the consumer project for
the renderer probe.
