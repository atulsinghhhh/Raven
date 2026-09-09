---
---

All eight published packages move from the `@corvidhq` scope to
`@ravenkash`:

| Before | After |
| --- | --- |
| `@corvidhq/rtc` | `@ravenkash/rtc` |
| `@corvidhq/chat` | `@ravenkash/chat` |
| `@corvidhq/client` | `@ravenkash/client` |
| `@corvidhq/effects` | `@ravenkash/effects` |
| `@corvidhq/react` | `@ravenkash/react` |
| `@corvidhq/react-native` | `@ravenkash/react-native` |
| `@corvidhq/server` | `@ravenkash/server` |
| `@corvidhq/cli` | `@ravenkash/cli` |

No API changed — not an export, a signature, an event name or an error
code. Only the package names, and every reference to them: workspace
manifests, peer dependency ranges, the root lockfile, each example's
lockfile, the vendored SDK bundles, the e2e harness, and both
documentation sets.

Not versioned by this changeset. None of these packages has ever been
published, so there is no installed version for a rename to break, and the
first release should still be 0.1.0 under the new scope. A published
package changing scope would be a major for every consumer; this one has no
consumers yet.

The Dart packages (`raven_rtc`, `raven_chat`, `raven_live`) and the Python
distribution (`raven-sdk`) are unaffected — neither carries an npm scope.
