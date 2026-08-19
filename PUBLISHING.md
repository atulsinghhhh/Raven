# Publishing @corvidhq/* packages to npm

Seven packages are publish-ready under the `@corvidhq` scope. `raven` was the
original choice, but that npm username/org is already taken, so everything
below (package names, docs, examples, source imports) was renamed to
`@corvidhq` across the repo. None of the `@corvidhq/*` package names are taken
on the public registry (verified via `npm view` — all return 404), but you
still need to own the `corvidhq` scope on npm before `npm publish` will work —
double-check it's actually free on npmjs.com/GoDaddy before registering
anything; the checks run here were best-effort only.

| Package | Path | What it is |
|---|---|---|
| `@corvidhq/rtc` | `packages/sdk` | Browser RTC SDK |
| `@corvidhq/chat` | `packages/chat-sdk` | Browser chat SDK |
| `@corvidhq/client` | `packages/client` | RTC + chat behind one object |
| `@corvidhq/react` | `packages/react-sdk` | React hooks/UI for `@corvidhq/rtc` |
| `@corvidhq/react-native` | `packages/react-native-sdk` | React Native SDK |
| `@corvidhq/server` | `packages/server-sdk` | Server-side token/room/diagnostics SDK |
| `@corvidhq/cli` | `packages/cli` | `raven` CLI binary |

## What was done to prep them

- Added a root `LICENSE` (MIT) and copied it into each package directory —
  npm bundles `LICENSE`/`README` into the tarball automatically even though
  `files` only lists `dist`.
- Added `repository`, `homepage`, and `bugs` fields to each `package.json`
  (pointed at `github.com/atulsinghhhh/Raven`, `main` branch — update if the
  repo path or default branch differs).
- Added `"publishConfig": { "access": "public" }` to each — **required**
  because scoped packages (`@corvidhq/...`) publish as *private* by default,
  which fails outright on a free npm account.
- Fixed `@corvidhq/cli`'s `bin` path (`./dist/index.js` → `dist/index.js`) to
  silence npm's (harmless but noisy) path-normalization warning.
- Built all seven packages (`pnpm --filter ... run build`) and ran
  `npm publish --dry-run` in each — all pack cleanly, correct files only
  (`dist/`, `LICENSE`, `package.json`), no missing entry points.

I did **not** run the real `npm publish` or `npm login` — this machine has no
npm credentials, and publishing is a one-way, public action you should drive
yourself.

## What you need to do

1. **Claim the `@corvidhq` scope**, if you haven't already: it must map to
   your npm username or an npm org you own. Either:
   - Your npm username is literally `corvidhq`, or
   - Create the `corvidhq` org at https://www.npmjs.com/org/create (free for
     one public-package org) and make sure your account is a member.
2. **Log in** from this machine:
   ```bash
   npm login
   ```
   (or set `//registry.npmjs.org/:_authToken=<token>` in `~/.npmrc` if you're
   using an automation/granular access token — recommended for CI later).
3. **Publish each package**, in this order (leaf SDKs first, `cli` and
   `client` last since nothing in this repo depends on them):
   ```bash
   cd packages/sdk               && npm publish   # @corvidhq/rtc
   cd ../chat-sdk                 && npm publish   # @corvidhq/chat
   cd ../server-sdk                && npm publish   # @corvidhq/server
   cd ../react-sdk                 && npm publish   # @corvidhq/react
   cd ../react-native-sdk           && npm publish   # @corvidhq/react-native
   cd ../client                     && npm publish   # @corvidhq/client
   cd ../cli                        && npm publish   # @corvidhq/cli
   ```
   Or from the repo root with pnpm, one at a time:
   ```bash
   pnpm --filter @corvidhq/rtc publish --access public
   pnpm --filter @corvidhq/chat publish --access public
   pnpm --filter @corvidhq/server publish --access public
   pnpm --filter @corvidhq/react publish --access public
   pnpm --filter @corvidhq/react-native publish --access public
   pnpm --filter @corvidhq/client publish --access public
   pnpm --filter @corvidhq/cli publish --access public
   ```
4. **Verify**:
   ```bash
   npm view @corvidhq/rtc
   npx @corvidhq/cli --help
   ```

## After the first publish

- Version bumps: these are independent packages at `0.1.0`, not yet wired to
  a changesets/release workflow. Bump each `package.json` version and re-run
  `npm publish` (or adopt [changesets](https://github.com/changesets/changesets)
  if you want coordinated versioning — not set up yet).
- Consider adding a GitHub Actions publish workflow (there's currently a
  `docker-publish.yml` but no npm equivalent) once you have an `NPM_TOKEN`
  secret to automate this instead of doing it by hand each time.
