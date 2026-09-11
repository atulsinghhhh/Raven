# Publishing @ravenkash/* packages to npm

All eight packages under the `@ravenkash` scope are published and versioned
independently. `raven` was the original scope choice, but that npm
username/org was already taken, so package names, docs, examples, and
source imports all use `@ravenkash` instead — the npm account actually
verified for this project.

| Package | Path | What it is |
|---|---|---|
| `@ravenkash/rtc` | `packages/sdk` | Browser RTC SDK |
| `@ravenkash/chat` | `packages/chat-sdk` | Browser chat SDK |
| `@ravenkash/client` | `packages/client` | RTC + chat behind one object |
| `@ravenkash/react` | `packages/react-sdk` | React hooks/UI for `@ravenkash/rtc` |
| `@ravenkash/react-native` | `packages/react-native-sdk` | React Native SDK |
| `@ravenkash/server` | `packages/server-sdk` | Server-side token/room/diagnostics SDK |
| `@ravenkash/cli` | `packages/cli` | `raven` CLI binary |
| `@ravenkash/effects` | `packages/effects` | Camera filters, no credential needed |

## How a release actually happens

Releases are automated through [changesets](https://github.com/changesets/changesets)
and npm trusted publishing (OIDC — no long-lived `NPM_TOKEN` in CI):

1. A PR that changes a package includes a changeset (`pnpm changeset`)
   describing what changed and at what bump (patch/minor/major).
2. Merging to `main` triggers the **Release** workflow. If unreleased
   changesets exist, it opens/updates a `changeset-release/main` PR that
   bumps the affected `package.json` versions and consumes the changesets
   into that package's changelog.
3. Merging *that* PR runs `changeset publish`, which publishes every
   package whose version moved to npm via trusted publishing, and tags the
   release (e.g. `@ravenkash/rtc@0.4.0`).

Packages version **independently** — a patch to the CLI does not bump
`@ravenkash/rtc`. See `docs/RELEASE_READINESS_AUDIT.md` for the history of
getting this pipeline working (rotating `NPM_TOKEN` to an Automation
token, then replacing it with trusted publishing entirely) and
`docs/releases.md` for the day-to-day contributor workflow.

## Verifying what's live

```bash
npm view @ravenkash/rtc dist-tags.latest
npx @ravenkash/cli --help
```

Python (`raven-sdk`) and Flutter (`raven_rtc`/`raven_chat`/`raven_live`)
are not part of this pipeline and are not yet published to PyPI or
pub.dev — see `apps/docs/content/getting-started/installing-from-source.md`.
