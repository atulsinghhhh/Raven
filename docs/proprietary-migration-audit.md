# Proprietary Migration Audit

Raven (branded **Livqeno** in public-facing surfaces) is transitioning from an open-source
positioning to a **proprietary, hosted developer platform** for RTC, Chat, Live Streaming,
APIs and SDKs. This document is the full repo-wide audit that precedes the rewrite work.
It records: every location that currently presents Raven/Livqeno as open source or
self-hostable, the licensing/package-metadata situation, public GitHub repo exposure,
and a security sweep for accidentally committed secrets.

**Read this before deleting or unpublishing anything.** Several items below are
legally or operationally destructive (LICENSE changes, npm unpublish, GHCR image
visibility, git repo visibility) and are explicitly called out as **requires
approval** rather than auto-applied.

---

## 0. Headline finding

The single most important structural fact: **the root `README.md`, `CONTRIBUTING.md`,
and the public docs site (`apps/docs/content/`) all already, explicitly, repeatedly
state that Livqeno is open source and self-hostable** — this isn't a few stray phrases,
it's the current, deliberate positioning across three independent surfaces:

1. **`README.md`** (root) — tagline: *"Open-source real-time communication
   infrastructure."* Ships a full `docker compose up` / `pnpm infra:up` self-host
   quickstart, and links out to most of `docs/`, including internal engineering
   material (`docs/issues/`, `docs/architecture/*`, `docs/production/*`).
2. **`apps/docs/content/`** (the live docs site at docs.ravenstack.online) — has an
   entire **"Self-hosting"** nav section (`self-hosting.md` + 4 sub-pages) and states
   in `getting-started/introduction.md`: *"Livqeno is open source, and self-hosting is
   a first-class path rather than an afterthought."*
3. **`CONTRIBUTING.md`** — frames Raven as an open-source project with inbound=outbound
   MIT contribution terms, no CLA, and points contributors at `docs/issues/` as
   "good first tasks" — several of which describe live-sounding production/security
   weaknesses (open TURN relay, dev/prod DB sharing, SSH access).
4. **`docs/production/readiness-audit.md`** confirms a decision was already made:
   *"Decided: the repository is going public."* — this is the root cause of the
   contradictory state everything else stems from, and should be revisited/reversed
   as part of this migration, not just patched over with copy changes.

Fixing individual pages without addressing (1)–(4) as a set will leave the positioning
internally inconsistent.

---

## 1. Public-facing app surfaces (apps/www, apps/dashboard, apps/docs)

| File:Line | Quote / issue | Public-facing? | Recommendation |
|---|---|---|---|
| `apps/www/src/lib/links.ts:19` | `GITHUB_REPO_URL` constant + code comment noting the repo currently 404s (private) but docs/README have said "open source" all along | Yes | Remove the constant/usages once repo-visibility decision is finalized; do not link an open-source repo from marketing site |
| `apps/www/src/components/Nav.tsx:53-64` | Persistent header "GitHub" link with "source" badge | Yes | Remove from primary nav |
| `apps/www/src/components/FinalCTA.tsx:35-42` | Homepage closing CTA button labeled **"Read the source"** | Yes | Replace with "Get started" / "View docs" CTA |
| `apps/dashboard/src/components/auth/auth-shell.tsx:73-74` | Login/signup trust badges: **"Open source"**, **"Self-hostable"** (rendered on every auth page) | Yes | Replace with hosted-platform trust badges (e.g. "SOC2-track", "99.9% uptime", "Managed infrastructure") |
| `apps/dashboard/src/app/dashboard/projects/[projectId]/servers/page.tsx:92-96` | Empty-state tells a hosted customer to fix "No RTC servers registered" via `docker compose up -d sfu` | Yes | Rewrite to a hosted-platform remedy (contact support / check project status), never instruct a customer to run compose |
| `apps/dashboard/src/app/dashboard/developers/page.tsx:122,125` | "in the open-source repo" + GitHub examples link | Yes | Rewrite to link at public SDK examples repo/docs, drop "open-source repo" framing |
| `apps/dashboard/src/lib/nav.ts:127-132` | `GITHUB_URL` ("public repository... forks") + `SUPPORT_URL` defaulting to GitHub issues, wired into `account-shell.tsx:98`, `user-menu.tsx:70-71` | Yes | Replace with a proprietary support contact/portal |
| `apps/dashboard/.../projects/[projectId]/sdks/page.tsx:113,180` | `pip install "git+https://github.com/..."` + "built from this repository" | Yes | Replace with `pip install raven-sdk` once published to PyPI (see §5) |
| `apps/dashboard/.../quickstart/integration-wizard.tsx:280` + `integration-registry.ts` | `.env` sample shows `RAVEN_API_URL=http://localhost:4100`, no hosted URL shown | Yes | Default sample to the hosted API base URL |
| `apps/docs/content/getting-started/introduction.md:52-57` | **"Livqeno is open source, and self-hosting is a first-class path rather than an afterthought."** | Yes | Rewrite per §2 target positioning |
| `apps/docs/content/self-hosting.md` + 5 sub-pages (`docker-compose.md`, `environment-variables.md`, `sfu.md`, `turn.md`, `health-and-metrics.md`) | Full public self-hosting manual: architecture diagram, ~129 env vars, secret generation, TURN/coturn ports | Yes | Remove from public nav entirely (see §3) |
| `apps/docs/content/getting-started/quickstart.md:11-17,192-210` | Frames local `docker compose up` as an equal first option; full "Local development" section | Yes | Rewrite to SDK-install-only quickstart |
| `apps/docs/content/reference/faq.md:142-145` | "Do I have to self-host? No, but Livqeno is open source and self-hosting is a first-class path." | Yes | Rewrite answer to hosted-only framing |
| `apps/docs/content/getting-started/installing-from-source.md` | Teaches `git clone` + running your own control plane as a normal step | Yes | Remove from public developer flow entirely |
| `apps/docs/content/guides/build-a-video-call.md` | Treats `git clone`/self-run backend as a tutorial step | Yes | Rewrite to SDK + hosted API only |
| `apps/docs/content/sdk/flutter.md:22` | Says *"Livqeno's source isn't a public repository"* — contradicts the open-source claims above | Yes | Resolve inconsistency once final positioning is set; this line is actually closer to the target state |
| `apps/docs/content/get-started/install-an-sdk.md:32`, `production/security.md:79-88`, `rtc/troubleshooting.md:88`, `sdk/flutter.md:219` | GitHub-hosted install command / GitHub-based security & support process | Yes | Replace GitHub links with hosted support/security-contact process |
| `apps/docs/content/reference/limits.md:7`, `guides/build-for-production.md:49`, `get-started/create-a-project.md:20` | Self-hosting language leaking into hosted-customer reference docs | Yes | Scrub self-host references |
| `apps/docs/src/components/DocsNav.tsx:71-79` | Persistent GitHub icon in docs header on every page | Yes | Remove or repoint at SDK-examples repo only, not platform source |

**Not flagged (checked, benign):** dashboard "Continue with GitHub" OAuth buttons (auth
provider, unrelated to OSS positioning); generic "Could not reach the server" error
strings; server-side-only `localhost` fallbacks in `api-client.ts`/`super-admin-client.ts`;
`github-light`/`github-dark` syntax-highlight theme names; test fixtures referencing
`github-slugger` or GitHub OAuth env var names.

---

## 2. Target public positioning (to write into README / docs / landing page)

> Raven (Livqeno) is a managed real-time infrastructure platform for developers.
> Build video, voice, chat, and live streaming without running your own real-time stack.
> Developers integrate through the **Dashboard + API + SDKs** — Raven operates the
> underlying infrastructure.

Do not claim "all Raven source code is proprietary" if SDK source stays public — the
accurate framing is: **the platform is proprietary; SDKs/examples may remain public**
for integration purposes (see §5 for exactly which SDKs are npm-public today).

---

## 3. `docs/` inventory (top-level docs directory, 95 files — not 44 as originally estimated)

Full per-file classification (A = genuinely public developer content, B = internal
engineering material) was produced and is preserved in the investigation transcript;
summary by directory:

- **`docs/chat/*`** (11 files) — **A**, clean, no OSS/self-host language. No change needed.
- **`docs/sdk/*`** (7 files) — mostly **A**; `docs/sdk/server/python.md:15` has the same
  `pip install git+https://github.com/...` issue as the README (see §5).
- **`docs/architecture/*`** (8 files) — **B**, internal ADRs, several linked from README
  (`infrastructure-decisions.md`, `sfu-comparison.md`, `native-rtc-migration-map.md`,
  `turn.md`, `webrtc.md`) — contain competitively-sensitive "why we left LiveKit /
  self-hosting commitment" reasoning. **Un-link from public README nav.**
- **`docs/deployment/*`** (7 files) — **B**, internal deploy runbooks with real infra
  commands and domain/cost details (`production.md` is linked from README — un-link it).
- **`docs/issues/*`** (11 files incl. README) — **B**, but **currently linked from both
  README ("Known issues") and CONTRIBUTING.md ("good first task")**. **Highest-priority
  fix**: several read as live vulnerability disclosures (`05-coturn-fails-open.md` — open
  relay; `01-shared-database-sfu-registry.md` — dev/prod DB sharing; `08-ssh-pinned-to-one-ip.md`).
  Remove both links immediately, independent of the rest of this migration.
- **`docs/production/*`** (5 files) — **B**; `readiness-audit.md` documents the mechanics
  of the original "make the repo public" decision and must never itself go public.
  Confirmed not linked from README today — keep it that way.
- **`docs/rtc/*`** (8 files) — **B**, engineering-depth, but README currently presents
  these as the primary public RTC docs. The actual customer-facing RTC docs already
  exist separately at `apps/docs/content/rtc/*`. Un-link `docs/rtc/*` from README;
  it should read as an internal deep-dive, not the customer doc set.
- **`docs/super-admin/implementation-plan.md`** — **B**, highest sensitivity in the
  tree (describes the internal admin portal's endpoints/models/security invariants).
  Confirmed not linked anywhere public today. Recommend moving out of the codebase
  into an internal-only wiki rather than relying on "currently unlinked."
- **`docs/roles.md`, `docs/oauth.md`, `docs/environments.md`, `docs/error-codes.md`,
  `docs/audit-logs.md`, `docs/security/server-sdk.md`** — **A**, genuinely public,
  no OSS language, keep as-is.
- **`docs/local-development.md`, `development.md`, `email.md`, `control-plane.md`,
  `observability.md`, `telemetry.md`, `security.md`** — **B**, internal contributor/ops
  docs, all currently linked from README. Un-link from public nav; content can stay
  internal-only.
- **`.docs/plan.md`, `.docs/INFRASTRUCTURE_PHASES.md`** — gitignored/untracked, so they
  cannot leak via git regardless of content. They contain the *original* open-source
  go-to-market plan ("§19 Open Source Strategy", "Phase 18 — Open Source / Self
  Hosting"). Recommend adding a header marking these sections **superseded** so no
  engineer treats them as current strategy.

**Separately, and more urgent than the `docs/` tree above:** `apps/docs/content/`
is the actual *live, published* docs site and has its own self-hosting section
(§1) — that is first priority, ahead of the repo-internal `docs/` cleanup.

---

## 4. Licensing

- **Root `LICENSE`**: MIT, `Copyright (c) 2026 Livqeno`.
- **All 12 package/SDK LICENSE files** (`packages/*` × 8, `sdks/python`, `sdks/flutter/*` × 3)
  are byte-for-byte identical MIT text — completely uniform, no fragmentation to reconcile.
- **No SPDX identifiers or per-file copyright headers anywhere in source code** — the
  only license surface area is the 13 LICENSE files + the `"license": "MIT"` field in
  8 `package.json`s + `pyproject.toml`. This is a small, well-contained set.
- **Root `package.json` description** literally says *"open-source, developer-first
  real-time communication infrastructure"* — directly contradicts proprietary
  positioning, highest-visibility metadata field to fix.
- **`CONTRIBUTING.md`** contains an explicit legal statement: inbound contributions are
  licensed under the repo's MIT license, no CLA. This needs to change (and a CLA
  likely introduced) before accepting further external contributions under a
  proprietary model.
- **All 8 npm-scoped packages** (`@ravenkash/server`, `react-native`, `cli`, `react`,
  `rtc`, `chat`, `effects`, `client`) have `publishConfig.access: "public"` — none
  are restricted. Per §27 of the brief ("don't falsely claim closed source if
  components are public"), these can legitimately remain public **SDKs** even after
  the platform itself goes proprietary — that's a product decision, not a bug. What
  needs to change is only the *description* framing (§5) and the root LICENSE/positioning
  contradiction, not necessarily the packages' public availability.
- **Inconsistency already live today**: `apps/www/src/components/Footer.tsx:63` shows
  *"© Livqeno. All rights reserved."* on the public marketing site, while the actual
  repo ships under permissive MIT — already contradictory in the *other* direction.
- **`SECURITY.md`** states *"nothing on npm/PyPI/pub.dev is published from this
  repository yet"* — factually false; `PUBLISHING.md` and live `publishConfig` fields
  show 8 packages are actively, automatically published via changesets + npm OIDC.
  These two docs need to be reconciled regardless of the OSS→proprietary decision.
- **No CODE_OF_CONDUCT.md exists** in the repo.

**Requires explicit approval before changing (legally significant, not auto-applied):**
1. Whether the root `LICENSE` changes from MIT to a proprietary notice for the
   **platform/backend** code (`apps/api`, `services/*`, `infrastructure/*`), while the
   **SDK packages** (`packages/*`, `sdks/*`) may reasonably keep MIT if the intent is
   "proprietary platform, open SDKs" (§5/§27 of the brief). This is a product/legal
   decision — recommend a split-license approach (backend proprietary notice; SDK
   packages keep MIT with an updated description) rather than blanket relicensing,
   but flagging for explicit sign-off before touching any LICENSE file.
2. Whether `CONTRIBUTING.md`'s public-contribution model is retired (requires a
   CLA decision if any external contribution path remains, e.g. for SDKs).

---

## 5. Package/SDK metadata

| Package | Current description mentions | Action |
|---|---|---|
| `packages/server-sdk` (`@ravenkash/server`) | Livqeno server SDK framing | Update description to "Official server SDK for the Raven hosted platform" |
| `packages/react-sdk`, `packages/sdk`, `packages/react-native-sdk`, `packages/chat-sdk`, `packages/effects`, `packages/client`, `packages/cli` | Same Livqeno/OSS-adjacent framing | Same update pattern |
| `sdks/python` (`raven-sdk`, pyproject.toml) | `license = {text="MIT"}`, repository/homepage point at GitHub monorepo path; **not yet published to PyPI** | Publish properly to PyPI so `pip install raven-sdk` works without a `git+https://` source install (fixes the same issue in README.md:174, `LIVE_STREAMING_GUIDE.md:43`, `docs/sdk/server/python.md:15`) |
| `sdks/flutter/raven_rtc`, `raven_chat`, `raven_live` (pubspec.yaml) | No `license` field (pub.dev infers from LICENSE file); **not yet published to pub.dev** | Same as above — publish or clearly mark pre-release |
| Root `package.json` (`raven`) | description: *"open-source, developer-first..."* | Rewrite immediately (highest-visibility fix) |

**Manual npm/PyPI/pub.dev actions requiring approval, not auto-applied:**
- Whether to keep all 8 npm packages `publishConfig.access: "public"` (recommended: yes,
  per §5/§27 — public SDKs are compatible with a proprietary hosted platform) or move
  any to `restricted`.
- Publishing `raven-sdk` to PyPI and `raven_rtc`/`raven_chat`/`raven_live` to pub.dev for
  the first time — these are new, real publish actions with their own account/ownership
  implications.
- No package should be unpublished — existing developers may depend on them.

---

## 6. Self-hosting / infrastructure exposure

- **`examples/`** (13 items, all example apps) — **currently 0 "good" examples**. Every
  one instructs `pnpm infra:up` (= `docker compose up -d`) or building SDKs from a
  monorepo source checkout, and defaults `RAVEN_API_URL` to `http://localhost:4100`
  rather than the hosted API. All 13 need rewriting to: hosted API URL by default,
  `npm install @ravenkash/...` instead of building from source.
- **`scripts/`, `infrastructure/`, `docker-compose.yml`, `docker-compose.scale.yml`** —
  confirmed internal engineering tooling, not linked from `apps/docs/content/` directly
  themselves. However:
- **`.github/workflows/docker-publish.yml` and `sfu-publish.yml`** publish the API and
  SFU Docker images **publicly to GHCR** (`ghcr.io/<owner>/raven-api`,
  `ghcr.io/atulsinghhhh/raven-sfu`) on every push to `main`. This is the real mechanism
  keeping self-hosting viable even if docs are rewritten — **requires explicit approval**
  to restrict (a determined user could still `docker pull` these images and reconstruct
  the stack from the still-public `docker-compose.yml`). Rewriting docs without also
  addressing this makes the doc rewrite cosmetic only.
- **`.env.example`** contains no explicit "for self-hosting" comment, but its entire
  shape (TURN secrets, SFU node config, MinIO storage config) is written for a full
  self-hoster, not a hosted-platform consumer. A hosted-only customer `.env` would only
  need `RAVEN_API_KEY`/`RAVEN_API_URL`. Recommend keeping this file as-is for **internal
  engineering use** (it's what Raven's own engineers need to run the stack) but ensuring
  it is not referenced from any public customer-facing doc as "your `.env`".
- Root `README.md` "Running it locally," "Testing," and "Status" sections (quoted in
  full in the investigation transcript) instruct the self-host quickstart and expose
  internal engineering status — see §7 for the README rewrite.

---

## 7. Security sweep — no rotation required

Full read-only sweep of `.gitignore`, tracked `.env*` files, Dockerfiles,
docker-compose, CI workflows, scripts, `.gitleaks.toml`/`.gitleaksignore`, and full
git history (`git log --all`).

**Result: no real secrets are exposed, in the working tree or in git history.**

- `.gitignore` correctly excludes `.env`/`.env.*` while allow-listing `.env.example`.
- Only `.env.example` is tracked in git; it contains placeholders only (`change-me-...`)
  plus Microsoft's published, fixed Azurite emulator key (a public constant, not a secret).
- No AWS/GitHub/Stripe/Slack/Google/private-key-shaped literals found in Dockerfiles,
  compose files, CI workflows, or scripts — secrets are consistently passed via env var
  interpolation.
- `.gitleaksignore` entries are all documented, fingerprinted to specific commit:path:line,
  and verified as placeholder/example values (`REPLACE_ME` k8s manifest, an illustrative
  unissued API-key shape in Swagger docs) — not a cover for real leaks.
- No `.env`/`.env.local`/credentials file was ever added to git history at any point.

**No action required** beyond the standard reminder that local untracked `.env*` files
should never be included in any manual tarball/export of the repo.

---

## 8. Public GitHub repository status

- Remote: `git@github-atulsinghhhh:atulsinghhhh/Raven.git`.
- `docs/production/readiness-audit.md` records a decision to make the repository
  public, but a code comment in `apps/www/src/lib/links.ts:19` notes the repo
  currently **404s** (suggesting it is actually private today, or was reverted) even
  though docs/README already speak as if it's public.
- **This state needs to be resolved first**, since it determines whether items in §3/§6
  are "already exposed" or "not yet exposed but written as if they will be":
  - If the repo is confirmed **private**: the OSS-flavored copy in README/docs/CONTRIBUTING
    is misleading but not yet a live leak — rewrite copy, no urgency on `docs/issues/`.
  - If the repo is confirmed **public**: `docs/issues/` (open relay vuln, dev/prod DB
    sharing) is a live disclosure and should be un-linked/removed immediately, ahead of
    any other change in this migration.
- **This audit does not change repository visibility.** That is a destructive/hard-to-reverse
  action ("publishing a repository cannot be walked back once anything clones, forks or
  indexes it" — quoting the repo's own readiness-audit doc) and requires explicit
  approval, plus confirmation of current actual visibility via `gh repo view
  atulsinghhhh/Raven --json visibility` before any decision is made.

---

## 9. Internal documentation retained (not touched by public rewrite)

`docs/architecture/*`, `docs/deployment/*`, `docs/production/*`, `docs/rtc/*` (as
engineering depth, distinct from `apps/docs/content/rtc/*`), `docs/super-admin/*`,
`docs/security.md`, `docs/development.md`, `docs/local-development.md`,
`docs/control-plane.md`, `docs/observability.md`, `docs/telemetry.md`,
`docs/email.md`, `infrastructure/*`, `scripts/*` (excluding anything customer-facing),
`.docs/*` (gitignored). These remain as Raven's own internal engineering material;
the work here is to **un-link** them from public navigation (README, docs site nav),
not to delete them.

---

## 10. Remaining manual actions requiring explicit approval

These are called out separately per the task brief — none are auto-applied:

1. **Confirm actual current GitHub repo visibility** (`gh repo view` or equivalent)
   before deciding whether `docs/issues/` unlinking is urgent-today or precautionary.
2. **LICENSE strategy decision**: keep SDK packages MIT (recommended) vs. relicense
   the platform/backend code under a proprietary notice — a legal/product decision,
   not something to auto-apply.
3. **GHCR image visibility** (`docker-publish.yml`, `sfu-publish.yml`) — decide whether
   to restrict these to private, since public images undermine any docs-level
   self-hosting removal.
4. **Publish `raven-sdk` to PyPI and Flutter packages to pub.dev** — new publish
   actions with account/ownership implications.
5. **CLA introduction** if external contributions continue for the SDK packages.
6. Nothing has been unpublished, deleted, or had its LICENSE changed as part of this
   audit — all of the above are flagged for a follow-up decision.
