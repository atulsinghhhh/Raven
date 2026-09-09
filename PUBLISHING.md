# Publishing @ravenkash/* packages to npm

Seven packages are publish-ready under the `@ravenkash` scope. `raven` was the
original choice, but that npm username/org was already taken; `corvidhq` was
tried next and the repo was renamed to it, but it turned out to already be a
registered npm account too (not owned by this project) — so everything below
(package names, docs, examples, source imports) was renamed a second time, to
`@ravenkash`, matching the npm account (`ravenkash`) actually verified and
logged into in-browser for this project. None of the `@ravenkash/*` package
names are taken on the public registry (verified via `npm view` — all return
404). Since `ravenkash` is a personal npm username rather than a separate org,
owning the scope is automatic once you're logged in as that account — there is
no separate org to create or claim.

| Package | Path | What it is |
|---|---|---|
| `@ravenkash/rtc` | `packages/sdk` | Browser RTC SDK |
| `@ravenkash/chat` | `packages/chat-sdk` | Browser chat SDK |
| `@ravenkash/client` | `packages/client` | RTC + chat behind one object |
| `@ravenkash/react` | `packages/react-sdk` | React hooks/UI for `@ravenkash/rtc` |
| `@ravenkash/react-native` | `packages/react-native-sdk` | React Native SDK |
| `@ravenkash/server` | `packages/server-sdk` | Server-side token/room/diagnostics SDK |
| `@ravenkash/cli` | `packages/cli` | `raven` CLI binary |

## What was done to prep them

- Added a root `LICENSE` (MIT) and copied it into each package directory —
  npm bundles `LICENSE`/`README` into the tarball automatically even though
  `files` only lists `dist`.
- Added `repository`, `homepage`, and `bugs` fields to each `package.json`
  (pointed at `github.com/atulsinghhhh/Raven`, `main` branch — update if the
  repo path or default branch differs).
- Added `"publishConfig": { "access": "public" }` to each — **required**
  because scoped packages (`@ravenkash/...`) publish as *private* by default,
  which fails outright on a free npm account.
- Fixed `@ravenkash/cli`'s `bin` path (`./dist/index.js` → `dist/index.js`) to
  silence npm's (harmless but noisy) path-normalization warning.
- Built all seven packages (`pnpm --filter ... run build`) and ran
  `npm publish --dry-run` in each — all pack cleanly, correct files only
  (`dist/`, `LICENSE`, `package.json`), no missing entry points.

I did **not** run the real `npm publish` or `npm login` — this machine has no
npm credentials, and publishing is a one-way, public action you should drive
yourself.

## What you need to do

1. **Nothing to claim** — `ravenkash` is your personal npm username, so you
   already own the `@ravenkash` scope by virtue of being logged in as that
   account. Double check on npmjs.com that `ravenkash` is in fact your
   account before publishing, since scope ownership follows account
   ownership exactly.
2. **Log in** from this machine:
   ```bash
   npm login
   ```
   (or set `//registry.npmjs.org/:_authToken=<token>` in `~/.npmrc` if you're
   using an automation/granular access token — recommended for CI later).
3. **Publish each package**, in this order (leaf SDKs first, `cli` and
   `client` last since nothing in this repo depends on them):
   ```bash
   cd packages/sdk               && npm publish   # @ravenkash/rtc
   cd ../chat-sdk                 && npm publish   # @ravenkash/chat
   cd ../server-sdk                && npm publish   # @ravenkash/server
   cd ../react-sdk                 && npm publish   # @ravenkash/react
   cd ../react-native-sdk           && npm publish   # @ravenkash/react-native
   cd ../client                     && npm publish   # @ravenkash/client
   cd ../cli                        && npm publish   # @ravenkash/cli
   ```
   Or from the repo root with pnpm, one at a time:
   ```bash
   pnpm --filter @ravenkash/rtc publish --access public
   pnpm --filter @ravenkash/chat publish --access public
   pnpm --filter @ravenkash/server publish --access public
   pnpm --filter @ravenkash/react publish --access public
   pnpm --filter @ravenkash/react-native publish --access public
   pnpm --filter @ravenkash/client publish --access public
   pnpm --filter @ravenkash/cli publish --access public
   ```
4. **Verify**:
   ```bash
   npm view @ravenkash/rtc
   npx @ravenkash/cli --help
   ```

## After the first publish

- Version bumps: these are independent packages at `0.1.0`, not yet wired to
  a changesets/release workflow. Bump each `package.json` version and re-run
  `npm publish` (or adopt [changesets](https://github.com/changesets/changesets)
  if you want coordinated versioning — not set up yet).
- Consider adding a GitHub Actions publish workflow (there's currently a
  `docker-publish.yml` but no npm equivalent) once you have an `NPM_TOKEN`
  secret to automate this instead of doing it by hand each time.
